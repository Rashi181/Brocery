# Person 2 — AI / Shopping Intelligence

Implements exactly these endpoints from the team's API Spec:
- `POST /chat/parse`
- `POST /vision/detect` (wraps SAM 3.1)
- `POST /product/analyze`
- `GET /preferences`
- `POST /preferences/correction`

`/trip/start`, `/aisles`, `/item/confirm`, `/item/substitute`, `/item/skip`,
`/cart`, `/checkout`, `/settlement` belong to Person 3/4 and are **not** in
this package.

## Setup (5 minutes)

```bash
python3 -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
pytest                                                # should print "51 passed"
```

That's mock mode: no API keys needed, everything deterministic. Build your
whole pipeline against this first.

## Switching to real Muse Spark

```
LLM_MODE=live
META_API_KEY=your_key_from_dev.meta.ai
```
Run `python checks/check_0_env.py`. It checks your key, the model name, a
plain JSON call, and a vision call on a fake product photo, in that order.

## Switching to real SAM 3.1

There is no single documented "Meta Model API" endpoint for SAM the way
there is for Muse Spark — real hosted access varies by provider. Every
assumption about the live API is isolated in one function:
`intelligence/vision.py: SAMDetector._call_sam_live()`. Once you have real
access at the event, that's the only function you need to edit; nothing else
(router, schemas, Person 1's contract) changes.

```
SAM_MODE=live
SAM_ENDPOINT_URL=https://...       # from whichever SAM host you end up using
SAM_API_KEY=...
```

If there's no dedicated SAM endpoint to point at, leave `SAM_ENDPOINT_URL`
empty with `SAM_MODE=live` — the code automatically falls back to asking
Muse Spark's own vision to estimate bounding boxes (`_call_sam_via_muse`).
Less precise than real segmentation, but keeps the AR demo working end to
end. `check_0_env.py` and `check_4_vision.py` both tell you which path ran.

## Switching to Backboard memory

```
PREF_MODE=backboard
BACKBOARD_API_KEY=your_key_from_backboard.io
```
Leave `BACKBOARD_ASSISTANT_ID` empty the first time — `check_0_env.py`
creates the assistant and prints the id to paste back into `.env`. If
Backboard is ever down or slow, everything still works: every fact is also
written to a local JSON file (`LOCAL_PREF_PATH`), which stays in sync
regardless, so nothing needed for the demo depends on Backboard being up.

## Running your own server

```bash
uvicorn dev_server:app --reload --port 8002
```
Open `http://localhost:8002/docs` to try every endpoint from the browser.
Person 4 mounts the same router in the real app with:
```python
from intelligence.errors import install_error_handlers
from intelligence.router import router as ai_router

install_error_handlers(app)      # do this once — gives every error the {error, code} shape
app.include_router(ai_router)
```

## The checkpoints, in order

| Script | When | What green means |
|---|---|---|
| `pytest` | anytime | Your code changes didn't break anything |
| `checks/check_1_whatsapp.py [your_export.txt]` | hour 0 | The parser reads a **real** WhatsApp export from your phone |
| `checks/check_0_env.py` (LLM_MODE=live) | hour 0–1 | Muse Spark key, model name, JSON output, vision all work, under 3s |
| `checks/check_2_contract.py` | hour 1–4 | A chat becomes a contract; prints the exact `/chat/parse` response shape |
| `checks/check_3_analyze.py` | hour 4–10 | A product photo becomes a `/product/analyze` response: checklist, match, alternative |
| `checks/check_4_vision.py` (SAM_MODE=live) | hour 4–10 | `/vision/detect` returns normalized bboxes; empty result for no match, not an error |
| `checks/check_5_preferences.py` (PREF_MODE=backboard) | hour 10–18 | A runner's correction on trip 1 shows up automatically via `/preferences` on trip 2 |
| `checks/check_6_api.py [server_url]` | integration | Every endpoint works over real HTTP, error shape included, against Person 4's deployed backend |

FAIL means our code is broken. WARN means the model's quality needs work —
fix that by editing `intelligence/prompts.py` and rerunning the check.

## What to send teammates right away

**Person 1** gets `/vision/detect` (bboxes for shelf overlays) and
`/product/analyze` (the checklist card, plus an `alternative.bbox` when one
is available). Both responses are exactly the spec's shapes — copy
`checks/check_6_api.py`'s printed JSON straight into their mock data while
SAM/Muse access is still being sorted out.

**Person 4** mounts `intelligence/router.py` and `intelligence/errors.py`
(one call: `install_error_handlers(app)`) and owns everything after
`/chat/parse` — budget, cart, aisles, checkout. Their `/product/analyze`
calls only need `item_id` from what `/chat/parse` returned; they don't need
to persist item details themselves.

**Person 3** doesn't consume anything from this package directly — checkout
and settlement are pure Person 3/4 territory per the spec.

## Design decisions worth knowing

- **Muse Spark judges facts; our code applies rules.** The model reports
  what it sees on a label. `match`, the price line, and the 5-line cap are
  all decided by plain Python in `analyze.py`, never by the model's opinion.
- **The model can never invent people.** A requester name that doesn't match
  anyone in the chat gets flagged (`needs_review`, internal only — not in
  the spec response) instead of silently accepted. See
  `tests/test_contract.py::test_invented_person_and_bad_sources_are_flagged`.
- **Item lookup is in-memory, scoped to one process.** `/product/analyze`'s
  request is only `{trip_id, item_id, image_b64}` — no item details — so
  Person 2 has to remember what `/chat/parse` extracted. See the docstring
  at the top of `intelligence/store.py` for why, and what to do if a longer
  demo needs it to survive a restart (swap for a Mongo lookup; nothing else
  changes).
- **Alternative bounding boxes come from the last shelf scan.** The spec's
  `/product/analyze` has no shelf-image field, so the alternative's bbox is
  matched against whatever `/vision/detect` most recently returned
  (`store.py: record_detections` / `recent_detections`, 2-minute TTL).
  Single-runner, single-trip assumption — fine for a hackathon demo.
- **No status "unknown."** The spec's checklist status enum is only
  `pass/fail/warn`. A criterion Muse never answered is shown as `warn` with
  text like "unsweetened: couldn't verify" rather than silently dropped.

## Files

```
intelligence/
  config.py        env-driven settings (LLM/SAM live-vs-mock, local/backboard)
  errors.py         AppError + FastAPI handlers giving every response {error, code}
  schemas.py         spec-exact request/response models + richer internal models
  store.py            in-memory item/contract registry + recent shelf detections
  whatsapp.py          .txt export parser (Android + iOS, both date orders)
  llm.py               Muse Spark client: structured output, JSON repair retry
  vision.py             SAM 3.1 wrapper — mock, Muse-vision fallback, live stub
  mocks.py               deterministic fake Muse + fake SAM, no network needed
  prompts.py              every prompt — tune wording here
  contract.py               Phase 1: chat -> internal Contract -> spec response
  preferences.py             Backboard store, always mirrored to local JSON
  learning.py                POST /preferences/correction -> memory fact
  router.py                  the 5 endpoints, exact spec shapes
dev_server.py         run the endpoints standalone on :8002
fixtures/              sample chats, product photos, mock LLM/SAM fixtures
checks/                 the numbered scripts above
tests/                  51 pytest unit tests
```

## If something breaks at 3am

- **`check_0` fails on the text call** — check `META_API_KEY` and `MUSE_MODEL`
  match your Meta Model API dashboard exactly.
- **No real SAM endpoint confirmed yet** — leave `SAM_MODE=mock` (or `live`
  with `SAM_ENDPOINT_URL` empty for the Muse-vision fallback) and keep
  building; swap in the real one later, only `vision.py` changes.
- **Backboard search returns nothing right after writing** — indexing can
  lag a few seconds; the local mirror already has it, nothing is lost.
- **Any endpoint 500s and you're out of time** — set `LLM_MODE=mock` and
  `SAM_MODE=mock` in `.env` and restart. The whole demo still runs end to
  end on canned responses while you debug the live model on the side.

# AccessCart — integrated MVP

This branch combines `backend` product UI/trip API, `meta` intelligence, and Alex's device-tested WebXR camera/ray/anchor and autofocus work. Payments, passkeys and Visa are deliberately excluded.

## Start on Windows

Open **this checkout**, not the old `Project/accesscart-ar` folder. The layout is now `backend/`, `frontend/`, `person2-intelligence/` at the repository root.

Terminal 1, from the repository root:

```powershell
.\backend\start.ps1
```

The script creates a virtual environment under your own Windows account and repairs missing pip with `ensurepip`. If Python is not on PATH, pass `-Python C:\path\to\python.exe`. It serves port **8002**, so the old test server on 8000 can stay separate.

`backend/.env` needs:

```dotenv
SAM_API_KEY=your-key
LLM_MODE=live
SAM_MODE=live
```

Muse uses `MUSE_API_KEY`, then `META_API_KEY`, then `SAM_API_KEY`. The key never belongs in frontend files. Copy `.env.example` if setting up a fresh clone. The current local checkout has the existing key copied into ignored `backend/.env`; it is not in Git.

Terminal 2:

```powershell
cd frontend
npm ci
npm run dev
```

Open http://localhost:5180. Port 5174 is blocked on this Windows machine, so this branch uses **5180**. `/api` is proxied to port 8002. Don't set the browser API URL to localhost:8000: on the phone that means the phone itself.

Terminal 3 for the Pixel:

```powershell
cloudflared tunnel --url http://localhost:5180
```

Open its HTTPS URL in Chrome on the Pixel. Keep all terminals running. Quick tunnel URLs change on restart; a named Cloudflare tunnel/domain is needed for a permanent URL. No tunnel is created automatically by this repository.

## One end-to-end physical test

Put a water bottle, Cheetos packet and yellow rubber duck on a table. Use **live** mode. Paste:

```text
9/26/26, 1:00 PM - Alex: Please get one bag of Cheetos. No dairy, strict.
9/26/26, 1:01 PM - Priya: A water bottle, any brand, under $3.
9/26/26, 1:02 PM - Alex: Also a rubber duck, yellow only.
9/26/26, 1:03 PM - Priya: Actually two bottles, same budget per bottle.
9/26/26, 1:04 PM - Alex: Dish soap for everyone, any brand.
```

1. Build list. Expect four requests: Cheetos with dairy excluded; two water bottles up to $3 each; yellow-only duck; shared soap. Review/edit all fields, set your runner name, acknowledge review, budget $20, start.
2. Open Beverages → START AR. Allow camera/AR access. Move slowly to map the table. Scan shelf. A bottle candidate should appear; tap its captured box or double-tap its world label. Walk sideways to verify label position. If no plane was found, the app says so rather than inventing an anchor.
3. Use Read label for sharp close-ups. Camera focus is requested only when the camera exposes the capability. Capture a sharp front/ingredients photo and check it. Unreadable price must stay unknown. Enter unit and total price yourself, explicitly record your decision if any check is unresolved. Confirm quantity of two bottles. Remaining budget should subtract the **total**, exactly once.
4. In Snacks inspect the Cheetos ingredients. If the photo clearly says `CONTAINS MILK INGREDIENTS`, dairy must fail and the strict recommendation must be skip. Do not accept a dairy-free pass. Tap Skip or deliberately record an override and its reason.
5. In Toys scan the yellow duck. Use **In hand → Find held product**, hold it still through detection, then move gently. The local box should follow; if it loses confidence it should disappear. Open the full checklist to decide. This is the main remaining hardware acceptance check.
6. For unavailable soap choose Not found. Basket must show the bottle, any duck decision, skipped Cheetos/soap and their reasons. Undo one item and verify the budget returns, then add it again.
7. Household split must reconcile to the basket total. Finish run records one leaderboard entry. Download the PNG share card or copy text. Add a preference correction. Nothing is purchased or sent to a chat.

If a step fails, keep the visible error and backend terminal output. A successful build does not certify Pixel anchor alignment, autofocus or real-world tracking.

## What is implemented

- Meta WhatsApp parsing, source evidence, later corrections, avoid/spec/reason/rigidity/quantity/budget/shared fields; reviewed edits are saved into the contract actually used by analysis.
- Supi's mobile import/review/aisle/budget interface, real API wiring, product cards, basket undo, per-person split and share card.
- SAM one-bit segmentation decoded with the same parser as Alex's tested code; multiple prompts, normalized **x,y,width,height**, no invented confidence value.
- Multiple world-anchored shelf labels using captured camera pose and plane hit tests. Double-tap label inspection; cards expand on tap.
- Sharp autofocus label camera plus in-hand center-candidate selection and lightweight local block-matching motion tracking between API calls.
- Criterion-by-criterion reasoning. Unknown is review, not a match. Explicit milk declarations override contradictory AI checks. Warnings/failures appear first. Strict conflicts recommend skip; flexible alternatives require actual same-trip shelf candidates.
- Alternative grounding uses a detection ID and the retained shelf image, scoped to a trip and expiring after 120 seconds. No global fuzzy product-name/bounding-box matching.
- Retry-safe integer-cent cart and shared-cost splitting; total price and unit price are separate. Overrides need a reason and feed preference memory.
- Local preference persistence; optional existing Meta Backboard integration through `PREF_MODE=backboard`, `BACKBOARD_API_KEY`, `BACKBOARD_ASSISTANT_ID`.
- Transparent exact-match score, persistent runner leaderboard, itemized text/PNG export and corrections. No fabricated leaderboard entries.

## Practical limits

- The catalog/aisle layout is the temporary backend demo catalog, not a live store database. Prices must come from readable evidence or the shopper; there are no fabricated catalog prices.
- Shelf scans are deliberate captures, up to six distinct product prompts per scan. In-hand detection starts with a button and selects the center candidate; fully automatic pickup recognition is not implemented.
- The local tracker is lightweight block matching, not a trained tracker. Rotation, blur and occlusion can lose it; reacquisition is explicit. It has not been validated on the Pixel yet.
- Moving from WebXR to the autofocus/hand camera ends that XR session. Restart AR and rescan to place labels again. ARCore anchors are not persisted across sessions.
- No 60fps inference promise: the phone renders independently while cloud calls take seconds. Live smoke timings are below.
- Trips/contracts live in one backend process. Browser refresh retains the current trip in sessionStorage; a backend restart expires it. Preferences and finished-run scores persist in ignored `backend/data/`. Use one worker until a database replaces these stores.
- Authentication and multi-household isolation are not part of this hackathon MVP. Run a controlled demo; this is not a production public service.
- USD only. Shared costs divide among parsed chat participants, shown on the split screen. Exact-match score is verified exact matches / all requests; manual overrides/substitutions/skips are not falsely scored as exact matches.
- Backboard network behavior and the Pixel camera must be tested with your credentials/device. Local memory works without Backboard.

## Verification

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests person2-intelligence/tests -q
cd frontend
npm test
npm run lint
npm run build
```

For a no-credit UI demo, explicitly set `LLM_MODE=mock` and `SAM_MODE=mock`, restart API, and use the sample chat. A banner says **DEMO FIXTURES · not live AI**. Mocks do not understand arbitrary photos/chat.

Live checks on this integration:
- Four-item chat: all four items extracted, later bottle quantity corrected, dairy/yellow restrictions and shared soap preserved (24.2 seconds).
- User's bottle image: one SAM mask (2.5 seconds).
- Cropped bottle analysis: price unknown and result needs review, not an invented purchase price (17.2 seconds).
- Browser: import → reviewed trip → aisle → photo candidate → decision → $4.29 cart → $55.71 remaining → household summary.

Branch source snapshots:
- backend: `9b9ba6a2073019117f63866c9d75af2b6f46404a`
- meta: `5fa19910541c1e200171e009b6e9b33d81bf976a`
- alex-branch: `f3aea439aa3cfe22bdeb818bd3e4b8c3e9eb6acf`, plus tested local camera/focus helpers.

This branch is named `meta-AR-frontback` because Git branch names cannot contain spaces. Work was done in a separate clone to protect the original checkout and its uncommitted work.

# Brocery - Shop for your bro with ease

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
GEMINI_API_KEY=your-google-key
GEMINI_SCENE_MODEL=gemini-3.1-flash-lite
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

Terminal 3 for the Samsung:

```powershell
cloudflared tunnel --url http://localhost:5180
```

Open its HTTPS URL in Chrome on the Samsung Galaxy. Keep all terminals running. Quick tunnel URLs change on restart; a named Cloudflare tunnel/domain is needed for a permanent URL. No tunnel is created automatically by this repository.

## Anchored aisle AR (current default)

Enter an aisle and tap **START AR** once: Chrome requires a user gesture to start immersive WebXR. Recognition thereafter is automatic. The default `/ar` route uses the original raw WebXR camera, capture-pose ray mapping, plane hit tests and world anchors. It does not use getUserMedia or the block-matching tracker.

One Gemini Flash-Lite request reads the visible groceries, their boxes and which pending aisle requests match. It includes unrelated groceries with no match: Oreo must not inherit a chips request. Existing anchors keep rendering locally while the request runs; nearby anchors of the same category are updated without replacing their physical anchor. The request loop has one scene request at a time and a 3.5-second gap after completion. Unobserved anchors expire after 15 seconds.

These are **shelf-position anchors, not continuous tracking of a moving packet**. Picking up or replacing a packet requires a new scene observation. Ingredient evidence is not carried over between unverified scene identities. Muse reads ingredient views asynchronously when a matched ingredient panel is visible; the category/title does not wait for it. The short scene call uses the aisle list but never asserts dietary suitability.

Air pinch over an anchored name for 0.3 seconds, then spread/close fingers to resize. Hand input uses a GPU-downsampled 320px AR frame and the existing local MediaPipe worker. Tap an AR name or its bottom product button for the checklist; Add to cart retains explicit price/uncertainty confirmation. No photo-taking step is needed. Physical AR anchoring and hand gestures still require Samsung/Pixel testing.

If immersive AR is unsupported, the start screen offers a clearly labelled standard-camera fallback at `/ar/camera`. The original manual AR test screen remains `/ar/anchors`.

### Acceptance test

1. Restart the backend from this checkout (`.\backend\start.ps1` at repository root). Keep Vite and the existing Cloudflare tunnel running; refresh the phone and start a fresh trip.
2. Import a list requesting chips for Alex (avoid dairy) and pasta for Priya. Enter the relevant aisle and tap START AR. Move slowly to map the table/shelf.
3. Show Doritos and Oreo together. Expect Doritos/chips associated with Alex; Oreo/cookies says not on this aisle's list. No SAM-derived guesses should assign Oreo to chips.
4. Leave both packets stationary and move the phone slowly left/right. The names should remain at shelf positions while new scene requests run, without repeated jumping from the old 2D tracker.
5. Air-pinch a name to resize it. Tap it for the checklist. Ingredients remain unknown until actually read. Add to cart still requires a deliberate action.
6. Move a packet. Its old shelf anchor is not object-following: verify subsequent scene observations update placement and old anchors expire. Do not count this as continuous held-object tracking.

A live two-packet screenshot benchmark returned Doritos=chips (matching the chips request) and Oreo=cookies (no match) in 3.5 seconds using Flash-Lite. This is one image benchmark, not a guarantee of network latency or physical AR performance.

## What is implemented

- Meta WhatsApp parsing, source evidence, later corrections, avoid/spec/reason/rigidity/quantity/budget/shared fields; reviewed edits are saved into the contract actually used by analysis.
- Supi's mobile import/review/aisle/budget interface, real API wiring, product cards, basket undo, per-person split and share card.
- SAM one-bit segmentation decoded with the same parser as Alex's tested code; multiple prompts, normalized **x,y,width,height**, no invented confidence value.
- Default WebXR shelf anchors with automatic Gemini scene recognition and air-pinch resizing; standard-camera tracking remains an explicit fallback.
- One autofocus camera, automatic sharp-view sampling, hand-prioritized checks, and worker-based local tracking between API calls.
- Criterion-by-criterion reasoning. Unknown is review, not a match. Explicit milk declarations override contradictory AI checks. Warnings/failures appear first. Strict conflicts recommend skip; flexible alternatives require actual same-trip shelf candidates.
- Alternative grounding uses a detection ID and the retained shelf image, scoped to a trip and expiring after 120 seconds. No global fuzzy product-name/bounding-box matching.
- Retry-safe integer-cent cart and shared-cost splitting; total price and unit price are separate. Overrides need a reason and feed preference memory.
- Local preference persistence; optional existing Meta Backboard integration through `PREF_MODE=backboard`, `BACKBOARD_API_KEY`, `BACKBOARD_ASSISTANT_ID`.
- Transparent exact-match score, persistent runner leaderboard, itemized text/PNG export and corrections. No fabricated leaderboard entries.

## Practical limits

- The catalog/aisle layout is the temporary backend demo catalog, not a live store database. Prices must come from readable evidence or the shopper; there are no fabricated catalog prices.
- Up to two products tracked simultaneously; up to twelve request comparisons per automatic reading. Large aisle prompt lists rotate in batches. This is a controlled demo target, not crowded-shelf tracking.
- Local tracking is lightweight block matching, not SAM video tracking. A short hand-guided continuity bridge requests identity verification on turns; fast rotation, occlusion, crossing products, and blur may require automatic reacquisition or showing the front again.
- Automatic detection waits at least 8 seconds between calls and avoids unchanged tracked scenes. Readings are serialized and changed-view gated, with retry backoff. Cloud calls still use API credits; this is not continuous cloud video inference.
- Tracking/hand sampling targets roughly 8 Hz in workers; the browser renders video independently. Camera focus depends on device capabilities. Moving offscreen resets identity and evidence.
- MediaPipe 0.10.32 and its hand model are served locally (about 30 MB of assets, browser-cached). No third-party CDN is required on the phone. Gesture initialization failure leaves scanning available and reports the limitation.
- No 60fps inference promise: the phone renders independently while cloud calls take seconds. Live smoke timings are below.
- Trips/contracts live in one backend process. Browser refresh retains the current trip in sessionStorage; a backend restart expires it. Preferences and finished-run scores persist in ignored `backend/data/`. Use one worker until a database replaces these stores.
- Authentication and multi-household isolation are not part of this hackathon MVP. Run a controlled demo; this is not a production public service.
- USD only. Shared costs divide among parsed chat participants, shown on the split screen. Exact-match score is verified exact matches / all requests; manual overrides/substitutions/skips are not falsely scored as exact matches.
- Backboard network behavior and the Samsung camera must be tested with your credentials/device. Local memory works without Backboard.

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

## Automatic-camera verification (this update)

- Existing Python suite plus new live-reading regressions: wrong-trip/malformed-image rejection, result/cart binding, missing assessments, product changes, and explicit milk conflicts.
- JavaScript tests cover gesture dwell/resize/release, depth normalization, duplicate detections, delayed detection replay, loss/reacquisition identities, and the original camera math.
- Browser `http://localhost:5180/live-check.html` is a developer-only synthetic fixture: it initializes the real MediaPipe worker, runs blank-frame inference, and can replay two textured packets and synthetic pinch landmarks without camera access or cloud calls. It is not included in the production entry/build. Do not interpret synthetic passes as product-recognition accuracy.
- One real new-endpoint Muse check on the user's bottle image: HTTP 200 in 17.8 seconds, water bottle identified, price null. No alternative provider has been benchmarked or claimed more accurate.
- After implementation, restart `backend/start.ps1` to load `/api/product/observe`. The frontend remains on 5180, backend 8002. Keep the existing Cloudflare tunnel if still running.

### Overlay stability update

Candidate cards stay compact until identified. Cards retain left/right slots and connect to smoothed product boxes; they no longer reorder or jump vertically with raw tracking coordinates. Nested/repeated detections are merged, short tracking misses hide checks during a 420 ms reacquisition window, and the broad package prompt is only a fallback after empty scans. Camera capture and backend contracts are unchanged.

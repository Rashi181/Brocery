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

## Continuous aisle camera (current default)

Selecting **Enter aisle** opens the rear camera automatically. Allow the browser's camera permission once. There are no capture, upload, scan, or in-hand-mode buttons in this flow. SAM discovers candidate products; on-device workers track them between requests. Muse identifies each product and checks the aisle requests automatically. The camera continues rendering while cloud checks run.

Cards show verified requesters and pass/fail/unknown checks. Turn a product slowly to show ingredients. A sharp changed view triggers another automatic check; a confirmed front view and ingredient view can be retained as evidence. A hand overlapping an object prioritizes its next check. If continuity/identity is uncertain, checks are withheld and the product is reacquired rather than inheriting another packet's results.

**Air pinch:** move your free hand over a floating card in the rear camera view. A cursor indicates the fingertips. Pinch thumb/index together over the card for about 0.3 seconds; the card highlights. Spread them to enlarge or close them to shrink. Move off the card (or out of view) to release. Aperture is normalized by palm width, smoothed, and bounded. No touching the phone and no double-tap is needed for resizing. With fingers open, hover briefly near a card's top or bottom edge to scroll long text hands-free. A larger card reveals the packaging transcript and full checklist.

**Add / decide** opens the existing basket confirmation. Unreadable prices require a manual amount; conflicts and unknown checks still require a recorded decision. No automatic purchase or cart addition occurs.

The default is an autofocus video camera with **screen-space product-following overlays**, not persistent ARCore world anchors. This keeps one camera session for shelf, held product, and label views. The original tested WebXR implementation is preserved in `LegacyARScreen.jsx` / `ar/ARScene.jsx`, accessible at `/ar/anchors` after starting a trip. Its old manual controls are not part of the automatic route.

### First Pixel acceptance test

Keep the backend/frontend/tunnel running. Restart the backend after pulling this update, then refresh the phone and import the list again (trips are in memory).

Put a chips packet and an Oreo packet in good light. Import:

```text
9/26/26, 1:00 PM - Alex: Please get one bag of chips. No dairy, strict.
9/26/26, 1:01 PM - Priya: One packet of original Oreo cookies, under $5.
```

1. Review the two requests, set a $20 budget and enter Snacks. After camera permission, take no scanning actions.
2. Expect two independently tracked cards. A generic packet is only a candidate until the brand/category is read. Chips must not be called Oreo just because Oreo is requested.
3. Pick up one packet, move gently, and turn its ingredients toward the camera. Hold briefly for readable text. Explicit milk evidence must cross out Alex's dairy restriction; partial/blurred evidence must stay unknown. Wait for the reading indicator to finish.
4. Pinch in the air over that card, spread fingers, then close them. Check text changes smoothly and the other card is not selected accidentally. Move away to release.
5. Put the packet out of view. Its card must disappear. Bring a different packet into the same position: it must be identified afresh, not inherit green checks.
6. Add one product deliberately, verify the total and undo/refund in the basket.

Real Pixel focus, rotations, occlusion, hand hit-testing, and thermal performance still require this physical test. The synthetic tests below do not certify those conditions.

## What is implemented

- Meta WhatsApp parsing, source evidence, later corrections, avoid/spec/reason/rigidity/quantity/budget/shared fields; reviewed edits are saved into the contract actually used by analysis.
- Supi's mobile import/review/aisle/budget interface, real API wiring, product cards, basket undo, per-person split and share card.
- SAM one-bit segmentation decoded with the same parser as Alex's tested code; multiple prompts, normalized **x,y,width,height**, no invented confidence value.
- Automatic product-following camera cards and air-pinch resizing. Original world-anchor AR retained separately.
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

## Automatic-camera verification (this update)

- Existing Python suite plus new live-reading regressions: wrong-trip/malformed-image rejection, result/cart binding, missing assessments, product changes, and explicit milk conflicts.
- JavaScript tests cover gesture dwell/resize/release, depth normalization, duplicate detections, delayed detection replay, loss/reacquisition identities, and the original camera math.
- Browser `http://localhost:5180/live-check.html` is a developer-only synthetic fixture: it initializes the real MediaPipe worker, runs blank-frame inference, and can replay two textured packets and synthetic pinch landmarks without camera access or cloud calls. It is not included in the production entry/build. Do not interpret synthetic passes as product-recognition accuracy.
- One real new-endpoint Muse check on the user's bottle image: HTTP 200 in 17.8 seconds, water bottle identified, price null. No alternative provider has been benchmarked or claimed more accurate.
- After implementation, restart `backend/start.ps1` to load `/api/product/observe`. The frontend remains on 5180, backend 8002. Keep the existing Cloudflare tunnel if still running.

### Overlay stability update

Candidate cards stay compact until identified. Cards retain left/right slots and connect to smoothed product boxes; they no longer reorder or jump vertically with raw tracking coordinates. Nested/repeated detections are merged, short tracking misses hide checks during a 420 ms reacquisition window, and the broad package prompt is only a fallback after empty scans. Camera capture and backend contracts are unchanged.

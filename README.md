# Brocery - Shop for your bro with ease
Brocery is the grocery-shopping bro who actually remembers everything.

Group grocery shopping usually starts in a chaotic chat: one bro wants oat milk, another has an allergy, someone says “anything is fine,” and somebody else changes their mind five messages later. Brocery turns that chaos into one smart, shared shopping experience.

Upload the group WhatsApp chat, and BroCery extracts every request, preference, dietary restriction, budget, and allowed replacement. It gives the shopper a clean list organized by aisle, then uses AR and product recognition in-store to help them spot the right item, check whether it fits the request, and add it to the shared basket. At checkout, everyone can see what was actually picked up.

It is not just a grocery list—it is the bro who keeps the group coordinated from “can you grab this?” to “you got it, bro.”


## Meta AI for Connection
Brocery is for friends, roommates, and families planning things together—from potlucks to a “quick” grocery run that becomes a 600-message group chat. It remembers who needs what, allergies, budgets, and substitutions, so nobody misses the vegan dip, nut-free snacks, or, most importantly, the ice.

It strengthens connection by removing the stressful planning work, letting people enjoy the event instead of scrolling through texts and asking, “bro, did anyone get the chips?”

AI is essential because those details are buried in natural conversation. Brocery uses *Meta Muse* and *Gemini* to turn the chaos into a shared grocery plan and bring that context into the store through AR.

## Visa for enhanced shopping experience 
For the Visa challenge, we split their ask into two parts and hit both: the "AI-powered commerce experience" side and the "secure, trusted payments" side. We researched what Visa already ships (TAP for agent identity, tokenized credentials for spend caps, AP2-style mandates for audit trails), and worked on fixing the pain points. Here's how each piece maps:

- **Discovery/personalization (GenAI transforming the journey):** Muse Spark parses the messy group chat into a structured contract per item — spec, reason, rigidity, budget — so it's interpreting intent, not keyword matching.
- **Decision-making in the moment:** Gemini checks the real product against that groupchat requirements and provides a verdict.
- **Secure payments — the core innovation:** the signed Cart Mandate line item is built from what the camera actually verified on the shelf, not from merchant text, which closes a real documented exploit where agents get tricked into signing valid-looking purchases for the wrong item.
- **Trusted payments — the second piece:** every confirm-tap generates a signed attestation (passkey, timestamp, checklist state, frame hash) that proves a specific human confirmed a specific item. This is solving the liability/evidence gap that current online agentic payments can't, because they have no human physically present.
- **Automation layer:** buyer's Visa agent token, spend cap set to the group's budget, passkey checkout, no other cards touched.
- **Post-purchase:** provides an accuracy leaderboard and split-up of payments to ease any friction, along with a feedback form so the AI can keep improving itself.


## Gemini for In-Store Recognition

Brocery uses **Gemini Vision** to analyze stable frames from the live camera feed and identify the products and grocery categories the shopper is looking at. It matches those detections against the current aisle and the group’s requested items, so AR surfaces only useful guidance—not random products on the shelf.

Gemini connects what the camera sees to what the group actually meant: *“This is an oat-milk option for Priya—unsweetened, under $5, and any brand works.”* By sending selected stable frames instead of every video frame, Brocery keeps recognition fast enough for a real grocery run.



## ⚙️ Core functions

| Function | What it does |
| --- | --- |
| WhatsApp chat import | Reads exported `.txt` chats from group conversations |
| AI list generation | Extracts items, quantities, requesters, budgets, allergies, and substitutions |
| Local chat filtering | Removes irrelevant chat noise while preserving shopping context and corrections |
| List review | Lets the shopper edit or remove requests before shopping |
| Aisle routing | Groups requested products into a catalog-backed route |
| AR product guidance | Recognizes relevant visible products and shows request-specific guidance |
| Basket tracking | Records purchased, substituted, skipped, and pending items |
| Checkout summary | Shows what was actually selected; no real payment is processed |

## 🔄 Workflow

```mermaid
flowchart TD
    A[WhatsApp group chat] --> B[Upload .txt export]
    B --> C[Local relevance filtering]
    C --> D[Gemini + Meta Muse]
    D --> E[Reviewed grocery contract]
    E --> F[Aisle-by-aisle route]
    F --> G[AR / camera shopping]
    G --> H[Gemini Vision + Meta SAM]
    H --> I[Product guidance and shopper decision]
    I --> J[Shared basket]
    J --> K[Checkout summary]


    .
├── backend/                         # FastAPI API, trips, cart, checkout, vision routes
│   ├── main.py                      # Main API and shopping workflow
│   ├── live.py                      # Live product observation flow
│   ├── gemini_identity.py           # Gemini product/scene recognition
│   ├── tests/                       # Backend tests
│   └── .env.example                 # Backend environment variables
├── frontend/                        # React + Vite web application
│   ├── src/
│   │   ├── screens/                 # Import, review, aisle, AR, cart, checkout screens
│   │   ├── ar/                      # WebXR, camera, gesture, tracking, AR-card logic
│   │   ├── components/              # Shared UI components
│   │   ├── api.js                   # Backend API client
│   │   ├── store.js                 # Zustand app state
│   │   └── App.jsx                  # Routes and app entry
│   └── package.json                 # Frontend dependencies and commands
├── person2-intelligence/            # WhatsApp parsing and shopping intelligence
│   ├── intelligence/                # Prompts, contracts, preferences, vision helpers
│   └── tests/                       # Intelligence tests
├── SETUP.md                         # Additional setup notes
└── README.md                        # Project documentation

## Start on Windows

Open **this checkout**, not the old `Project/accesscart-ar` folder. The layout is now `backend/`, `frontend/`, `person2-intelligence/` at the repository root.

Terminal 1, from the repository root:

```powershell
.\backend\start.ps1
```

## `backend/.env` needs:

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

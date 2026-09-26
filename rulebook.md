# API Spec

All example values are placeholders. Only the KEYS and TYPES are binding.

Base URL: https://YOURDOMAIN.tech/api --> need to edit

## Global rules

- All bodies are JSON. All responses are JSON.
- Money: float, 2 decimals, USD. `4.29` not `"$4.29"`.
- Bounding boxes: `[x, y, w, h]` NORMALIZED 0 to 1, origin top-left.
  Never pixels. Person 1 downscales frames, so pixels are meaningless.
- Images: base64 string, no `data:image/jpeg;base64,` prefix. JPEG. Max 640px wide.
- IDs are strings.
- Errors, any endpoint, any non-200:
  { "error": "human readable message", "code": "SOME_CODE" }

## Enums (these exact strings, lowercase)

rigidity   : "strict" | "preferred" | "flexible"
priority   : "must" | "nice"
line status: "pending" | "purchased" | "substituted" | "skipped"
check status: "pass" | "fail" | "warn"

---

## 1. POST /chat/parse
Owner: Person 2. Chat text in, structured item list out.

req:
{ "raw_text": "22/09/2026, 19:04 - Priya: can someone get oat milk\n..." }

res:
{
  "contract_id": "c_001",
  "items": [
    {
      "id": "i1",
      "item": "oat milk",
      "requester": "Priya",
      "rigidity": "preferred",
      "spec": "unsweetened, under $5",
      "reason": "the sweet one made her coffee gross",
      "substitute_rule": "any unsweetened oat brand ok, almond not ok",
      "priority": "must",
      "aisle": null,
      "aisle_no": null
    }
  ]
}

Notes:
- `aisle` and `aisle_no` are always null here. Person 4 fills them in /aisles.
- If a field can't be extracted, use null. Never omit the key.
- `reason` is what lets the AI make judgment calls later. Keep it.

---

## 2. POST /trip/start
Owner: Person 4. Called after the runner reviews the list and sets a budget.

req:
{ "contract_id": "c_001", "budget": 60.00 }

res:
{ "trip_id": "t_001", "budget": 60.00 }

`trip_id` is passed to everything after this point.

---

## 3. GET /aisles?contract_id=c_001
Owner: Person 4. Matches items to the catalog, groups by aisle.

res:
{
  "aisles": [
    {
      "aisle": "Dairy",
      "aisle_no": 4,
      "items": [ /* same item objects as /chat/parse, aisle + aisle_no filled in */ ]
    }
  ]
}

Sorted by aisle_no ascending so the runner walks the store in order.

---

## 4. POST /vision/detect
Owner: Person 2 (wraps SAM 3.1). Consumer: Person 1.

req:
{
  "image_b64": "...",
  "prompts": ["oat milk carton", "pasta box"]
}

res:
{
  "detections": [
    { "prompt": "oat milk carton", "bbox": [0.12, 0.30, 0.22, 0.48], "confidence": 0.88 }
  ]
}

Notes:
- Empty `detections` array is a valid response. Person 1 must handle it.
- Target under 2s. Person 1 shows a placeholder while waiting.

---

## 5. POST /product/analyze
Owner: Person 2. The checklist overlay.

req:
{ "trip_id": "t_001", "item_id": "i1", "image_b64": "..." }

res:
{
  "match": false,
  "product_name": "Chobani Oat Plain",
  "price": 4.29,
  "checklist": [
    { "status": "pass", "text": "unsweetened" },
    { "status": "pass", "text": "$4.29, under her $5" },
    { "status": "fail", "text": "she's had this brand before and didn't like it" }
  ],
  "alternative": {
    "text": "Oatly next to it, $4.79, matches better",
    "bbox": [0.34, 0.31, 0.20, 0.46]
  }
}

Notes:
- `alternative` is null when there isn't one.
- `alternative.bbox` is null when the alternative isn't visible in frame.
- Max 5 checklist lines. Person 1 has limited screen space.
- Keep each `text` under ~50 chars. It renders on a phone, over a product.

---

## 6. POST /item/confirm
Owner: Person 4.

req:
{ "trip_id": "t_001", "item_id": "i1", "product_name": "Oatly Original", "price": 4.79 }

res: full cart object (see §9)

---

## 7. POST /item/substitute
Owner: Person 4. Called when a flexible item gets a non-exact match.

req:
{
  "trip_id": "t_001", "item_id": "i1",
  "product_name": "Silk Oat Unsweetened", "price": 3.99,
  "reason": "Oatly out of stock, this is unsweetened oat, rule allows it"
}

res: full cart object

---

## 8. POST /item/skip
Owner: Person 4. Strict item that couldn't be satisfied.

req:
{ "trip_id": "t_001", "item_id": "i1", "reason": "no unsweetened oat milk in stock" }

res: full cart object

---

## 9. GET /cart?trip_id=t_001
Owner: Person 4. Returned by confirm/substitute/skip too, so callers never re-fetch.

res:
{
  "trip_id": "t_001",
  "budget": 60.00,
  "spent": 21.47,
  "remaining": 38.53,
  "over_budget": false,
  "lines": [
    {
      "item_id": "i1",
      "requester": "Priya",
      "requested": "oat milk",
      "product_name": "Oatly Original",
      "price": 4.79,
      "status": "purchased",
      "note": ""
    }
  ]
}

`note` carries the substitute or skip reason. Empty string otherwise.

---

## 10. POST /checkout
Owner: Person 3.

req:
{ "trip_id": "t_001" }

res:
{
  "ok": true,
  "transaction_id": "vis_abc123",
  "total": 21.47,
  "mode": "live"
}

`mode` is "live" | "token_only" | "mock", matching the Visa fallback ladder.
Frontend shows a small badge for non-live modes. Be honest in the demo.

Failure:
{ "ok": false, "error": "exceeds spend cap", "code": "CAP_EXCEEDED" }

---

## 11. GET /settlement?trip_id=t_001
Owner: Person 3.

res:
{
  "total": 21.47,
  "shared_total": 5.00,
  "per_person": [
    {
      "name": "Priya",
      "owes": 9.28,
      "lines": [
        { "product_name": "Oatly Original", "price": 4.79, "shared": false }
      ],
      "got": ["Oatly Original"],
      "substituted": [],
      "not_found": ["Greek yogurt"]
    }
  ],
  "share_card_text": "$21.47 total\nPriya owes $9.28\n..."
}

`share_card_text` is plain text ready to paste into the group chat.

---

## 12. GET /preferences?requester=Priya
Owner: Person 2 (Backboard).

res:
{
  "requester": "Priya",
  "preferences": [
    { "text": "dislikes Chobani oat", "source": "correction", "trip_id": "t_000" }
  ]
}

## 13. POST /preferences/correction
Owner: Person 2. Called when the runner overrides the AI.

req:
{ "trip_id": "t_001", "requester": "Priya", "text": "prefers Oatly over Chobani" }

res: { "ok": true }

---

## Frontend shared state (Zustand store)

Person 1's AR component reads from and writes to this. Not an API, but binding.

{
  contract_id, trip_id, budget, remaining,
  currentAisle,          // aisle object from /aisles
  pendingItems,          // items with status "pending" in currentAisle
  confirmItem(item_id, product_name, price),   // calls /item/confirm
  substituteItem(...), skipItem(...)
}

The budget bar is ONE shared React component. Person 4 owns it, Person 1
imports it into the WebXR DOM overlay. Do not build it twice.

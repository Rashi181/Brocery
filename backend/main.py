"""
Mock API - matches rulebook.md exactly.
No database. In-memory state, wiped on restart.

Run:  uvicorn main:app --reload --host 0.0.0.0 --port 8000
Docs: http://localhost:8000/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI(title="Mock API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TRIPS = {}


def new_item(id, item, requester, rigidity, spec, reason, sub_rule, priority):
    return {
        "id": id, "item": item, "requester": requester, "rigidity": rigidity,
        "spec": spec, "reason": reason, "substitute_rule": sub_rule,
        "priority": priority, "aisle": None, "aisle_no": None,
    }


# ---------------------------------------------------------------------------
# Test products. These must match the physical objects on your shelf.
#
# Each one exists to exercise a different branch:
#   i1 water bottle  - easy auto-accept, no drama
#   i2 cheetos       - brand preference, warn branch
#   i3 oreos         - price ceiling, pass branch
#   i4 lego set      - price ceiling likely FAILS, over budget branch
#   i5 rubber duck   - COLOR MISMATCH. spec says yellow, shelf has pink.
#                      Nothing here hardcodes the colour check. The spec
#                      just says "yellow". Real Muse vision has to look at
#                      the photo and notice it is pink.
#   i6 dish soap     - requester is None, so it is a SHARED item and gets
#                      split evenly in settlement.
# ---------------------------------------------------------------------------

MOCK_ITEMS = [
    new_item("i1", "water bottle", "Priya", "flexible",
             "any large bottle",
             None,
             "any brand is fine", "must"),

    new_item("i2", "cheetos", "Arjun", "preferred",
             "crunchy, not puffs",
             "he thinks the puffs are for children",
             "any crunchy cheeto variant", "nice"),

    new_item("i3", "oreos", "Priya", "flexible",
             "original, under $5",
             None,
             "any oreo variety if original is gone", "nice"),

    new_item("i4", "lego set", "Arjun", "preferred",
             "small set, under $20, it's a gift",
             "it's for his nephew's birthday on Saturday",
             "any small set in that price range", "must"),

    new_item("i5", "rubber duck", "Priya", "strict",
             "yellow",
             "it has to match the others she already has",
             "no substitute, it must be yellow", "must"),

    new_item("i6", "dish soap", None, "flexible",
             "whatever is cheapest",
             "shared household item",
             "any brand", "must"),
]

AISLE_MAP = {
    "i1": ("Beverages", 2),
    "i2": ("Snacks", 3),
    "i3": ("Snacks", 3),
    "i4": ("Toys", 5),
    "i5": ("Toys", 5),
    "i6": ("Household", 6),
}

# Rough prices so the budget moves realistically before real data exists.
MOCK_PRICES = {
    "i1": 2.49, "i2": 4.29, "i3": 4.79,
    "i4": 17.99, "i5": 3.99, "i6": 3.49,
}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ParseReq(BaseModel):
    raw_text: str


class TripStartReq(BaseModel):
    contract_id: str
    budget: float


class DetectReq(BaseModel):
    image_b64: str
    prompts: List[str]


class AnalyzeReq(BaseModel):
    trip_id: str
    item_id: str
    image_b64: str


class ConfirmReq(BaseModel):
    trip_id: str
    item_id: str
    product_name: str
    price: float


class SubstituteReq(BaseModel):
    trip_id: str
    item_id: str
    product_name: str
    price: float
    reason: str


class SkipReq(BaseModel):
    trip_id: str
    item_id: str
    reason: str


class CheckoutReq(BaseModel):
    trip_id: str


class CorrectionReq(BaseModel):
    trip_id: str
    requester: str
    text: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_trip(trip_id):
    if trip_id not in TRIPS:
        TRIPS[trip_id] = {
            "trip_id": trip_id,
            "budget": 60.00,
            "lines": [
                {"item_id": it["id"], "requester": it["requester"],
                 "requested": it["item"], "product_name": None, "price": 0.0,
                 "status": "pending", "note": ""}
                for it in MOCK_ITEMS
            ],
        }
    return TRIPS[trip_id]


def cart_body(trip):
    spent = round(sum(l["price"] for l in trip["lines"]
                      if l["status"] in ("purchased", "substituted")), 2)
    return {
        "trip_id": trip["trip_id"],
        "budget": trip["budget"],
        "spent": spent,
        "remaining": round(trip["budget"] - spent, 2),
        "over_budget": spent > trip["budget"],
        "lines": trip["lines"],
    }


def set_line(trip_id, item_id, **fields):
    trip = get_trip(trip_id)
    for line in trip["lines"]:
        if line["item_id"] == item_id:
            line.update(fields)
            break
    return cart_body(trip)


def find_item(item_id):
    return next((it for it in MOCK_ITEMS if it["id"] == item_id), None)


# ---------------------------------------------------------------------------
# 1. Chat parse   (PERSON 2 replaces this body with the Muse Spark call)
# ---------------------------------------------------------------------------

@app.post("/api/chat/parse")
def chat_parse(body: ParseReq):
    return {"contract_id": "c_001", "items": MOCK_ITEMS}


# ---------------------------------------------------------------------------
# 2. Trip start
# ---------------------------------------------------------------------------

@app.post("/api/trip/start")
def trip_start(body: TripStartReq):
    trip_id = f"t_{len(TRIPS) + 1:03d}"
    trip = get_trip(trip_id)
    trip["budget"] = body.budget
    return {"trip_id": trip_id, "budget": body.budget}


# ---------------------------------------------------------------------------
# 3. Aisles
# ---------------------------------------------------------------------------

@app.get("/api/aisles")
def aisles(contract_id: str):
    grouped = {}
    for it in MOCK_ITEMS:
        name, no = AISLE_MAP.get(it["id"], ("Pantry", 9))
        filled = dict(it, aisle=name, aisle_no=no)
        grouped.setdefault(no, {"aisle": name, "aisle_no": no, "items": []})
        grouped[no]["items"].append(filled)
    return {"aisles": [grouped[k] for k in sorted(grouped)]}


# ===========================================================================
# PERSON 2 SECTION. Replace these bodies. Do not change the shapes.
# ===========================================================================

@app.post("/api/vision/detect")
def vision_detect(body: DetectReq):
    """MOCK. Real version calls SAM 3.1 with the text prompts."""
    boxes = [[0.10, 0.28, 0.20, 0.44],
             [0.36, 0.26, 0.19, 0.46],
             [0.62, 0.30, 0.21, 0.42]]
    return {"detections": [
        {"prompt": p, "bbox": boxes[i % len(boxes)], "confidence": 0.88}
        for i, p in enumerate(body.prompts)
    ]}


@app.post("/api/product/analyze")
def product_analyze(body: AnalyzeReq):
    """
    MOCK. Builds a plausible checklist by splitting the item's spec on
    commas. It CANNOT actually see the product, so it cannot tell a pink
    duck from a yellow one - it just echoes the spec back as pass lines.

    PERSON 2: the real version sends image_b64 plus the item's spec,
    reason and substitute_rule to Muse Spark vision, and the model decides
    each line. That is what catches the pink duck. Nothing about the
    colour is hardcoded anywhere - the only colour information in the
    system is the word "yellow" in the item's spec, which comes from the
    group chat.
    """
    item = find_item(body.item_id)
    if not item:
        return {"match": False, "product_name": "Unknown", "price": 0.0,
                "checklist": [{"status": "fail", "text": "item not in list"}],
                "alternative": None}

    price = MOCK_PRICES.get(body.item_id, 4.99)

    checklist = [{"status": "pass", "text": f"looks like {item['item']}"}]
    for part in (item.get("spec") or "").split(","):
        part = part.strip()
        if part:
            checklist.append({"status": "pass", "text": part})
    checklist.append({"status": "pass", "text": f"${price:.2f}"})

    return {
        "match": True,
        "product_name": item["item"].title(),
        "price": price,
        "checklist": checklist[:5],
        "alternative": None,
    }


@app.get("/api/preferences")
def preferences(requester: str):
    return {"requester": requester, "preferences": []}


@app.post("/api/preferences/correction")
def preferences_correction(body: CorrectionReq):
    return {"ok": True}


# ---------------------------------------------------------------------------
# 6, 7, 8. Cart mutations
# ---------------------------------------------------------------------------

@app.post("/api/item/confirm")
def item_confirm(body: ConfirmReq):
    return set_line(body.trip_id, body.item_id,
                    product_name=body.product_name, price=body.price,
                    status="purchased", note="")


@app.post("/api/item/substitute")
def item_substitute(body: SubstituteReq):
    return set_line(body.trip_id, body.item_id,
                    product_name=body.product_name, price=body.price,
                    status="substituted", note=body.reason)


@app.post("/api/item/skip")
def item_skip(body: SkipReq):
    return set_line(body.trip_id, body.item_id,
                    product_name=None, price=0.0,
                    status="skipped", note=body.reason)


@app.get("/api/cart")
def cart(trip_id: str):
    return cart_body(get_trip(trip_id))


# ===========================================================================
# PERSON 3 SECTION. Replace these bodies. Do not change the shapes.
# ===========================================================================

@app.post("/api/checkout")
def checkout(body: CheckoutReq):
    c = cart_body(get_trip(body.trip_id))
    if c["over_budget"]:
        return {"ok": False, "error": "exceeds spend cap", "code": "CAP_EXCEEDED"}
    return {"ok": True, "transaction_id": "vis_mock_abc123",
            "total": c["spent"], "mode": "mock"}


@app.get("/api/settlement")
def settlement(trip_id: str):
    trip = get_trip(trip_id)
    bought = [l for l in trip["lines"]
              if l["status"] in ("purchased", "substituted")]

    shared = [l for l in bought if not l["requester"]]
    shared_total = round(sum(l["price"] for l in shared), 2)

    names = sorted({l["requester"] for l in bought if l["requester"]})
    share_each = round(shared_total / len(names), 2) if names else 0.0

    per_person = []
    for name in names:
        mine = [l for l in bought if l["requester"] == name]
        per_person.append({
            "name": name,
            "owes": round(sum(l["price"] for l in mine) + share_each, 2),
            "lines": [{"product_name": l["product_name"], "price": l["price"],
                       "shared": False} for l in mine]
                     + [{"product_name": l["product_name"], "price": share_each,
                         "shared": True} for l in shared],
            "got": [l["product_name"] for l in mine if l["status"] == "purchased"],
            "substituted": [l["product_name"] for l in mine
                            if l["status"] == "substituted"],
            "not_found": [l["requested"] for l in trip["lines"]
                          if l["requester"] == name and l["status"] == "skipped"],
        })

    total = round(sum(l["price"] for l in bought), 2)
    card = f"${total:.2f} total\n" + "\n".join(
        f"{p['name']} owes ${p['owes']:.2f}" for p in per_person)

    return {"total": total, "shared_total": shared_total,
            "per_person": per_person, "share_card_text": card}


@app.get("/api/health")
def health():
    return {"ok": True}
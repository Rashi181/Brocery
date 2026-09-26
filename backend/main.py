"""
Mock API - matches rulebook.md exactly.
No real logic, no database. Returns canned data in the frozen shapes
so Persons 1, 2 and 3 can build against it.

Run:  uvicorn main:app --reload --host 0.0.0.0 --port 8000
Docs: http://localhost:8000/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

app = FastAPI(title="Mock API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory state. Wiped on restart. Replaced by MongoDB later.
# ---------------------------------------------------------------------------

TRIPS = {}


def new_item(id, item, requester, rigidity, spec, reason, sub_rule, priority):
    return {
        "id": id,
        "item": item,
        "requester": requester,
        "rigidity": rigidity,
        "spec": spec,
        "reason": reason,
        "substitute_rule": sub_rule,
        "priority": priority,
        "aisle": None,
        "aisle_no": None,
    }


MOCK_ITEMS = [
    new_item("i1", "oat milk", "Priya", "preferred",
             "unsweetened, under $5",
             "the sweet one made her coffee gross",
             "any unsweetened oat brand ok, almond not ok", "must"),
    new_item("i2", "pasta", "Arjun", "strict",
             "not whole wheat",
             "hated the whole wheat one last time",
             "any regular semolina pasta", "must"),
    new_item("i3", "greek yogurt", "Priya", "flexible",
             "plain, large tub",
             None,
             "any plain greek yogurt", "nice"),
    new_item("i4", "coffee beans", "Arjun", "preferred",
             "medium roast, whole bean",
             "grinds his own",
             "any medium roast whole bean", "must"),
    new_item("i5", "dish soap", None, "flexible",
             "whatever is cheapest",
             "shared household item",
             "any brand", "must"),
]

AISLE_MAP = {
    "i1": ("Dairy", 4),
    "i2": ("Pantry", 6),
    "i3": ("Dairy", 4),
    "i4": ("Beverages", 3),
    "i5": ("Household", 8),
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
                {
                    "item_id": it["id"],
                    "requester": it["requester"],
                    "requested": it["item"],
                    "product_name": None,
                    "price": 0.0,
                    "status": "pending",
                    "note": "",
                }
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


# ---------------------------------------------------------------------------
# 1. Chat parse
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
        name, no = AISLE_MAP.get(it["id"], ("Pantry", 6))
        filled = dict(it, aisle=name, aisle_no=no)
        grouped.setdefault(no, {"aisle": name, "aisle_no": no, "items": []})
        grouped[no]["items"].append(filled)
    return {"aisles": [grouped[k] for k in sorted(grouped)]}


# ---------------------------------------------------------------------------
# 4. Vision detect  (Person 2 replaces this with the real SAM 3.1 call)
# ---------------------------------------------------------------------------

@app.post("/api/vision/detect")
def vision_detect(body: DetectReq):
    boxes = [
        [0.12, 0.30, 0.22, 0.48],
        [0.38, 0.28, 0.20, 0.46],
        [0.64, 0.32, 0.21, 0.44],
    ]
    return {
        "detections": [
            {"prompt": p, "bbox": boxes[i % len(boxes)], "confidence": 0.88}
            for i, p in enumerate(body.prompts)
        ]
    }


# ---------------------------------------------------------------------------
# 5. Product analyze  (Person 2 replaces with real Muse Spark call)
# ---------------------------------------------------------------------------

@app.post("/api/product/analyze")
def product_analyze(body: AnalyzeReq):
    return {
        "match": False,
        "product_name": "Chobani Oat Plain",
        "price": 4.29,
        "checklist": [
            {"status": "pass", "text": "unsweetened"},
            {"status": "pass", "text": "$4.29, under her $5"},
            {"status": "fail", "text": "she didn't like this brand"},
        ],
        "alternative": {
            "text": "Oatly next to it, $4.79, better match",
            "bbox": [0.38, 0.28, 0.20, 0.46],
        },
    }


# ---------------------------------------------------------------------------
# 6, 7, 8. Cart mutations
# ---------------------------------------------------------------------------

@app.post("/api/item/confirm")
def item_confirm(body: ConfirmReq):
    return set_line(body.trip_id, body.item_id,
                    product_name=body.product_name,
                    price=body.price, status="purchased", note="")


@app.post("/api/item/substitute")
def item_substitute(body: SubstituteReq):
    return set_line(body.trip_id, body.item_id,
                    product_name=body.product_name,
                    price=body.price, status="substituted", note=body.reason)


@app.post("/api/item/skip")
def item_skip(body: SkipReq):
    return set_line(body.trip_id, body.item_id,
                    product_name=None, price=0.0,
                    status="skipped", note=body.reason)


# ---------------------------------------------------------------------------
# 9. Cart
# ---------------------------------------------------------------------------

@app.get("/api/cart")
def cart(trip_id: str):
    return cart_body(get_trip(trip_id))


# ---------------------------------------------------------------------------
# 10. Checkout  (Person 3 replaces with real Visa call)
# ---------------------------------------------------------------------------

@app.post("/api/checkout")
def checkout(body: CheckoutReq):
    trip = get_trip(body.trip_id)
    c = cart_body(trip)
    if c["over_budget"]:
        return {"ok": False, "error": "exceeds spend cap", "code": "CAP_EXCEEDED"}
    return {
        "ok": True,
        "transaction_id": "vis_mock_abc123",
        "total": c["spent"],
        "mode": "mock",
    }


# ---------------------------------------------------------------------------
# 11. Settlement  (Person 3 replaces with real split logic)
# ---------------------------------------------------------------------------

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
        owes = round(sum(l["price"] for l in mine) + share_each, 2)
        per_person.append({
            "name": name,
            "owes": owes,
            "lines": (
                [{"product_name": l["product_name"], "price": l["price"],
                  "shared": False} for l in mine]
                + [{"product_name": l["product_name"], "price": share_each,
                    "shared": True} for l in shared]
            ),
            "got": [l["product_name"] for l in mine if l["status"] == "purchased"],
            "substituted": [l["product_name"] for l in mine
                            if l["status"] == "substituted"],
            "not_found": [l["requested"] for l in trip["lines"]
                          if l["requester"] == name and l["status"] == "skipped"],
        })

    total = round(sum(l["price"] for l in bought), 2)
    card = f"${total:.2f} total\n" + "\n".join(
        f"{p['name']} owes ${p['owes']:.2f}" for p in per_person)

    return {
        "total": total,
        "shared_total": shared_total,
        "per_person": per_person,
        "share_card_text": card,
    }


# ---------------------------------------------------------------------------
# 12, 13. Preferences  (Person 2 replaces with Backboard)
# ---------------------------------------------------------------------------

@app.get("/api/preferences")
def preferences(requester: str):
    return {
        "requester": requester,
        "preferences": [
            {"text": "dislikes Chobani oat", "source": "correction",
             "trip_id": "t_000"}
        ],
    }


@app.post("/api/preferences/correction")
def preferences_correction(body: CorrectionReq):
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"ok": True}
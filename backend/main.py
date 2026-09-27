"""AccessCart: Supi's trip API + Meta intelligence + Alex camera client.
Single-process MVP; contracts/trips are in memory, preferences persist locally.
"""

import os
import json
import sys
import time
import uuid
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(Path(__file__).with_name(".env"))
os.environ.setdefault("LLM_MODE", "live")
os.environ.setdefault("SAM_MODE", "live")
os.environ.setdefault("LOCAL_PREF_PATH", str(ROOT / "backend/data/preferences.json"))
sys.path.insert(0, str(ROOT / "person2-intelligence"))
from intelligence import store
from intelligence.router import router, get_llm, get_store, get_detector
from intelligence.schemas import SpecItem, AnalyzeRequest, PreferenceFact
from intelligence.contract import to_spec_response
from intelligence.analyze import analyze_product
from intelligence.vision import image_size, VisionError
from intelligence.errors import install_error_handlers
from intelligence.config import settings

app = FastAPI(title="AccessCart MVP", version="1.0")
install_error_handlers(app)
TRIPS = {}
SCANS = {}
ANALYSES = {}

# Supi's temporary catalog; category mapping is explicitly a demo store layout.
CATALOG = [
    (2, "Beverages", ["bottle", "water", "milk", "coffee", "juice"]),
    (3, "Snacks", ["cheetos", "chips", "oreo", "cracker", "snack", "pasta"]),
    (4, "Produce", ["banana", "apple", "fruit", "vegetable"]),
    (5, "Toys", ["lego", "duck", "toy"]),
    (6, "Household", ["soap", "detergent", "tissue"]),
]


def cents(value):
    return int(
        (Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )


def trip_for(id):
    if id not in TRIPS:
        raise HTTPException(404, "Trip expired or not found. Import your list again.")
    return TRIPS[id]


def member_item(trip_id, item_id):
    trip = trip_for(trip_id)
    item = next((i for i in trip["items"] if i.id == item_id), None)
    if item is None:
        raise HTTPException(404, "This item is not in this trip")
    return trip, item


def cart(trip):
    spent = sum(l["amount_cents"] for l in trip["lines"].values())
    return {
        "trip_id": trip["id"],
        "budget": trip["budget_cents"] / 100,
        "spent": spent / 100,
        "remaining": (trip["budget_cents"] - spent) / 100,
        "over_budget": spent > trip["budget_cents"],
        "lines": list(trip["lines"].values()),
    }


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "llm_mode": settings.llm_mode,
        "sam_mode": settings.sam_mode,
        "key_configured": bool(settings.meta_api_key),
        "catalog": "demo",
        "storage": "session",
        "preferences": type(get_store()).__name__,
    }


class Start(BaseModel):
    contract_id: str
    runner: str = Field(default="Runner", min_length=1, max_length=80)
    budget: float = Field(ge=0, le=100000, allow_inf_nan=False)
    items: list[SpecItem] = Field(min_length=1, max_length=100)


@app.post("/api/trip/start")
def start(body: Start):
    contract = store.get_contract(body.contract_id)
    if not contract:
        raise HTTPException(404, "Import the chat again; this contract expired")
    originals = {i.id: i for i in contract.items}
    if len({i.id for i in body.items}) != len(body.items) or any(
        i.id not in originals for i in body.items
    ):
        raise HTTPException(422, "Invalid or duplicate reviewed item")
    items = []
    for edit in body.items:
        if not edit.item.strip() or not edit.requester.strip():
            raise HTTPException(422, "Each item needs a product and requester")
        updated = originals[edit.id].model_dump()
        updated.update(
            edit.model_dump(
                include={
                    "item",
                    "requester",
                    "rigidity",
                    "avoid",
                    "max_price",
                    "quantity",
                    "shared",
                    "reason",
                    "substitute_rule",
                    "priority",
                }
            )
        )
        updated.update(
            spec=[s.strip() for s in edit.spec.split(";") if s.strip()],
            needs_review=False,
            review_note=None,
        )
        items.append(type(originals[edit.id]).model_validate(updated))
    # Store the reviewed version, not the initial extraction. Snapshot per trip.
    contract = contract.model_copy(deep=True, update={"items": items})
    contract.participants = list(
        dict.fromkeys(contract.participants + [i.requester for i in items])
    )
    store.put_contract(contract)
    id = "t_" + uuid.uuid4().hex
    TRIPS[id] = {
        "id": id,
        "contract_id": contract.contract_id,
        "items": [i.model_copy(deep=True) for i in items],
        "runner": body.runner.strip(),
        "participants": contract.participants,
        "budget_cents": cents(body.budget),
        "lines": {
            i.id: {
                "item_id": i.id,
                "requested": i.item,
                "requester": i.requester,
                "shared": i.shared,
                "quantity": i.quantity,
                "status": "pending",
                "product_name": None,
                "price": None,
                "amount_cents": 0,
                "reason": "",
                "verified": False,
            }
            for i in items
        },
    }
    return {"trip_id": id, "budget": body.budget}


@app.get("/api/aisles")
def aisles(contract_id: str):
    contract = store.get_contract(contract_id)
    if not contract:
        raise HTTPException(404, "Contract not found")
    groups = {}
    for item in to_spec_response(contract).items:
        number, name = next(
            (
                (n, name)
                for n, name, words in CATALOG
                if any(w in item.item.lower() for w in words)
            ),
            (9, "Other"),
        )
        item.aisle, item.aisle_no = name, number
        groups.setdefault(number, {"aisle_no": number, "aisle": name, "items": []})[
            "items"
        ].append(item)
    return {"aisles": [groups[k] for k in sorted(groups)], "catalog": "demo"}


class Scan(BaseModel):
    trip_id: str
    image_b64: str = Field(max_length=7_000_000)
    prompts: list[str] = Field(min_length=1, max_length=6)


@app.post("/api/vision/detect")
async def detect(body: Scan):
    trip_for(body.trip_id)
    if any(not p.strip() or len(p) > 120 for p in body.prompts):
        raise HTTPException(422, "Use 1–6 short product names")
    try:
        image_size(body.image_b64)
        detections = await get_detector().detect(body.image_b64, body.prompts)
    except VisionError as e:
        raise HTTPException(502, str(e)) from None
    for d in detections:
        d.detection_id = d.detection_id or uuid.uuid4().hex
    id = uuid.uuid4().hex
    # Bound retained photos and expire them; never put images in logs or preferences.
    now = time.monotonic()
    for key in list(SCANS):
        if now - SCANS[key]["time"] > 120:
            SCANS.pop(key)
    while len(SCANS) >= 8:
        SCANS.pop(next(iter(SCANS)))
    SCANS[id] = {
        "trip_id": body.trip_id,
        "time": now,
        "image": body.image_b64,
        "detections": detections,
    }
    return {"scan_id": id, "detections": detections}


@app.post("/api/product/analyze")
async def analyze(body: AnalyzeRequest):
    _, item = member_item(body.trip_id, body.item_id)
    try:
        image_size(body.image_b64)
    except VisionError as e:
        raise HTTPException(422, str(e)) from None
    scan = SCANS.get(body.scan_id)
    if scan and (
        scan["trip_id"] != body.trip_id or time.monotonic() - scan["time"] > 120
    ):
        scan = None
    result = await analyze_product(
        item,
        body.image_b64,
        llm=get_llm(),
        pref_store=get_store(),
        candidates=scan["detections"] if scan else None,
        shelf_image=scan["image"] if scan else None,
    )
    result.analysis_id = uuid.uuid4().hex
    ANALYSES[result.analysis_id] = (body.trip_id, body.item_id, result)
    if len(ANALYSES) > 200:
        ANALYSES.pop(next(iter(ANALYSES)))
    return result


class Action(BaseModel):
    trip_id: str
    item_id: str
    product_name: str = Field(default="", max_length=200)
    price: float | None = Field(default=None, ge=0, le=100000, allow_inf_nan=False)
    unit_price: float | None = Field(default=None, ge=0, le=100000, allow_inf_nan=False)
    reason: str = Field(default="", max_length=1000)
    analysis_id: str | None = None
    override: bool = False


async def update_line(body, status):
    trip, item = member_item(body.trip_id, body.item_id)
    if trip.get("finished"):
        raise HTTPException(409, "This run is complete. Start a new run to change it.")
    found = ANALYSES.get(body.analysis_id)
    result = found[2] if found and found[:2] == (body.trip_id, body.item_id) else None
    if status != "skipped":
        if body.price is None or not body.product_name.strip():
            raise HTTPException(
                422, "Confirm product name and total price for the requested quantity"
            )
        price_conflict = item.max_price is not None and (
            body.unit_price is None or body.unit_price > item.max_price
        )
        identity_changed = bool(
            result and body.product_name.strip() != result.product_name.strip()
        )
        if (
            not result
            or not result.match
            or status == "substituted"
            or price_conflict
            or identity_changed
        ) and not (body.override and body.reason.strip()):
            raise HTTPException(
                409, "This needs a recorded human decision before adding"
            )
    previous = trip["lines"][item.id]
    line = {
        **previous,
        "status": status,
        "product_name": body.product_name if status != "skipped" else None,
        "price": body.price if status != "skipped" else None,
        "unit_price": body.unit_price if status != "skipped" else None,
        "price_source": None,
        "purchased_quantity": None,
        "amount_cents": cents(body.price) if status != "skipped" else 0,
        "reason": body.reason,
        "verified": bool(
            result
            and result.match
            and not body.override
            and body.product_name.strip() == result.product_name.strip()
        ),
        "checklist": [c.model_dump() for c in result.checklist] if result else [],
    }
    # Retry-safe: setting this line replaces it; it never adds the amount twice.
    trip["lines"][item.id] = line
    if body.override and body.reason and previous != line:
        await get_store().add(
            PreferenceFact(
                requester=item.requester,
                fact=body.reason,
                item=item.item,
                kind="override",
                source="correction",
                trip_id=body.trip_id,
            )
        )
    return cart(trip)


@app.post("/api/item/confirm")
async def confirm(body: Action):
    return await update_line(body, "purchased")


@app.post("/api/item/substitute")
async def substitute(body: Action):
    return await update_line(body, "substituted")


@app.post("/api/item/skip")
async def skip(body: Action):
    return await update_line(body, "skipped")


class Undo(BaseModel):
    trip_id: str
    item_id: str


@app.post("/api/item/undo")
def undo(body: Undo):
    trip, _ = member_item(body.trip_id, body.item_id)
    if trip.get("finished"):
        raise HTTPException(409, "This run is complete.")
    trip["lines"][body.item_id].update(
        status="pending",
        amount_cents=0,
        product_name=None,
        price=None,
        verified=False,
        reason="",
    )
    return cart(trip)


@app.get("/api/cart")
def get_cart(trip_id: str):
    return cart(trip_for(trip_id))


@app.get("/api/settlement")
def settlement(trip_id: str):
    trip = trip_for(trip_id)
    members = trip["participants"]
    totals = {p: 0 for p in members}
    purchased = [
        l for l in trip["lines"].values() if l["status"] in ("purchased", "substituted")
    ]
    for line in purchased:
        if line["shared"]:
            quotient, remainder = divmod(line["amount_cents"], len(members))
            for index, member in enumerate(members):
                totals[member] += quotient + (index < remainder)
        else:
            totals[line["requester"]] += line["amount_cents"]
    lines = list(trip["lines"].values())
    exact = sum(l["verified"] and l["status"] == "purchased" for l in lines)
    return {
        "runner": trip["runner"],
        "finished": trip.get("finished", False),
        "total": sum(totals.values()) / 100,
        "members": [{"name": p, "amount": n / 100} for p, n in totals.items()],
        "accuracy": round(100 * exact / len(lines)) if lines else 0,
        "verified": exact,
        "requested": len(lines),
        "pending": sum(l["status"] == "pending" for l in lines),
        "lines": lines,
        "score_rule": "Verified exact matches / all requested items; overrides, substitutions and skips earn no exact-match credit.",
    }


# Mount Meta endpoints after our trip-scoped detect/analyze adapters.
# Omit overlapping unscoped routes; keep parsing, preference learning and health.
for route in router.routes:
    if route.path not in ("/vision/detect", "/product/analyze"):
        from fastapi import APIRouter

        group = APIRouter()
        group.routes.append(route)
        app.include_router(group, prefix="/api")


HISTORY_PATH = ROOT / "backend/data/runs.json"


def read_runs():
    if not HISTORY_PATH.exists():
        return []
    return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))


class Finish(BaseModel):
    trip_id: str


@app.post("/api/trip/finish")
def finish(body: Finish):
    trip = trip_for(body.trip_id)
    summary = settlement(body.trip_id)
    history = read_runs()
    if not any(r["trip_id"] == body.trip_id for r in history):
        history.append(
            {
                "trip_id": body.trip_id,
                "runner": trip["runner"],
                "verified": summary["verified"],
                "requested": summary["requested"],
            }
        )
        HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp = HISTORY_PATH.with_suffix(".tmp")
        temp.write_text(json.dumps(history[-500:]), encoding="utf-8")
        temp.replace(HISTORY_PATH)
    trip["finished"] = True
    return settlement(body.trip_id)


@app.get("/api/leaderboard")
def leaderboard():
    grouped = {}
    for run in read_runs():
        row = grouped.setdefault(
            run["runner"],
            {"name": run["runner"], "verified": 0, "requested": 0, "runs": 0},
        )
        row["verified"] += run["verified"]
        row["requested"] += run["requested"]
        row["runs"] += 1
    rows = [
        {
            **r,
            "accuracy": round(100 * r["verified"] / r["requested"])
            if r["requested"]
            else 0,
        }
        for r in grouped.values()
    ]
    return {
        "runners": sorted(rows, key=lambda r: (-r["accuracy"], -r["runs"], r["name"]))
    }


from live import install_live
install_live(app, member_item=member_item, get_llm=get_llm, get_store=get_store, analyses=ANALYSES)


class DemoAdd(BaseModel):
    trip_id: str
    item_id: str
    quote_id: str
    quantity: int = Field(ge=1, le=100)
    acknowledge_unverified: bool = False


@app.post("/api/item/demo-add")
def demo_add(body: DemoAdd):
    from demo_prices import get_quote
    trip, item = member_item(body.trip_id, body.item_id)
    if trip.get("finished"):
        raise HTTPException(409, "This trip is complete")
    quote = get_quote(body.quote_id, body.trip_id, body.item_id)
    if not quote:
        raise HTTPException(409, "Product price expired. Show the product to the camera again.")
    if not body.acknowledge_unverified:
        raise HTTPException(409, "Confirm the demo price and unverified requirements before adding")
    line = trip["lines"][item.id]
    if line["status"] != "pending":
        return cart(trip)  # duplicate taps cannot increase the total
    line.update(status="purchased", product_name=quote["name"],
                price=quote["unit_cents"] * body.quantity / 100,
                amount_cents=quote["unit_cents"] * body.quantity,
                unit_price=quote["unit_cents"] / 100, purchased_quantity=body.quantity,
                price_source="Gemini demo estimate", verified=False,
                reason="Shopper added using a fictional demo price; requirements unverified",
                checklist=[{"text": value, "status": "warn"} for value in [*item.spec, *item.avoid]])
    return cart(trip)

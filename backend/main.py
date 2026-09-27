"""AccessCart: Supi's trip API + Meta intelligence + Alex camera client.
Single-process MVP; contracts/trips are in memory, preferences persist locally.
"""

import os
import json
import re
import sys
import time
import uuid
from datetime import datetime, timezone
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
from catalog import CATALOG

app = FastAPI(title="AccessCart MVP", version="1.0")
install_error_handlers(app)
TRIPS = {}
SCANS = {}
ANALYSES = {}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def catalog_matches(requested: str):
    """Rank catalog rows by explicit name/tag overlap without an LLM call."""
    query = requested.casefold().strip()
    words = set(re.findall(r"[a-z0-9]+", query))
    ranked = []
    for row in CATALOG:
        phrases = [row["name"], *row["tags"]]
        score = 0
        for phrase in phrases:
            candidate = phrase.casefold()
            if candidate == query:
                score = max(score, 100)
            elif candidate in query or query in candidate:
                score = max(score, 50 + len(candidate.split()))
            else:
                score = max(score, len(words & set(re.findall(r"[a-z0-9]+", candidate))))
        if score:
            ranked.append((score, row))
    return [row for _, row in sorted(ranked, key=lambda pair: (-pair[0], pair[1]["name"]))]


def aisle_for(requested: str):
    matches = catalog_matches(requested)
    if not matches:
        return {"aisle_no": 9, "aisle": "Other", "catalog_matches": []}
    best = matches[0]
    return {
        "aisle_no": best["aisle_no"],
        "aisle": best["aisle"],
        "catalog_matches": [
            {"name": row["name"], "price": row["price"]} for row in matches[:3]
        ],
    }


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


def record_consideration(trip_id, item_id, result):
    """Keep a compact, image-free review history for this in-memory trip."""
    trip = trip_for(trip_id)
    history = trip["considered"].setdefault(item_id, [])
    history.append(
        {
            "timestamp": now_iso(),
            "analysis_id": result.analysis_id,
            "product_name": result.product_name,
            "match": result.match,
            "decision": result.decision,
            "price": result.price,
            "checklist": [check.model_dump() for check in result.checklist],
            "alternative": result.alternative.model_dump() if result.alternative else None,
        }
    )
    del history[:-8]


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
    lines = {}
    for item in items:
        location = aisle_for(item.item)
        lines[item.id] = {
            "item_id": item.id,
            "requested": item.item,
            "requester": item.requester,
            "shared": item.shared,
            "quantity": item.quantity,
            "status": "pending",
            "product_name": None,
            "price": None,
            "amount_cents": 0,
            "reason": "",
            "verified": False,
            "aisle": location["aisle"],
            "aisle_no": location["aisle_no"],
            "catalog_matches": location["catalog_matches"],
            "checklist": [],
            "updated_at": now_iso(),
        }
    TRIPS[id] = {
        "id": id,
        "contract_id": contract.contract_id,
        "items": [i.model_copy(deep=True) for i in items],
        "runner": body.runner.strip(),
        "started_at": now_iso(),
        "participants": contract.participants,
        "budget_cents": cents(body.budget),
        "lines": lines,
        "considered": {},
    }
    return {"trip_id": id, "budget": body.budget}


@app.get("/api/aisles")
def aisles(contract_id: str):
    contract = store.get_contract(contract_id)
    if not contract:
        raise HTTPException(404, "Contract not found")
    groups = {}
    for item in to_spec_response(contract).items:
        location = aisle_for(item.item)
        item.aisle, item.aisle_no = location["aisle"], location["aisle_no"]
        groups.setdefault(item.aisle_no, {"aisle_no": item.aisle_no, "aisle": item.aisle, "items": []})[
            "items"
        ].append(item)
    return {"aisles": [groups[k] for k in sorted(groups)], "catalog": "local"}


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
    record_consideration(body.trip_id, body.item_id, result)
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
        "amount_cents": cents(body.price) if status != "skipped" else 0,
        "reason": body.reason,
        "verified": bool(
            result
            and result.match
            and not body.override
            and body.product_name.strip() == result.product_name.strip()
        ),
        "checklist": [c.model_dump() for c in result.checklist] if result else [],
        "updated_at": now_iso(),
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
        updated_at=now_iso(),
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
    outcomes = {
        "exact": exact,
        "substituted": sum(l["status"] == "substituted" for l in lines),
        "skipped": sum(l["status"] == "skipped" for l in lines),
        "pending": sum(l["status"] == "pending" for l in lines),
    }
    by_person = {}
    by_aisle = {}
    considerations = []
    for line in lines:
        person = by_person.setdefault(
            line["requester"], {"requester": line["requester"], "items": [], "exact": 0}
        )
        person["items"].append(
            {key: line[key] for key in ("requested", "status", "product_name", "price", "reason")}
        )
        person["exact"] += int(line["verified"] and line["status"] == "purchased")
        aisle = by_aisle.setdefault(
            line["aisle_no"],
            {"aisle_no": line["aisle_no"], "aisle": line["aisle"], "items": 0, "reviews": 0},
        )
        aisle["items"] += 1
        history = trip["considered"].get(line["item_id"], [])
        aisle["reviews"] += len(history)
        if history:
            considerations.append(
                {
                    "requested": line["requested"],
                    "requester": line["requester"],
                    "aisle": line["aisle"],
                    "attempts": history,
                }
            )
    return {
        "runner": trip["runner"],
        "started_at": trip["started_at"],
        "finished_at": trip.get("finished_at"),
        "finished": trip.get("finished", False),
        "total": sum(totals.values()) / 100,
        "members": [{"name": p, "amount": n / 100} for p, n in totals.items()],
        "accuracy": round(100 * exact / len(lines)) if lines else 0,
        "verified": exact,
        "requested": len(lines),
        "pending": outcomes["pending"],
        "lines": lines,
        "outcomes": outcomes,
        "by_person": list(by_person.values()),
        "by_aisle": [by_aisle[key] for key in sorted(by_aisle)],
        "considerations": considerations,
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
    if not trip.get("finished"):
        trip["finished"] = True
        trip["finished_at"] = now_iso()
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
install_live(
    app,
    member_item=member_item,
    get_llm=get_llm,
    get_store=get_store,
    analyses=ANALYSES,
    record_consideration=record_consideration,
)

"""In-memory contract/item registry, scoped to this process.

WHY THIS EXISTS: the spec's /product/analyze request is only
{trip_id, item_id, image_b64} — no item details. Person 4 owns the durable
database (MongoDB) and trip/cart state; Person 2 never sees /trip/start. So
the only way analyze can know an item's spec/avoid/rigidity/requester is to
remember what /chat/parse already extracted, keyed by item_id.

This is intentionally simple for a hackathon: one Python process, one dict,
data lost on restart. That's fine — a runner's shopping trip happens inside
one continuous run of the backend. If Person 4's deployment restarts the
Person 2 service mid-trip, /chat/parse just needs to run again. Swap this for
a Mongo lookup only if there's spare time; nothing else needs to change (see
get_item / put_contract below — that's the whole interface).

Also holds the last shelf detections from /vision/detect, so /product/analyze
can find a bounding box for a suggested alternative without the spec having a
shelf-image field on that endpoint. Single-runner, single-trip assumption:
fine for a hackathon demo, called out in the README.
"""

from __future__ import annotations

import time
import uuid

from .schemas import Contract, ContractItem, Detection

_contracts: dict[str, Contract] = {}
_items: dict[str, ContractItem] = {}
_last_detections: tuple[float, list[Detection]] = (0.0, [])
DETECTION_TTL_SECONDS = 120  # a shelf scan is only trustworthy for ~2 minutes


def new_contract_id() -> str:
    return f"c_{uuid.uuid4().hex[:8]}"


def new_item_id() -> str:
    return f"i_{uuid.uuid4().hex[:8]}"


def put_contract(contract: Contract) -> None:
    _contracts[contract.contract_id] = contract
    for it in contract.items:
        _items[it.id] = it


def get_contract(contract_id: str) -> Contract | None:
    return _contracts.get(contract_id)


def get_item(item_id: str) -> ContractItem | None:
    return _items.get(item_id)


def record_detections(detections: list[Detection]) -> None:
    global _last_detections
    _last_detections = (time.time(), detections)


def recent_detections() -> list[Detection]:
    ts, detections = _last_detections
    if time.time() - ts > DETECTION_TTL_SECONDS:
        return []
    return detections


def reset() -> None:
    """For tests: clear everything between test cases."""
    global _last_detections
    _contracts.clear()
    _items.clear()
    _last_detections = (0.0, [])

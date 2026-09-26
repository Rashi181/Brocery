import base64

from fastapi.testclient import TestClient

from conftest import FIX
from dev_server import app

client = TestClient(app)


def test_full_flow_over_http():
    r = client.post(
        "/chat/parse", json={"raw_text": (FIX / "sample_chat_ios.txt").read_text()}
    )
    assert r.status_code == 200
    contract = r.json()
    assert (
        set(contract) == {"contract_id", "items", "participants", "unresolved"}
        and len(contract["items"]) == 8
    )
    oat = contract["items"][0]
    assert set(oat) == {
        "id",
        "item",
        "requester",
        "rigidity",
        "spec",
        "reason",
        "substitute_rule",
        "priority",
        "aisle",
        "aisle_no",
        "avoid",
        "max_price",
        "quantity",
        "shared",
        "needs_review",
        "review_note",
        "evidence",
    }

    img = base64.b64encode(b"fake").decode()
    r = client.post(
        "/product/analyze",
        json={"trip_id": "t1", "item_id": oat["id"], "image_b64": img},
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {
        "match",
        "product_name",
        "price",
        "checklist",
        "alternative",
        "analysis_id",
        "decision",
    }

    r = client.post(
        "/vision/detect", json={"image_b64": img, "prompts": ["oat milk carton"]}
    )
    assert r.status_code == 200 and "detections" in r.json()

    r = client.post(
        "/preferences/correction",
        json={"trip_id": "t1", "requester": "Priya", "text": "loves Califia"},
    )
    assert r.status_code == 200 and r.json() == {"ok": True}
    r = client.get("/preferences", params={"requester": "Priya"})
    assert r.status_code == 200
    assert any("Califia" in p["text"] for p in r.json()["preferences"])


def test_every_error_is_exactly_error_and_code():
    r = client.post("/chat/parse", json={"raw_text": "not a chat"})
    assert r.status_code != 200 and set(r.json()) == {"error", "code"}

    r = client.post(
        "/product/analyze",
        json={"trip_id": "t1", "item_id": "nonexistent", "image_b64": "AAAA"},
    )
    assert r.status_code == 404
    assert r.json() == {"error": r.json()["error"], "code": "ITEM_NOT_FOUND"}
    assert "nonexistent" in r.json()["error"]

    r = client.post("/vision/detect", json={"image_b64": "AAAA", "prompts": []})
    assert r.status_code != 200 and set(r.json()) == {"error", "code"}

    r = client.post(
        "/product/analyze", json={"trip_id": "t1"}
    )  # missing required fields
    assert r.status_code == 422 and set(r.json()) == {"error", "code"}
    assert r.json()["code"] == "VALIDATION_ERROR"


def test_item_not_found_is_a_readable_hint_not_a_crash():
    r = client.post(
        "/product/analyze",
        json={"trip_id": "t1", "item_id": "i_ghost", "image_b64": "AAAA"},
    )
    assert r.status_code == 404
    assert "chat/parse" in r.json()["error"]

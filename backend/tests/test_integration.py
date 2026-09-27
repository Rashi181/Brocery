import os
import sys
from pathlib import Path

os.environ["LLM_MODE"] = "mock"
os.environ["SAM_MODE"] = "mock"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
import pytest
from fastapi.testclient import TestClient
from intelligence.schemas import (
    Contract,
    ContractItem,
    LLMAnalysis,
    LLMCheck,
    LLMAlternative,
    Detection,
)
from intelligence.router import reset_singletons
from intelligence.analyze import finalize_analysis
from PIL import Image
from io import BytesIO
import base64

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def clean(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_MODE", "mock")
    monkeypatch.setenv("SAM_MODE", "mock")
    monkeypatch.setenv("LOCAL_PREF_PATH", str(tmp_path / "prefs.json"))
    monkeypatch.setattr(main, "HISTORY_PATH", tmp_path / "runs.json")
    main.TRIPS.clear()
    main.SCANS.clear()
    main.ANALYSES.clear()
    main.store.reset()
    reset_singletons()


def begin(shared=False):
    item = ContractItem(
        id="i1",
        contract_id="c1",
        item="chips",
        requester="Alex",
        spec=["crunchy"],
        avoid=["dairy"],
        shared=shared,
    )
    main.store.put_contract(
        Contract(contract_id="c1", participants=["Alex", "Priya", "Sam"], items=[item])
    )
    wire = main.to_spec_response(main.store.get_contract("c1")).items[0].model_dump()
    wire["spec"] = "plain; crunchy"
    wire["avoid"] = ["dairy", "peanuts"]
    wire["quantity"] = "2 bags"
    r = client.post(
        "/api/trip/start", json={"contract_id": "c1", "budget": 10, "items": [wire]}
    )
    assert r.status_code == 200, r.text
    return r.json()["trip_id"]


def photo():
    output = BytesIO()
    Image.new("RGB", (64, 64), "red").save(output, "JPEG")
    return base64.b64encode(output.getvalue()).decode()


def test_review_edits_are_the_analysis_contract():
    trip = begin()
    _, item = main.member_item(trip, "i1")
    assert (
        item.spec == ["plain", "crunchy"]
        and item.avoid == ["dairy", "peanuts"]
        and item.quantity == "2 bags"
    )
    data = client.post(
        "/api/product/analyze",
        json={"trip_id": trip, "item_id": "i1", "image_b64": photo()},
    )
    assert data.status_code == 200, data.text
    assert any("peanuts" in c["text"] for c in data.json()["checklist"])


def test_unknown_is_not_match_and_strict_conflict_skips():
    begin()
    item = main.store.get_item("i1")
    result = finalize_analysis(
        item, LLMAnalysis(product_name="unknown", checks=[]), observed_price=None
    )
    assert not result.match and result.decision == "review"
    item.rigidity = "strict"
    result = finalize_analysis(
        item,
        LLMAnalysis(
            product_name="chips",
            checks=[
                LLMCheck(
                    criterion="dairy",
                    kind="avoid",
                    status="fail",
                    detail="Contains milk",
                )
            ],
        ),
        observed_price=None,
    )
    assert result.decision == "skip"


def test_cross_trip_item_and_stale_shelf_are_not_reused():
    trip = begin()
    r = client.post(
        "/api/product/analyze",
        json={"trip_id": "other", "item_id": "i1", "image_b64": photo()},
    )
    assert r.status_code == 404
    # Global legacy detections must never ground a suggestion.
    main.store.record_detections(
        [Detection(prompt="replacement", bbox=[0, 0, 0.5, 0.5], detection_id="foreign")]
    )
    result = finalize_analysis(
        main.store.get_item("i1"),
        LLMAnalysis(
            product_name="bad",
            checks=[],
            alternative=LLMAlternative(
                product_name="replacement", reason="better", detection_id="foreign"
            ),
        ),
        observed_price=None,
    )
    assert result.alternative is None


def test_confirm_requires_decision_and_is_retry_safe_and_undoable():
    trip = begin()
    payload = {"trip_id": trip, "item_id": "i1", "product_name": "Chips", "price": 4.01}
    assert client.post("/api/item/confirm", json=payload).status_code == 409
    payload.update(
        override=True, reason="Alex approved this replacement after checking the label"
    )
    for _ in range(2):
        result = client.post("/api/item/confirm", json=payload)
        assert result.status_code == 200, result.text
        assert result.json()["spent"] == 4.01
    assert (
        len(__import__("json").loads(Path(os.environ["LOCAL_PREF_PATH"]).read_text()))
        == 1
    )
    assert (
        client.post("/api/item/undo", json={"trip_id": trip, "item_id": "i1"}).json()[
            "spent"
        ]
        == 0
    )


def test_shared_split_reconciles_every_cent_across_all_members():
    trip = begin(shared=True)
    client.post(
        "/api/item/confirm",
        json={
            "trip_id": trip,
            "item_id": "i1",
            "product_name": "Chips",
            "price": 4.01,
            "override": True,
            "reason": "Shared purchase approved",
        },
    )
    data = client.get("/api/settlement", params={"trip_id": trip}).json()
    assert [m["amount"] for m in data["members"]] == [1.34, 1.34, 1.33]
    assert data["total"] == 4.01 and data["accuracy"] == 0


def test_local_catalog_and_trip_summary_keep_aisle_and_review_history():
    trip = begin()
    line = main.TRIPS[trip]["lines"]["i1"]
    assert line["aisle"] == "Snacks & Candy" and line["aisle_no"] == 2
    assert line["catalog_matches"][0]["name"] == "Cheetos Crunchy"
    main.TRIPS[trip]["considered"]["i1"] = [
        {
            "timestamp": "2026-09-27T12:00:00+00:00",
            "analysis_id": "a1",
            "product_name": "Cheetos Crunchy",
            "match": False,
            "decision": "review",
            "price": 2.99,
            "checklist": [],
            "alternative": None,
        }
    ]
    data = client.get("/api/settlement", params={"trip_id": trip}).json()
    assert data["by_aisle"] == [
        {"aisle_no": 2, "aisle": "Snacks & Candy", "items": 1, "reviews": 1}
    ]
    assert data["considerations"][0]["attempts"][0]["product_name"] == "Cheetos Crunchy"


def test_live_detector_request_is_trip_scoped_and_invalid_image_rejected():
    trip = begin()
    r = client.post(
        "/api/vision/detect",
        json={"trip_id": trip, "image_b64": "bad", "prompts": ["chips"]},
    )
    assert r.status_code == 502
    r = client.post(
        "/api/vision/detect",
        json={"trip_id": trip, "image_b64": photo(), "prompts": ["oat milk"]},
    )
    assert r.status_code == 200, r.text
    assert main.SCANS[r.json()["scan_id"]]["trip_id"] == trip


def test_negative_money_rejected_and_no_payment_route():
    trip = begin()
    assert (
        client.post(
            "/api/item/confirm", json={"trip_id": trip, "item_id": "i1", "price": -1}
        ).status_code
        == 422
    )
    assert client.post("/api/checkout", json={"trip_id": trip}).status_code == 404


def test_dairy_declaration_overrides_inconsistent_ai_pass():
    begin()
    item = main.store.get_item("i1")
    checks = [
        LLMCheck(criterion=c, status="pass", kind=k)
        for k, values in [
            ("spec", ["product identity", *item.spec]),
            ("avoid", item.avoid),
        ]
        for c in values
    ]
    result = finalize_analysis(
        item,
        LLMAnalysis(
            product_name="chips",
            checks=checks,
            visible_text="CONTAINS MILK INGREDIENTS.",
        ),
        observed_price=None,
    )
    assert not result.match and any(
        c.status == "fail" and "milk" in c.text for c in result.checklist
    )


def test_finish_records_once_and_freezes_basket():
    trip = begin()
    for _ in range(2):
        response = client.post("/api/trip/finish", json={"trip_id": trip})
        assert response.status_code == 200 and response.json()["finished"]
    scores = client.get("/api/leaderboard").json()["runners"]
    assert len(scores) == 1 and scores[0]["runs"] == 1
    assert (
        client.post(
            "/api/item/undo", json={"trip_id": trip, "item_id": "i1"}
        ).status_code
        == 409
    )

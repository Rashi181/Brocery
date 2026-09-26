import asyncio

import pytest

from intelligence.mocks import MockSAM
from intelligence.vision import SAMDetector, VisionError, _valid, build_detector
from intelligence.schemas import Detection


def test_mock_detects_known_keyword():
    dets = asyncio.run(MockSAM().detect("img", ["a carton of oat milk on the shelf"]))
    assert len(dets) == 1 and dets[0].bbox == [0.10, 0.20, 0.22, 0.55]


def test_mock_skips_unknown_prompt():
    assert asyncio.run(MockSAM().detect("img", ["a live giraffe"])) == []


def test_valid_bbox_bounds():
    ok = Detection(prompt="p", bbox=[0.1, 0.1, 0.5, 0.5], confidence=0.9)
    bad_w = Detection(prompt="p", bbox=[0.1, 0.1, 0.0, 0.5], confidence=0.9)
    bad_range = Detection(prompt="p", bbox=[0.9, 0.1, 0.5, 0.5], confidence=0.9)
    assert _valid(ok) and not _valid(bad_w) and not _valid(bad_range)


def test_build_detector_respects_mode(monkeypatch):
    monkeypatch.setenv("SAM_MODE", "mock")
    assert isinstance(build_detector(), MockSAM)
    monkeypatch.setenv("SAM_MODE", "live")
    assert isinstance(build_detector(), SAMDetector)


def test_live_call_wraps_http_errors(monkeypatch):
    monkeypatch.setenv("SAM_MODE", "live")
    monkeypatch.setenv("SAM_ENDPOINT_URL", "https://example.invalid/detect")

    async def boom(*a, **kw):
        raise RuntimeError("connection refused")

    import httpx
    monkeypatch.setattr(httpx.AsyncClient, "post", boom)
    with pytest.raises(VisionError):
        asyncio.run(SAMDetector().detect("img", ["oat milk"]))


def test_out_of_range_detection_from_live_api_is_dropped(monkeypatch):
    monkeypatch.setenv("SAM_MODE", "live")
    monkeypatch.setenv("SAM_ENDPOINT_URL", "https://example.invalid/detect")

    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {"detections": [{"prompt": "p", "bbox": [0.1, 0.1, 2.0, 0.5], "confidence": 0.9}]}

    async def fake_post(*a, **kw):
        return FakeResp()

    import httpx
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    dets = asyncio.run(SAMDetector().detect("img", ["oat milk"]))
    assert dets == []  # w=2.0 is invalid, dropped rather than trusted blindly

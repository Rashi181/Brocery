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


def test_invalid_image_is_rejected_before_api_call():
    with pytest.raises(VisionError, match="valid image"):
        asyncio.run(SAMDetector().detect("img", ["oat milk"]))


def test_all_prompts_are_called_and_masks_use_xywh(monkeypatch):
    import base64
    from io import BytesIO
    from PIL import Image
    import httpx
    import intelligence.vision as vision

    monkeypatch.setenv("SAM_API_KEY", "test-key")
    monkeypatch.setenv("SAM_ENDPOINT_URL", "https://example.invalid")
    image = BytesIO()
    Image.new("RGB", (10, 10)).save(image, "JPEG")
    seen = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"status": "completed"}

    async def post(self, url, **kwargs):
        seen.append(kwargs["json"]["input"][0]["content"][0]["text"])
        return Response()

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    monkeypatch.setattr(
        vision,
        "parse_masks",
        lambda p, w, h, prompt: [Detection(prompt=prompt, bbox=[0.1, 0.2, 0.3, 0.4])],
    )
    result = asyncio.run(
        SAMDetector().detect(
            base64.b64encode(image.getvalue()).decode(), ["bottle", "chips", "duck"]
        )
    )
    assert sorted(seen) == ["bottle", "chips", "duck"]
    assert len(result) == 3 and all(d.confidence is None for d in result)

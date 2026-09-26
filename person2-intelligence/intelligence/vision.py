"""SAM Responses adapter using Alex's tested one-bit mask decoder."""

import asyncio
import base64
from io import BytesIO
import uuid
import httpx
from PIL import Image
from .config import settings
from .schemas import Detection


class VisionError(RuntimeError):
    pass


def image_size(value):
    try:
        raw = base64.b64decode(value.split(",", 1)[-1], validate=True)
        if len(raw) > 5 * 1024 * 1024:
            raise ValueError("Image exceeds 5 MB")
        with Image.open(BytesIO(raw)) as im:
            if im.width * im.height > 4_000_000:
                raise ValueError("Image exceeds 4 million pixels")
            im.load()
            return im.size
    except Exception as e:
        raise VisionError("Use a valid image under 5 MB and 4 million pixels") from e


def _valid(d):
    if len(d.bbox) != 4:
        return False
    x, y, w, h = d.bbox
    return (
        0 <= x < 1
        and 0 <= y < 1
        and 0 < w <= 1
        and 0 < h <= 1
        and x + w <= 1.001
        and y + h <= 1.001
    )


def parse_masks(payload, width, height, prompt):
    from meta_sam_parser import (
        CompletedOutcome,
        image_segmentation_format,
        decode_mask_to_raster,
    )

    if payload.get("status") != "completed":
        raise VisionError("SAM response incomplete; retry the scan")
    text = payload.get("output_text") or "".join(
        c.get("text", "")
        for o in payload.get("output", [])
        for c in o.get("content", [])
        if c.get("type") == "output_text"
    )
    parser = image_segmentation_format().create_parser()
    parser.push(text)
    result = parser.finish(CompletedOutcome()).result
    if result.diagnostics or any(r.kind == "text" for r in result.records):
        raise VisionError("SAM returned an unreadable segmentation")
    detections = []
    for record in result.records:
        if record.kind != "mask":
            continue
        b = record.bounds
        left, top, right, bottom = map(round, (b.left, b.top, b.right, b.bottom))
        if not (0 <= left < right <= width and 0 <= top < bottom <= height):
            raise VisionError("SAM mask coordinates are out of range")
        mask = record.mask
        if mask.width * mask.height > 4_000_000:
            raise VisionError("SAM mask too large")
        alpha = Image.frombytes(
            "L", (mask.width, mask.height), decode_mask_to_raster(mask)
        ).point(lambda x: 85 if x else 0)
        # Cropped alpha PNG. Browser positions it using the same normalized box.
        patch = Image.new("RGBA", alpha.size, (94, 234, 170, 0))
        patch.putalpha(alpha)
        output = BytesIO()
        patch.save(output, "PNG")
        detections.append(
            Detection(
                prompt=prompt,
                bbox=[
                    left / width,
                    top / height,
                    (right - left) / width,
                    (bottom - top) / height,
                ],
                detection_id=uuid.uuid4().hex,
                mask="data:image/png;base64,"
                + base64.b64encode(output.getvalue()).decode(),
            )
        )
    return detections


class SAMDetector:
    async def detect(self, image_b64, prompts):
        width, height = image_size(image_b64)
        if not settings.sam_api_key:
            raise VisionError("Set SAM_API_KEY in backend/.env")
        semaphore = asyncio.Semaphore(2)
        async with httpx.AsyncClient(timeout=90) as client:

            async def one(prompt):
                async with semaphore:
                    try:
                        response = await client.post(
                            settings.sam_endpoint_url
                            or "https://api.meta.ai/v1/responses",
                            headers={"Authorization": "Bearer " + settings.sam_api_key},
                            json={
                                "model": "sam-3.1",
                                "stream": False,
                                "metadata": {"mask_encoding": "one_bit"},
                                "input": [
                                    {
                                        "type": "message",
                                        "role": "user",
                                        "content": [
                                            {"type": "input_text", "text": prompt},
                                            {
                                                "type": "input_image",
                                                "image_url": image_b64
                                                if image_b64.startswith("data:")
                                                else "data:image/jpeg;base64,"
                                                + image_b64,
                                            },
                                        ],
                                    }
                                ],
                            },
                        )
                        response.raise_for_status()
                        return parse_masks(response.json(), width, height, prompt)
                    except httpx.HTTPStatusError as e:
                        raise VisionError(
                            f"Meta SAM HTTP {e.response.status_code}; check API access and credits"
                        ) from None
                    except httpx.RequestError:
                        raise VisionError(
                            "SAM connection timed out or failed; retry"
                        ) from None

            groups = await asyncio.gather(*(one(p) for p in dict.fromkeys(prompts)))
        return [d for group in groups for d in group if _valid(d)]


def build_detector():
    if settings.sam_mode == "live":
        return SAMDetector()
    from .mocks import MockSAM

    return MockSAM()

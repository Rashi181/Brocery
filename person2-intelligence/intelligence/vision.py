"""Wraps SAM 3.1 for POST /vision/detect.

WHY THIS FILE EXISTS SEPARATELY: there is no single documented "Meta Model
API" endpoint for SAM 3.1 the way there is for Muse Spark text/vision — real
hosted access varies by provider (Meta's own dashboard, Roboflow, fal.ai all
expose different request shapes). Rather than guess wrong and hide it, every
assumption about the live API is isolated in `_call_sam_live()` below. That is
the ONLY function you need to edit once you have real access at the event.

Everything else (the router, Person 1's contract, the mock) does not change.

    SAM_MODE=mock   (default) -> fixtures/mock_llm/detections.json, keyword match
    SAM_MODE=live             -> calls _call_sam_live()

Two live paths are stubbed:
  A) A dedicated SAM host (Roboflow/fal/etc) with its own request/response shape
     -> fill in _call_sam_live() directly with that host's format.
  B) Muse Spark's own vision, asked to return boxes -> _call_sam_via_muse()
     is a working fallback if the event's Meta Model API doesn't expose SAM
     as a separate endpoint. Less precise than real SAM, but demo-safe.
Try A first; if there's no SAM endpoint to point at, switch to B by setting
SAM_MODE=live and leaving SAM_ENDPOINT_URL empty (the code falls through
to Muse automatically — see build_vision() below).
"""
from __future__ import annotations

import logging
from typing import Protocol

import httpx

from .config import settings
from .llm import LLMError, to_data_url
from .prompts import DETECT_SYSTEM, detect_user
from .schemas import Detection

log = logging.getLogger("intelligence.vision")


class VisionError(RuntimeError):
    pass


class Detector(Protocol):
    async def detect(self, image_b64: str, prompts: list[str]) -> list[Detection]: ...


def _clip01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _valid(d: Detection) -> bool:
    x, y, w, h = d.bbox
    return len(d.bbox) == 4 and 0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1 and x + w <= 1.05 and y + h <= 1.05


class SAMDetector:
    async def detect(self, image_b64: str, prompts: list[str]) -> list[Detection]:
        if not prompts:
            return []
        if settings.sam_endpoint_url:
            raw = await self._call_sam_live(image_b64, prompts)
        else:
            log.warning("SAM_ENDPOINT_URL not set; falling back to Muse Spark vision for detection "
                       "(works for the demo, not a substitute for real SAM before the event)")
            raw = await self._call_sam_via_muse(image_b64, prompts)
        out = [d for d in raw if _valid(d)]
        dropped = len(raw) - len(out)
        if dropped:
            log.warning("dropped %d detection(s) with out-of-range bbox", dropped)
        return out

    async def _call_sam_live(
    self,
    image_b64: str,
    prompts: list[str]
) -> list[Detection]:
        """Call Meta SAM 3.1 through the Responses API.

        SAM 3.1 returns bounding boxes inside output_text using a format like:

        <0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|>...

    We convert those pixel coordinates into normalized
    [x1, y1, x2, y2] coordinates for the rest of Sidekick."""

        import base64
        import re

        if not settings.sam_api_key:
            raise VisionError("SAM_API_KEY is not configured")

        if not settings.sam_endpoint_url:
            raise VisionError("SAM_ENDPOINT_URL is not configured")

    # ---------------------------------------------------------
    # Convert raw base64 into a data URL that the Responses API
    # can consume as an input_image.
    # ---------------------------------------------------------
        if image_b64.startswith("data:image/"):
            image_url = image_b64
        else:
            try:
                raw = base64.b64decode(image_b64)

                if raw.startswith(b"\x89PNG"):
                    mime = "image/png"
                elif raw.startswith(b"\xff\xd8\xff"):
                    mime = "image/jpeg"
                elif raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
                    mime = "image/webp"
                else:
                    # Most camera/image pipelines will be JPEG or PNG.
                    mime = "image/jpeg"

                image_url = f"data:{mime};base64,{image_b64}"

            except Exception as e:
                raise VisionError(
                    f"Invalid base64 image: {type(e).__name__}: {str(e)[:200]}"
                ) from e

    # ---------------------------------------------------------
    # SAM's recommended prompting style is one object/concept
    # per request, so make one request for each prompt.
    # ---------------------------------------------------------
        async def detect_prompt(prompt: str) -> list[Detection]:
            headers = {
                "Authorization": f"Bearer {settings.sam_api_key}",
                "Content-Type": "application/json",
            }

            payload = {
                "model": "sam-3.1",
                "input": [
                    {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": prompt,
                            },
                            {
                                "type": "input_image",
                                "image_url": image_url,
                            },
                        ],
                    }
                ],
                "stream": False,
            }

            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        settings.sam_endpoint_url,
                        headers=headers,
                        json=payload,
                    )
                    resp.raise_for_status()
                    data = resp.json()

            except Exception as e:
                raise VisionError(
                    f"SAM call failed for '{prompt}': "
                    f"{type(e).__name__}: {str(e)[:300]}"
                ) from e

        # -----------------------------------------------------
        # The Responses API puts SAM's segmentation grammar in
        # output_text.
        # -----------------------------------------------------
            output_text = data.get("output_text", "")

            print("\n===== RAW SAM RESPONSE =====")
            print(data)
            print("===== END RAW SAM RESPONSE =====\n")

            if not output_text:
                # Some Responses API representations expose output
                # through the output array instead.
                pieces = []

                for item in data.get("output", []):
                    for content in item.get("content", []):
                        if content.get("type") == "output_text":
                            pieces.append(content.get("text", ""))

                output_text = "".join(pieces)

            if not output_text:
                return []

        # -----------------------------------------------------
        # Example:
        #
        # <|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|>
        #
        # x1/y1/x2/y2 are pixel coordinates.
        # w/h are the source image dimensions.
        # -----------------------------------------------------
            box_pattern = re.compile(
                r"<\|box;"
                r"x1=(?P<x1>-?\d+(?:\.\d+)?);"
                r"y1=(?P<y1>-?\d+(?:\.\d+)?);"
                r"x2=(?P<x2>-?\d+(?:\.\d+)?);"
                r"y2=(?P<y2>-?\d+(?:\.\d+)?);"
                r"w=(?P<w>-?\d+(?:\.\d+)?);"
                r"h=(?P<h>-?\d+(?:\.\d+)?)"
                r"\|>"
            )

            detections: list[Detection] = []

            for match in box_pattern.finditer(output_text):
                x1 = float(match.group("x1"))
                y1 = float(match.group("y1"))
                x2 = float(match.group("x2"))
                y2 = float(match.group("y2"))
                width = float(match.group("w"))
                height = float(match.group("h"))

                if width <= 0 or height <= 0:
                    continue

                # Convert pixel coordinates → normalized coordinates.
                bbox = [
                    max(0.0, min(1.0, x1 / width)),
                    max(0.0, min(1.0, y1 / height)),
                    max(0.0, min(1.0, x2 / width)),
                    max(0.0, min(1.0, y2 / height)),
                ]

                detections.append(
                    Detection(
                        prompt=prompt,
                        bbox=bbox,
                        # SAM's box grammar does not expose a confidence
                        # value in the documented response format.
                        confidence=1.0,
                    )
                )

            return detections

    # ---------------------------------------------------------
    # Query each requested object.
    # ---------------------------------------------------------
        out: list[Detection] = []

        for prompt in prompts:
            prompt = prompt.strip()

            if not prompt:
                    continue

            detections = await detect_prompt(prompt)
            out.extend(detections)

            return out
            

    async def _call_sam_via_muse(self, image_b64: str, prompts: list[str]) -> list[Detection]:
        """Fallback: ask Muse Spark's vision to locate the same prompts. Less
        precise than real SAM (no true segmentation, just a box estimate) but
        keeps the AR demo working end to end if a dedicated SAM endpoint
        isn't available at the event."""
        from .llm import build_llm
        from pydantic import BaseModel

        class _Out(BaseModel):
            detections: list[Detection]

        llm = build_llm()
        try:
            out = await llm.json_call(task="detect", system=DETECT_SYSTEM, text=detect_user(prompts),
                                      out_model=_Out, images=[image_b64])
        except LLMError as e:
            raise VisionError(str(e)) from e
        return out.detections


def build_detector() -> Detector:
    if settings.sam_mode == "live":
        return SAMDetector()
    from .mocks import MockSAM

    return MockSAM()

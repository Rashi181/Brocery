"""Test 9: receive and decode a camera JPEG without retaining it on disk."""
import hashlib
import base64
import os
import asyncio
import time
from pathlib import Path
import httpx
from dotenv import load_dotenv
from meta_sam_parser import CompletedOutcome, image_segmentation_format, decode_mask_to_raster
from io import BytesIO

from fastapi import FastAPI, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from chat_contract import router as chat_router

load_dotenv(Path(__file__).with_name(".env"))
segment_lock = asyncio.Lock()

app = FastAPI(title="AccessCart camera bridge")
app.include_router(chat_router)
MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 4_000_000


@app.get("/api/health")
def health():
    return {"ok": True, "service": "AccessCart FastAPI", "sam_configured": bool(os.getenv("SAM_API_KEY", "").strip())}


async def read_jpeg(request: Request):
    if request.headers.get("content-type", "").split(";")[0].strip() != "image/jpeg":
        raise HTTPException(415, "Send a JPEG image")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "Image exceeds 5 MB")
        data.extend(chunk)
    if not data:
        raise HTTPException(400, "Image is empty")
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format != "JPEG":
                raise HTTPException(415, "The uploaded image is not a JPEG")
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise HTTPException(413, "Image exceeds 4 million pixels")
            image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(400, "Invalid or damaged JPEG") from None
    return bytes(data), width, height


@app.post("/api/frames")
async def receive_frame(request: Request):
    data, width, height = await read_jpeg(request)
    return {
        "ok": True,
        "message": "Camera frame received and decoded",
        "width": width,
        "height": height,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def parse_segmentation(payload, width, height):
    if payload.get("status") != "completed":
        raise HTTPException(502, "SAM did not finish the response. Try again.")
    text = "".join(part.get("text", "") for item in payload.get("output", [])
                   for part in item.get("content", []) if part.get("type") == "output_text")
    parser = image_segmentation_format().create_parser()
    parser.push(text)
    result = parser.finish(CompletedOutcome()).result
    if result.diagnostics or any(r.kind == "text" for r in result.records):
        raise HTTPException(502, "SAM returned an unreadable segmentation result.")
    overlay = Image.new("RGBA", (width, height))
    objects = []
    colors = [(124, 255, 178), (255, 180, 70), (120, 170, 255), (255, 110, 180)]
    for record in result.records:
        if record.kind != "mask":
            continue
        mask = record.mask
        if mask.width * mask.height > MAX_PIXELS:
            raise HTTPException(502, "SAM mask is too large")
        raster = decode_mask_to_raster(mask)
        alpha = Image.frombytes("L", (mask.width, mask.height), raster).point(lambda x: 110 if x else 0)
        b = record.bounds
        left, top, right, bottom = map(round, (b.left, b.top, b.right, b.bottom))
        if not (0 <= left < right <= width and 0 <= top < bottom <= height):
            raise HTTPException(502, "SAM returned out-of-range mask coordinates")
        alpha = alpha.resize((right-left, bottom-top), Image.Resampling.NEAREST)
        color = colors[len(objects) % len(colors)]
        patch = Image.new("RGBA", alpha.size, (*color, 0))
        patch.putalpha(alpha)
        overlay.alpha_composite(patch, (left, top))
        objects.append({"id": record.object_id, "box": [left, top, right, bottom]})
    output = BytesIO()
    overlay.save(output, "PNG")
    return objects, "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


@app.post("/api/segment")
async def segment(request: Request, prompt: str = "bottle"):
    prompt = prompt.strip()
    if not prompt or len(prompt) > 120:
        raise HTTPException(400, "Enter one short object name (1–120 characters)")
    data, width, height = await read_jpeg(request)
    key = os.getenv("SAM_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Set SAM_API_KEY in backend/.env and restart FastAPI")
    if segment_lock.locked():
        raise HTTPException(429, "A segmentation is already running. Wait and retry.")
    started = time.perf_counter()
    async with segment_lock:
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                response = await client.post("https://api.meta.ai/v1/responses",
                    headers={"Authorization": "Bearer " + key},
                    json={"model": "sam-3.1", "stream": False,
                          "metadata": {"mask_encoding": "one_bit"},
                          "input": [{"type": "message", "role": "user", "content": [
                              {"type": "input_text", "text": prompt},
                              {"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(data).decode()}
                          ]}]})
        except httpx.TimeoutException:
            raise HTTPException(504, "Meta SAM timed out. Try again.") from None
        except httpx.RequestError:
            raise HTTPException(502, "Cannot connect to Meta SAM. Check internet access.") from None
        if not response.is_success:
            messages = {401: "Meta rejected the API key. Check SAM_API_KEY.",
                        403: "Your Meta project does not have access to SAM 3.1.",
                        429: "Meta quota or rate limit reached. Check your credits and limits.",
                        402: "Meta requires credits for this request."}
            raise HTTPException(502, messages.get(response.status_code, "Meta SAM request failed (HTTP " + str(response.status_code) + ")."))
        try:
            objects, overlay = parse_segmentation(response.json(), width, height)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(502, "Could not decode SAM masks. Check model response compatibility.") from None
    return {"ok": True, "width": width, "height": height, "objects": objects,
            "overlay": overlay, "prompt": prompt, "elapsed_ms": round((time.perf_counter()-started)*1000)}


@app.post("/api/product/read")
async def read_product(request: Request):
    from product_label import read_label
    data, _, _ = await read_jpeg(request)
    return await read_label(data)

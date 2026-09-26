"""CHECK 0 (hour 0-1): can we reach Muse Spark, real SAM, and Backboard at all?

    LLM_MODE=live python checks/check_0_env.py
    LLM_MODE=live SAM_MODE=live python checks/check_0_env.py
    LLM_MODE=live PREF_MODE=backboard python checks/check_0_env.py
"""
import asyncio
import time

from common import OUT, done, img_b64, live, mode_banner, ok, section, settings
from pydantic import BaseModel


class Ping(BaseModel):
    answer: str
    number: int


class Read(BaseModel):
    brand: str
    sweetened: bool
    price: float | None = None


async def muse() -> None:
    from intelligence.llm import LLMError, MuseLLM

    section("Muse Spark: text JSON")
    try:
        llm = MuseLLM()
    except LLMError as e:
        ok(False, "client created", str(e))
        return
    t0 = time.perf_counter()
    try:
        r = await llm.json_call(task="ping", system="You are a test endpoint.",
                                text="Reply with answer='pong' and number=42.", out_model=Ping)
        ok(r.answer.lower() == "pong" and r.number == 42, f"got {r.model_dump()} in {time.perf_counter()-t0:.1f}s")
        ok(llm._structured_ok, "structured output accepted by API",
           "Fell back to prompt-only JSON. Fine, but expect slightly more retries.", soft=True)
    except LLMError as e:
        msg = str(e)
        ok(False, "text call", msg)
        if "reasoning" in msg.lower():
            print("       → set MUSE_REASONING_EFFORT= (empty) in .env and rerun")
        if "model" in msg.lower():
            print("       → check MUSE_MODEL matches the id in your Meta Model API dashboard")
        return

    section("Muse Spark: vision (reads a fake Oatly carton)")
    t0 = time.perf_counter()
    try:
        r = await llm.json_call(task="ping_vision", system="Read the grocery package in the image.",
                                text="What brand is this, is it sweetened, and what price is shown?",
                                out_model=Read, images=[img_b64("oat_milk_unsweetened.jpg")])
        dt = time.perf_counter() - t0
        ok("oatly" in r.brand.lower(), f"brand read as '{r.brand}'")
        ok(r.sweetened is False, f"sweetened={r.sweetened} (expected False)")
        ok(r.price == 4.79, f"price={r.price} (expected 4.79)", soft=True)
        ok(dt < 3.0, f"vision latency {dt:.1f}s (target < 3s for the AR card)",
           "Try MUSE_REASONING_EFFORT=low, or send smaller crops (≤640px).", soft=True)
    except LLMError as e:
        ok(False, "vision call", f"{e}\n       → images may need a different content format; tell Person 4")


async def sam() -> None:
    from intelligence.vision import SAMDetector, VisionError

    section("SAM 3.1: vision/detect")
    if not settings.sam_endpoint_url:
        print("  SAM_ENDPOINT_URL is empty -> using Muse Spark vision as a fallback detector.")
        print("  This works for the demo. Fill in SAM_ENDPOINT_URL + intelligence/vision.py")
        print("  _call_sam_live() once you have real SAM 3.1 access, for true segmentation.")
    try:
        dets = await SAMDetector().detect(img_b64("shelf_milk.jpg"), ["oat milk carton", "almond milk carton"])
        ok(len(dets) > 0, f"{len(dets)} detection(s): {[d.prompt for d in dets]}")
        for d in dets:
            x, y, w, h = d.bbox
            ok(0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1,
               f"'{d.prompt}' bbox normalized: {d.bbox}")
    except VisionError as e:
        ok(False, "detect call", str(e))


async def backboard() -> None:
    from intelligence.preferences import (BackboardPreferenceStore, LocalPreferenceStore,
                                          ensure_backboard_assistant)
    from intelligence.schemas import PreferenceFact

    section("Backboard memory")
    if not settings.backboard_api_key:
        ok(False, "BACKBOARD_API_KEY set", "get it from app.backboard.io")
        return
    aid = settings.backboard_assistant_id
    if not aid:
        aid = await ensure_backboard_assistant(settings.backboard_api_key)
        print(f"  created assistant. Add this to .env:\n  BACKBOARD_ASSISTANT_ID={aid}")
    store = BackboardPreferenceStore(settings.backboard_api_key, aid, LocalPreferenceStore(OUT / "bb_mirror.json"))
    probe = f"check0 probe {int(time.time())}: dislikes cilantro"
    await store.add(PreferenceFact(requester="CheckBot", fact=probe, kind="dislike", item="cilantro", source="correction"))
    await asyncio.sleep(3)  # memory indexing can lag
    res = await store.client.search_memories(aid, query="CheckBot cilantro", limit=10)
    found = any("check0 probe" in m.get("content", "") for m in res.get("memories", []))
    ok(found, "memory written and found by search",
       "Not searchable yet. Backboard may index async: rerun in ~30s. Local mirror still works.", soft=True)


async def main() -> None:
    mode_banner()
    if live():
        await muse()
    else:
        section("Muse Spark")
        print("  skipped (LLM_MODE=mock). Run with LLM_MODE=live to test the API.")
    if settings.sam_mode == "live":
        await sam()
    else:
        section("SAM 3.1")
        print("  skipped (SAM_MODE=mock). Run with SAM_MODE=live to test detection.")
    if settings.pref_mode == "backboard":
        await backboard()
    done()


asyncio.run(main())

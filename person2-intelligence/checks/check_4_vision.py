"""CHECK 4 (hour 4-10, parallel with check_3): POST /vision/detect.

    python checks/check_4_vision.py
    SAM_MODE=live python checks/check_4_vision.py

This is what Person 1's AR overlay calls every ~2m when the runner re-scans
a shelf. Confirms bboxes are normalized 0-1 (never pixels) and that an empty
result for a prompt with no match is handled, not an error.
"""
import asyncio

from common import done, img_b64, mode_banner, ok, section, settings

from intelligence.vision import build_detector


async def main() -> None:
    mode_banner()
    section(f"detect() — SAM_MODE={settings.sam_mode}")
    detector = build_detector()
    dets = await detector.detect(img_b64("shelf_milk.jpg"),
                                 ["oat milk carton", "almond milk carton", "a live giraffe"])
    for d in dets:
        print(f"   '{d.prompt}' -> bbox={d.bbox} confidence={d.confidence}")
    ok(len(dets) >= 1, f"{len(dets)} detection(s) returned")
    ok(all(len(d.bbox) == 4 for d in dets), "every bbox has exactly 4 values [x,y,w,h]")
    ok(all(0 <= v <= 1 for d in dets for v in d.bbox), "every bbox value is normalized 0-1, never pixels")
    ok(not any(d.prompt == "a live giraffe" for d in dets),
       "a prompt with nothing in frame is simply absent (not an error, not a hallucinated box)")

    section("Empty prompts list")
    empty = await detector.detect(img_b64("shelf_milk.jpg"), [])
    ok(empty == [], "empty prompts -> empty detections, no crash")

    section("Feeds /product/analyze's alternative bbox")
    from intelligence import store
    store.reset()
    store.record_detections(dets)
    ok(store.recent_detections() == dets, "detections cached for analyze.py to find a bbox from")
    done()


asyncio.run(main())

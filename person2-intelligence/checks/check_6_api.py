"""CHECK 6 (integration): hit every endpoint over HTTP exactly like the spec
says, including the error shape.

    uvicorn dev_server:app --port 8002          # terminal 1
    python checks/check_6_api.py                # terminal 2
    python checks/check_6_api.py https://api.yourteam.tech   # Person 4's deployed backend
"""
import sys
import time

import httpx
from common import FIX, done, img_b64, ok, section

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8002").rstrip("/")


def call(c, method, path, **kw):
    t0 = time.perf_counter()
    r = c.request(method, BASE + path, **kw)
    dt = time.perf_counter() - t0
    ok(r.status_code == 200, f"{method} {path} → {r.status_code} in {dt:.2f}s", r.text[:300])
    return r.json() if r.status_code == 200 else None


with httpx.Client(timeout=60) as c:
    section(f"Server {BASE}")
    try:
        h = call(c, "GET", "/ai/health")
        print(f"   {h}")
    except httpx.ConnectError:
        ok(False, "server reachable", "Start it: uvicorn dev_server:app --port 8002")
        done()

    section("1. POST /chat/parse")
    contract = call(c, "POST", "/chat/parse", json={"raw_text": (FIX / "sample_chat_android.txt").read_text()})
    ok(contract is not None and "contract_id" in contract, "response has contract_id")
    ok(contract is not None and all(
        set(it) == {"id", "item", "requester", "rigidity", "spec", "reason", "substitute_rule",
                    "priority", "aisle", "aisle_no"} for it in contract["items"]),
       "item objects have exactly the spec keys, nothing extra")
    oat = next(i for i in contract["items"] if "oat" in i["item"])
    ok(isinstance(oat["spec"], str), "spec is a string, not a list")

    section("Error shape: any non-200 is {error, code}")
    r = c.post(BASE + "/chat/parse", json={"raw_text": "hello this is not whatsapp"})
    ok(r.status_code != 200, f"non-WhatsApp text → {r.status_code}")
    body = r.json()
    ok(set(body) == {"error", "code"}, f"error body is exactly {{error, code}}: {body}")
    r = c.post(BASE + "/product/analyze", json={"trip_id": "t1", "item_id": "nope", "image_b64": "AAAA"})
    ok(r.status_code == 404 and r.json().get("code") == "ITEM_NOT_FOUND", f"unknown item_id → 404 ITEM_NOT_FOUND: {r.json()}")

    section("4. POST /vision/detect")
    dets = call(c, "POST", "/vision/detect",
               json={"image_b64": img_b64("shelf_milk.jpg"), "prompts": ["oat milk carton", "a live giraffe"]})
    if dets:
        print(f"   {dets}")
        ok(all(len(d["bbox"]) == 4 and all(0 <= v <= 1 for v in d["bbox"]) for d in dets["detections"]),
           "every bbox normalized 0-1")

    section("5. POST /product/analyze")
    a = call(c, "POST", "/product/analyze",
            json={"trip_id": "t1", "item_id": oat["id"], "image_b64": img_b64("oat_milk_sweetened.jpg")})
    if a:
        print(f"   match={a['match']} product_name={a['product_name']!r} price={a['price']}")
        for line in a["checklist"]:
            print(f"   {line['status']:5} {line['text']}")
        ok(set(a) == {"match", "product_name", "price", "checklist", "alternative"}, "response has exactly the spec keys")
        ok(len(a["checklist"]) <= 5, "checklist capped at 5 lines")
        ok(all(l["status"] in ("pass", "fail", "warn") for l in a["checklist"]), "status only pass/fail/warn")

    section("12-13. Preferences")
    call(c, "POST", "/preferences/correction",
        json={"trip_id": "t1", "requester": "Priya", "text": "loves Califia Oat Unsweetened"})
    prefs = call(c, "GET", "/preferences", params={"requester": "Priya", "item": "oat milk"})
    if prefs:
        ok(prefs["requester"] == "Priya" and any("Califia" in p["text"] for p in prefs["preferences"]),
           "correction readable back over HTTP")
        ok(all(set(p) == {"text", "source", "trip_id"} for p in prefs["preferences"]), "preference objects have exactly the spec keys")
done()

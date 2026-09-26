"""CHECK 3 (hour 4-10): product in hand -> checklist, exact /product/analyze shape.

    python checks/check_3_analyze.py
    MOCK_ANALYSIS_SCENARIO=mismatch python checks/check_3_analyze.py
    LLM_MODE=live python checks/check_3_analyze.py      # real vision on fixture images

Swap fixtures/images/*.jpg for real phone photos of your demo products as soon
as you have them. Same filenames, much better test.
"""
import asyncio
import time

from common import OUT, done, find_item, img_b64, live, mode_banner, ok, parsed_contract, section, settings

from intelligence.analyze import analyze_product, finalize_analysis
from intelligence.llm import build_llm
from intelligence.preferences import LocalPreferenceStore
from intelligence.schemas import LLMAlternative, LLMAnalysis, LLMCheck
from intelligence import store


def show(a):
    print(f"\n   match={a.match}  product_name={a.product_name!r}  price={a.price}")
    for line in a.checklist:
        sym = {"pass": "✓", "fail": "✗", "warn": "⚠"}[line.status]
        print(f"   {sym} {line.text}")
    if a.alternative:
        print(f"   → alternative: {a.alternative.text}  bbox={a.alternative.bbox}")


async def main() -> None:
    mode_banner()
    store.reset()
    contract = await parsed_contract()
    oat = find_item(contract, "oat")
    assert oat, "no oat milk item in contract; run check_2 on the sample chat"
    pref_store = LocalPreferenceStore(OUT / "check3_prefs.json")
    await pref_store.clear()
    from intelligence.schemas import PreferenceFact
    await pref_store.add(PreferenceFact(requester="Priya", fact="disliked Planet Oat before (too sweet)",
                                        kind="dislike", item="oat milk", source="correction"))
    llm = build_llm()

    section("Guards (pure code, no AI)")
    fake = LLMAnalysis(product_name="x", checks=[LLMCheck(criterion="oat milk", status="pass", kind="spec")],
                       alternative=LLMAlternative(product_name="Oatly", reason="unsweetened"))
    a = finalize_analysis(oat, fake, observed_price=None)
    ok(any(l.status == "warn" and "unsweetened" in l.text for l in a.checklist),
       "criterion the model skipped shows as warn (spec has no 'unknown' status)")
    ok(a.alternative is None, "no alternative shown when the product already matches on the checked lines")

    fake_price = LLMAnalysis(product_name="x", checks=[LLMCheck(criterion="unsweetened", status="fail", kind="spec")])
    a = finalize_analysis(oat, fake_price, observed_price=5.49)
    price_line = next(l for l in a.checklist if "5.49" in l.text)
    ok(price_line.status == "fail" and "over Priya's $5.00" in price_line.text, f"price computed from numbers: {price_line.text}")
    ok(not a.match, "verdict derived from lines, not from the model")
    ok(len(a.checklist) <= 5, "capped at 5 lines")
    ok(all(len(l.text) <= 50 for l in a.checklist), "every line under 50 chars")

    section("Wrong product in hand: sweetened Planet Oat")
    t0 = time.perf_counter()
    a = await analyze_product(oat, img_b64("oat_milk_sweetened.jpg"), llm=llm, pref_store=pref_store)
    dt = time.perf_counter() - t0
    show(a)
    ok(dt < 3.0 or not live(), f"latency {dt:.1f}s", "Target <3s. Shrink crops, MUSE_REASONING_EFFORT=low", soft=True)
    if live():
        ok(not a.match, "match=False for the sweetened carton against an unsweetened request", soft=True)
        ok(a.alternative is not None, "suggests an alternative when it fails", soft=True)

    section("Right product in hand: Oatly Unsweetened")
    a = await analyze_product(oat, img_b64("oat_milk_unsweetened.jpg"), llm=llm, pref_store=pref_store)
    show(a)
    ok(a.match, "match=True for the unsweetened carton", soft=live())

    section("Alternative gets a bounding box when a recent shelf scan has it")
    from intelligence.schemas import Detection
    store.record_detections([Detection(prompt="Oatly Unsweetened oat milk", bbox=[0.4, 0.2, 0.2, 0.5], confidence=0.9)])
    a = await analyze_product(oat, img_b64("oat_milk_sweetened.jpg"), llm=llm, pref_store=pref_store)
    show(a)
    if not a.match:
        ok(a.alternative is not None and a.alternative.bbox == [0.4, 0.2, 0.2, 0.5],
           "alternative bbox pulled from the last /vision/detect call", soft=True)
    done()


asyncio.run(main())

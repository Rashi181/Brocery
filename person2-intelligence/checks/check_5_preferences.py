"""CHECK 5 (hour 10-18): memory loop. A runner's correction on trip 1 shows up
automatically on trip 2, via GET /preferences and POST /preferences/correction.

    python checks/check_5_preferences.py
    PREF_MODE=backboard python checks/check_5_preferences.py
"""
import asyncio

from common import OUT, done, find_item, mode_banner, ok, parsed_contract, section, settings

from intelligence import prompts, store
from intelligence.learning import record_correction
from intelligence.preferences import LocalPreferenceStore, build_store, to_spec_source
from intelligence.schemas import CorrectionRequest, PreferenceFact


async def main() -> None:
    mode_banner()
    store.reset()
    pref_store = LocalPreferenceStore(OUT / "check5_prefs.json") if settings.pref_mode == "local" else build_store()
    if settings.pref_mode == "local":
        await pref_store.clear()
    contract = await parsed_contract()
    oat = find_item(contract, "oat")

    section("Write (chat-learned fact + a runner correction)")
    await pref_store.add(PreferenceFact(requester="Priya", fact="lactose intolerant", kind="allergy", source="chat"))
    f = await record_correction(
        CorrectionRequest(trip_id="t_demo", requester="Priya",
                          text="prefers Califia Oat Unsweetened over Silk Almond; almond is gross to her"),
        pref_store)
    print(f"   correction stored → {f.fact}")

    section("Read back (what the next trip's /chat/parse and /product/analyze see)")
    if settings.pref_mode == "backboard":
        await asyncio.sleep(3)
    priya = await pref_store.for_person("Priya", "oat milk")
    for x in priya:
        print(f"   Priya: ({x.kind}, source={x.source}) {x.fact}")
    ok(priya and priya[0].kind == "allergy", "allergy ranked first")
    ok(any("Califia" in x.fact for x in priya), "runner correction remembered for oat milk")

    section("Exact GET /preferences response shape")
    from intelligence.schemas import PreferencesResponse, SpecPreference
    resp = PreferencesResponse(requester="Priya",
                               preferences=[SpecPreference(text=x.fact, source=to_spec_source(x), trip_id=x.trip_id)
                                            for x in priya])
    for p in resp.preferences:
        print(f"   {p.model_dump()}")
    ok(all(p.source in ("chat", "correction") for p in resp.preferences), "source is only 'chat' or 'correction'")
    ok(any(p.source == "correction" and p.trip_id == "t_demo" for p in resp.preferences),
       "correction keeps its trip_id")

    section("Memory reaches the prompts")
    known = {"Priya": [x.fact for x in priya]}
    ok("Califia" in prompts.parse_chat_user("#1 Priya: oat milk", ["Priya"], known), "next parse prompt includes it")
    ok("Califia" in prompts.analyze_user(oat, priya), "product check prompt includes it")
    done()


asyncio.run(main())

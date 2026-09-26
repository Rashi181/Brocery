"""CHECK 2 (hour 1-4): group chat -> shopping contract. THE Phase 1 demo moment.

    python checks/check_2_contract.py                      # mock
    LLM_MODE=live python checks/check_2_contract.py        # real Muse on the sample chat
    LLM_MODE=live python checks/check_2_contract.py my_export.txt

Hard checks (FAIL) = our code is wrong. Soft checks (WARN) = model quality;
fix those by editing intelligence/prompts.py and rerunning.
Also prints the exact /chat/parse response shape so you can sanity-check it
against the spec by eye.
"""
import asyncio
import sys
import time
from pathlib import Path

from common import FIX, done, find_item, mode_banner, ok, section

from intelligence import store
from intelligence.contract import parse_chat, to_spec_response
from intelligence.llm import build_llm
from intelligence.preferences import LocalPreferenceStore


async def main(path: Path, is_sample: bool) -> None:
    mode_banner()
    store.reset()
    pref_store = LocalPreferenceStore(str((__import__("common").OUT) / "check2_prefs.json"))
    await pref_store.clear()

    section("Parse")
    t0 = time.perf_counter()
    c = await parse_chat(path.read_text(encoding="utf-8"), llm=build_llm(), store_=pref_store)
    dt = time.perf_counter() - t0
    ok(len(c.items) > 0, f"{len(c.items)} items in {dt:.1f}s")
    ok(dt < 20, "parse under 20s", "Long chat? Lower CHAT_WINDOW_DAYS.", soft=True)

    section("Structure (our code guarantees these)")
    ok(all(it.requester in c.participants or it.needs_review for it in c.items),
       "every requester is a real chat member (or flagged for review)")
    idxs = {m.idx for m in c.messages}
    ok(all(set(it.source_messages) <= idxs for it in c.items), "every source message exists")
    names = [(it.item.lower(), it.requester) for it in c.items]
    ok(len(names) == len(set(names)), "no duplicate item for the same person")
    ok(len({it.id for it in c.items}) == len(c.items), "item ids unique")
    ok(store.get_item(c.items[0].id) is not None, "items are stored so /product/analyze can find them by id")

    print("\n  Contract (internal, rich):")
    for it in c.items:
        flag = "  ⚑ " + it.review_note if it.needs_review else ""
        print(f"   {it.id:12} {it.item:16} {it.requester:7} {it.rigidity:9} spec={it.spec} "
              f"avoid={it.avoid} max={it.max_price} shared={it.shared} src={it.source_messages}{flag}")
    print(f"   learned: {[p.fact for p in c.preferences_learned]}")
    print(f"   unresolved: {c.unresolved}   budget_hint: {c.budget_hint}")

    section("Exact spec response shape (/chat/parse)")
    spec = to_spec_response(c)
    print(f"   contract_id: {spec.contract_id}")
    for it in spec.items[:2]:
        print(f"   {it.model_dump()}")
    print(f"   ... ({len(spec.items)} items total)")
    ok(all(it.aisle is None and it.aisle_no is None for it in spec.items), "aisle/aisle_no are null (Person 4 fills these)")
    ok(all(isinstance(it.spec, str) for it in spec.items), "spec is a flat string, not a list")
    ok(spec.items[0].priority in ("must", "nice"), "priority uses must/nice, not must-have/nice-to-have")

    if is_sample:
        section("AI quality on the sample chat (soft)")
        oat, pasta, eggs = find_item(c, "oat"), find_item(c, "pasta"), find_item(c, "egg")
        ok(oat is not None and oat.requester == "Priya", "oat milk → Priya")
        ok(oat is not None and any("unsweet" in s.lower() for s in oat.spec), "oat milk spec has unsweetened", soft=True)
        ok(oat is not None and oat.max_price == 5.0, "oat milk max_price 5", soft=True)
        ok(oat is not None and bool(oat.reason), "oat milk keeps the reason (coffee)", soft=True)
        ok(pasta is not None and any("whole wheat" in a.lower() for a in pasta.avoid),
           "pasta has avoid 'whole wheat' (merged from a later message)", "Key demo moment. Tighten the merge rule in prompts.py", soft=True)
        ok(pasta is not None and {6, 9} <= set(pasta.source_messages), "pasta cites messages #6 and #9", soft=True)
        ok(find_item(c, "soap") is None, "dish soap excluded (cancelled with 'nvm')", soft=True)
        ok(eggs is not None and eggs.rigidity == "strict", "eggs are strict (pasture raised)", soft=True)
        ok(sum(1 for it in c.items if it.shared) >= 2, "taco items marked shared", soft=True)
        ok(c.budget_hint == 60, "budget hint 60", soft=True)
        ok(any("friday" in u.lower() for u in c.unresolved), "vague Friday message is unresolved, not an item", soft=True)
        ok(any("lactose" in p.fact.lower() or "dairy" in p.fact.lower() for p in c.preferences_learned),
           "learned: Priya lactose intolerant", soft=True)
        saved = await pref_store.all()
        ok(len(saved) == len(c.preferences_learned), f"{len(saved)} preferences saved to memory during parse")
    done()


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(main(Path(arg) if arg else FIX / "sample_chat_android.txt", is_sample=arg is None))

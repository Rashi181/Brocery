"""Helpers shared by the numbered check scripts. Run checks from the repo root:
    python checks/check_1_whatsapp.py
"""
from __future__ import annotations

import base64
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from intelligence.config import settings  # noqa: E402

FIX = ROOT / "fixtures"
OUT = ROOT / ".out"
OUT.mkdir(exist_ok=True)

_results = {"pass": 0, "fail": 0, "warn": 0}


def ok(cond: bool, label: str, hint: str = "", soft: bool = False) -> bool:
    """Hard check prints FAIL; soft check (AI quality) prints WARN and doesn't fail the script."""
    if cond:
        _results["pass"] += 1
        print(f"  \033[32mPASS\033[0m {label}")
    elif soft:
        _results["warn"] += 1
        print(f"  \033[33mWARN\033[0m {label}" + (f"\n       → {hint}" if hint else ""))
    else:
        _results["fail"] += 1
        print(f"  \033[31mFAIL\033[0m {label}" + (f"\n       → {hint}" if hint else ""))
    return cond


def section(title: str) -> None:
    print(f"\n\033[1m{title}\033[0m")


def done() -> None:
    r = _results
    print(f"\n{r['pass']} passed, {r['warn']} warnings, {r['fail']} failed")
    sys.exit(1 if r["fail"] else 0)


def live() -> bool:
    return settings.llm_mode == "live"


def mode_banner() -> None:
    print(f"LLM_MODE={settings.llm_mode}  SAM_MODE={settings.sam_mode}  "
         f"PREF_MODE={settings.pref_mode}  MODEL={settings.muse_model}")
    if not live():
        print("(mock mode: semantic checks use canned answers; run again with LLM_MODE=live)")


def img_b64(name: str) -> str:
    """Returns raw base64, NO data: prefix — this is exactly what the spec's
    image_b64 fields expect."""
    p = FIX / "images" / name
    if not p.exists():
        sys.exit(f"missing {p}. Run: python fixtures/make_test_images.py")
    return base64.b64encode(p.read_bytes()).decode()


async def parsed_contract():
    """Contract saved by check_2 (internal store), or parse the sample chat
    fresh via the mock if check_2 hasn't run. Call with `await` — safe to use
    from inside another check's own event loop."""
    from intelligence import store
    from intelligence.contract import parse_chat
    from intelligence.mocks import MockLLM
    from intelligence.preferences import LocalPreferenceStore

    if store._contracts:
        return next(iter(store._contracts.values()))
    raw = (FIX / "sample_chat_android.txt").read_text()
    return await parse_chat(raw, llm=MockLLM(), store_=LocalPreferenceStore(OUT / "tmp_prefs.json"))


def find_item(contract, name: str):
    for it in contract.items:
        if name in it.item.lower():
            return it
    return None

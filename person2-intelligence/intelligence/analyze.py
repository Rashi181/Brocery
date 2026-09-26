"""Phase 2: is the product in the runner's hand right for this request?

Muse Spark looks at the crop and judges each criterion. finalize_analysis()
then applies rules the model is not trusted with:
  - every spec/avoid criterion gets exactly one line (missing -> treated as
    unverified, shown as "warn" since the spec's check status has no
    "unknown")
  - the price line is computed from numbers, not from the model's opinion
  - match/verdict are derived from the lines, not taken from the model
  - the response is capped at 5 lines and each line at ~50 chars, per spec
  - the alternative's bounding box, if any, comes from the last real
    /vision/detect call (see store.py) — the model only names a product
If Muse fails or times out, a degraded-but-honest checklist still comes back
so the AR card never hangs.
"""
from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher
from typing import Optional

from . import prompts, store
from .llm import LLMError
from .preferences import PreferenceStore
from .schemas import (AnalyzeResponse, ChecklistLine, ContractItem, LLMAnalysis,
                      LLMCheck, SpecAlternative)

log = logging.getLogger("intelligence.analyze")
SYMBOL = {"pass": "✓", "fail": "✗", "warn": "⚠"}
_KIND_ORDER = {"spec": 0, "avoid": 1, "price": 2, "preference": 3}
MAX_LINES = 5
MAX_CHARS = 50


def _words(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", s.lower()))


def _covers(check: LLMCheck, criterion: str) -> bool:
    """Whole-word match, so 'sweetened' never matches 'unsweetened'."""
    a, b = _words(check.criterion), _words(criterion)
    return bool(a) and bool(b) and (a <= b or b <= a)


def _truncate(text: str, limit: int = MAX_CHARS) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _line(criterion: str, status: str, detail: str, kind: str) -> tuple[str, ChecklistLine]:
    """Returns (kind, line) — kind kept alongside so we can sort/cap before dropping it."""
    display_status = {"unknown": "warn"}.get(status, status)  # spec has no "unknown"
    text = detail or criterion
    return kind, ChecklistLine(status=display_status, text=_truncate(text))


def _price_line(item: ContractItem, price: Optional[float]) -> Optional[tuple[str, ChecklistLine]]:
    if price is None or item.max_price is None:
        return None
    ok = price <= item.max_price + 1e-9
    who = "the house's" if item.shared else f"{item.requester}'s"
    detail = f"${price:.2f}, {'under' if ok else 'over'} {who} ${item.max_price:.2f}"
    return _line(f"under ${item.max_price:.2f}", "pass" if ok else "fail", detail, "price")


def _cap_lines(lines: list[tuple[str, ChecklistLine]]) -> list[ChecklistLine]:
    """Keep at most MAX_LINES, prioritizing anything actionable (fail/warn)
    over plain passes, and spec/avoid/price over preference, when trimming."""
    def sort_key(pair):
        kind, line = pair
        actionable = line.status in ("fail", "warn")
        return (not actionable, _KIND_ORDER.get(kind, 9))

    ordered = sorted(lines, key=sort_key)[:MAX_LINES]
    ordered.sort(key=lambda pair: _KIND_ORDER.get(pair[0], 9))
    return [line for _, line in ordered]


def _best_bbox(product_name: str) -> Optional[list[float]]:
    """Match the model's named alternative against the last shelf scan
    (see store.py: recent_detections). Fuzzy on purpose — the model says
    'Oatly Unsweetened', SAM's prompt/label might be 'oat milk carton'."""
    candidates = store.recent_detections()
    if not candidates or not product_name:
        return None
    name = product_name.lower()
    scored = [(SequenceMatcher(None, name, d.prompt.lower()).ratio(), d) for d in candidates]
    best_score, best = max(scored, key=lambda t: t[0])
    return best.bbox if best_score > 0.25 else None


def finalize_analysis(item: ContractItem, out: LLMAnalysis, *, observed_price: Optional[float],
                      degraded: bool = False) -> AnalyzeResponse:
    lines: list[tuple[str, ChecklistLine]] = []
    used: set[int] = set()

    for kind, criteria in (("spec", item.spec), ("avoid", item.avoid)):
        for crit in criteria:
            idx = next((i for i, c in enumerate(out.checks)
                        if i not in used and c.kind == kind and _covers(c, crit)), None)
            if idx is None:  # model may have mislabelled the kind
                idx = next((i for i, c in enumerate(out.checks) if i not in used and _covers(c, crit)), None)
            if idx is None:
                lines.append(_line(crit, "unknown", f"{crit}: couldn't verify", kind))
                continue
            used.add(idx)
            c = out.checks[idx]
            lines.append(_line(crit, c.status, c.detail, kind))

    prefs = [c for i, c in enumerate(out.checks) if i not in used and c.kind == "preference"][:1]
    lines += [_line(c.criterion, c.status, c.detail, "preference") for c in prefs]

    price = _price_line(item, observed_price if observed_price is not None else out.read_price)
    if price:
        lines.append(price)

    match = not any(line.status == "fail" and kind in ("spec", "avoid", "price") for kind, line in lines)

    alt = None
    if not match and out.alternative and not degraded:
        bbox = _best_bbox(out.alternative.product_name)
        alt = SpecAlternative(text=_truncate(f"{out.alternative.product_name}: {out.alternative.reason}"), bbox=bbox)

    price_val = round(observed_price, 2) if observed_price is not None else (
        round(out.read_price, 2) if out.read_price is not None else None)

    return AnalyzeResponse(match=match and not degraded, product_name=out.product_name,
                           price=price_val, checklist=_cap_lines(lines), alternative=alt)


async def analyze_product(item: ContractItem, image_b64: str, *, llm, pref_store: PreferenceStore) -> AnalyzeResponse:
    prefs = await pref_store.for_person(item.requester, item.item)
    try:
        out = await llm.json_call(
            task="analyze_product",
            system=prompts.ANALYZE_SYSTEM,
            text=prompts.analyze_user(item, prefs),
            out_model=LLMAnalysis,
            images=[image_b64],
            context={"item": item},
        )
        degraded = False
    except LLMError as e:
        log.error("analyze degraded: %s", e)
        out, degraded = LLMAnalysis(product_name="(couldn't read product)", checks=[], confidence=0.0), True
    return finalize_analysis(item, out, observed_price=None, degraded=degraded)

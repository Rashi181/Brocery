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
from typing import Optional

from . import prompts
from .llm import LLMError
from .preferences import PreferenceStore
from .schemas import (
    AnalyzeResponse,
    ChecklistLine,
    ContractItem,
    LLMAnalysis,
    LLMCheck,
    SpecAlternative,
)

log = logging.getLogger("intelligence.analyze")
SYMBOL = {"pass": "✓", "fail": "✗", "warn": "⚠"}
_KIND_ORDER = {"spec": 0, "avoid": 1, "price": 2, "preference": 3}
MAX_LINES = 100
MAX_CHARS = 240


def _words(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", s.lower()))


def _covers(check: LLMCheck, criterion: str) -> bool:
    """Whole-word match, so 'sweetened' never matches 'unsweetened'."""
    a, b = _words(check.criterion), _words(criterion)
    return bool(a) and bool(b) and (a <= b or b <= a)


def _truncate(text: str, limit: int = MAX_CHARS) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _line(
    criterion: str, status: str, detail: str, kind: str
) -> tuple[str, ChecklistLine]:
    """Returns (kind, line) — kind kept alongside so we can sort/cap before dropping it."""
    display_status = {"unknown": "warn"}.get(status, status)  # spec has no "unknown"
    text = detail or criterion
    return kind, ChecklistLine(status=display_status, text=_truncate(text))


def _price_line(
    item: ContractItem, price: Optional[float]
) -> Optional[tuple[str, ChecklistLine]]:
    if item.max_price is None:
        return None
    if price is None:
        return _line("price", "warn", "Price unreadable; budget unverified", "price")
    ok = price <= item.max_price + 1e-9
    who = "the house's" if item.shared else f"{item.requester}'s"
    detail = f"${price:.2f}, {'under' if ok else 'over'} {who} ${item.max_price:.2f}"
    return _line(
        f"under ${item.max_price:.2f}", "pass" if ok else "fail", detail, "price"
    )


def _cap_lines(lines: list[tuple[str, ChecklistLine]]) -> list[ChecklistLine]:
    """Keep at most MAX_LINES, prioritizing anything actionable (fail/warn)
    over plain passes, and spec/avoid/price over preference, when trimming."""

    def sort_key(pair):
        kind, line = pair
        actionable = line.status in ("fail", "warn")
        return (not actionable, _KIND_ORDER.get(kind, 9))

    ordered = sorted(lines, key=sort_key)[:MAX_LINES]
    return [line for _, line in ordered]


def finalize_analysis(
    item: ContractItem,
    out: LLMAnalysis,
    *,
    observed_price: Optional[float],
    degraded: bool = False,
    candidates=None,
) -> AnalyzeResponse:
    lines: list[tuple[str, ChecklistLine]] = []
    used: set[int] = set()

    for kind, criteria in (
        ("spec", ["product identity", *item.spec]),
        ("avoid", item.avoid),
    ):
        for crit in criteria:
            idx = next(
                (
                    i
                    for i, c in enumerate(out.checks)
                    if i not in used and c.kind == kind and _covers(c, crit)
                ),
                None,
            )
            if idx is None:  # model may have mislabelled the kind
                idx = next(
                    (
                        i
                        for i, c in enumerate(out.checks)
                        if i not in used and _covers(c, crit)
                    ),
                    None,
                )
            if idx is None:
                lines.append(_line(crit, "unknown", f"{crit}: couldn't verify", kind))
                continue
            used.add(idx)
            c = out.checks[idx]
            lines.append(_line(crit, c.status, c.detail, kind))

    # Explicit package declarations take precedence over a contradictory model check.
    evidence = out.visible_text.lower()
    dairy_conflict = bool(
        re.search(r"contains\s+(?:[^.\n]{0,50}\b)?milk\b|\bwhey\b|\bcasein\b", evidence)
    )
    if dairy_conflict and any(
        re.search(r"dairy|milk|lactose", c, re.I) for c in item.avoid
    ):
        lines.append(
            _line(
                "dairy",
                "fail",
                "Label explicitly lists milk/dairy ingredients",
                "avoid",
            )
        )

    prefs = [
        c for i, c in enumerate(out.checks) if i not in used and c.kind == "preference"
    ][:1]
    lines += [_line(c.criterion, c.status, c.detail, "preference") for c in prefs]

    price = _price_line(
        item, observed_price if observed_price is not None else out.read_price
    )
    if price:
        lines.append(price)

    match = bool(lines) and all(line.status == "pass" for _, line in lines)

    alt = None
    if not match and out.alternative and not degraded:
        candidate = next(
            (
                d
                for d in (candidates or [])
                if d.detection_id == out.alternative.detection_id
            ),
            None,
        )
        if candidate:
            alt = SpecAlternative(
                detection_id=candidate.detection_id,
                text=f"{out.alternative.product_name}: {out.alternative.reason}",
                bbox=candidate.bbox,
            )

    price_val = (
        round(observed_price, 2)
        if observed_price is not None
        else (round(out.read_price, 2) if out.read_price is not None else None)
    )

    decision = (
        "confirm"
        if match and not degraded
        else (
            "skip"
            if item.rigidity == "strict" and any(l.status == "fail" for _, l in lines)
            else "substitute"
            if item.rigidity == "flexible" and alt
            else "review"
        )
    )
    return AnalyzeResponse(
        decision=decision,
        match=match and not degraded,
        product_name=out.product_name,
        price=price_val,
        checklist=_cap_lines(lines),
        alternative=alt,
    )


async def analyze_product(
    item: ContractItem,
    image_b64: str,
    *,
    llm,
    pref_store: PreferenceStore,
    candidates=None,
    shelf_image=None,
) -> AnalyzeResponse:
    prefs = await pref_store.for_person(item.requester, item.item)
    try:
        out = await llm.json_call(
            task="analyze_product",
            system=prompts.ANALYZE_SYSTEM,
            text=prompts.analyze_user(item, prefs)
            + (
                "\nSecond image is shelf. Candidates: "
                + str([d.model_dump(exclude={"mask"}) for d in candidates])
                if candidates
                else ""
            ),
            out_model=LLMAnalysis,
            images=[image_b64, shelf_image],
            context={"item": item},
        )
        degraded = False
    except LLMError as e:
        log.error("analyze degraded: %s", e)
        out, degraded = (
            LLMAnalysis(
                product_name="(couldn't read product)", checks=[], confidence=0.0
            ),
            True,
        )
    return finalize_analysis(
        item, out, observed_price=None, degraded=degraded, candidates=candidates
    )

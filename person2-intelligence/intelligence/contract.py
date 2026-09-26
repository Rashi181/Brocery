"""Phase 1: exported group chat -> shopping contract.

parse_chat() does raw .txt -> Contract (internal, rich) and stores it in
store.py so /product/analyze can find items by id later. to_spec_response()
converts that internal Contract to the exact /chat/parse response shape.

The cleanup step is what makes this safe to demo: the model can't invent
people, cite messages that don't exist, or return the same item twice.
"""

from __future__ import annotations

import re
from typing import Optional

from . import prompts, store
from .preferences import PreferenceStore
from .schemas import (
    ChatMessage,
    ChatParseResponse,
    Contract,
    ContractItem,
    LLMContract,
    LLMItem,
    SpecItem,
)
from .whatsapp import participants as get_participants
from .whatsapp import parse_whatsapp, recent_window, render_for_llm

_RIGIDITY_ORDER = {"flexible": 0, "preferred": 1, "strict": 2}
_SHARED_WORDS = {"house", "household", "everyone", "all", "us", "we", "group"}


class ContractError(ValueError):
    pass


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def resolve_requester(name: str, people: list[str]) -> Optional[str]:
    """Map a model-written name onto a real chat sender, or None."""
    n = name.strip().casefold()
    for p in people:
        if p.casefold() == n:
            return p
    first = n.split()[0] if n.split() else ""
    for p in people:  # "Priya" vs "Priya S", or "Sam" vs "Sam 🏀"
        parts = p.casefold().split()
        if first and parts and parts[0] == first:
            return p
    return None


def _merge(a: ContractItem, b: LLMItem) -> ContractItem:
    def union(x: list[str], y: list[str]) -> list[str]:
        out = list(x)
        out += [v for v in y if _norm(v) not in {_norm(o) for o in out}]
        return out

    a.spec = union(a.spec, b.spec)
    a.avoid = union(a.avoid, b.avoid)
    a.source_messages = sorted(set(a.source_messages) | set(b.source_messages))
    if _RIGIDITY_ORDER[b.rigidity] > _RIGIDITY_ORDER[a.rigidity]:
        a.rigidity = b.rigidity
    if b.priority == "must":
        a.priority = "must"
    prices = [p for p in (a.max_price, b.max_price) if p is not None]
    a.max_price = min(prices) if prices else None
    a.reason = a.reason or b.reason
    a.substitute_rule = a.substitute_rule or b.substitute_rule
    a.shared = a.shared or b.shared
    return a


def clean_contract(
    raw: LLMContract, messages: list[ChatMessage], contract_id: str
) -> Contract:
    people = get_participants(messages)
    by_idx = {m.idx: m for m in messages}
    items: list[ContractItem] = []

    for it in raw.items:
        if not it.item.strip():
            continue
        sources = [
            i for i in it.source_messages if i in by_idx and not by_idx[i].is_system
        ]
        needs_review, note = False, None

        who = resolve_requester(it.requester, people)
        if who is None and _norm(it.requester) in _SHARED_WORDS and sources:
            who, it.shared = by_idx[sources[0]].sender, True
        if who is None:
            who = by_idx[sources[0]].sender if sources else it.requester
            needs_review, note = (
                True,
                f"Couldn't match requester '{it.requester}' to a chat member",
            )
        if not sources:
            needs_review, note = (
                True,
                note or "Model gave no source message for this item",
            )

        existing = next(
            (
                x
                for x in items
                if _norm(x.item) == _norm(it.item) and x.requester == who
            ),
            None,
        )
        candidate = it.model_copy(update={"requester": who, "source_messages": sources})
        if existing:
            _merge(existing, candidate)
            continue
        items.append(
            ContractItem(
                **candidate.model_dump(),
                id=store.new_item_id(),
                contract_id=contract_id,
                needs_review=needs_review,
                review_note=note,
            )
        )

    prefs = [
        p.model_copy(
            update={"requester": resolve_requester(p.requester, people) or p.requester}
        )
        for p in raw.preferences_learned
    ]
    return Contract(
        contract_id=contract_id,
        participants=people,
        items=items,
        preferences_learned=prefs,
        unresolved=raw.unresolved,
        budget_hint=raw.budget_hint,
        messages=messages,
    )


def to_spec_response(contract: Contract) -> ChatParseResponse:
    """The exact /chat/parse response shape: aisle/aisle_no null (Person 4
    fills them via /aisles), spec flattened from list -> comma string."""
    items = [
        SpecItem(
            id=it.id,
            item=it.item,
            requester=it.requester,
            rigidity=it.rigidity,
            spec="; ".join(it.spec) if it.spec else "",
            reason=it.reason,
            substitute_rule=it.substitute_rule,
            priority=it.priority,
            aisle=None,
            aisle_no=None,
            avoid=it.avoid,
            max_price=it.max_price,
            quantity=it.quantity,
            shared=it.shared,
            needs_review=it.needs_review,
            review_note=it.review_note,
            evidence=[m.text for m in contract.messages if m.idx in it.source_messages],
        )
        for it in contract.items
    ]
    return ChatParseResponse(
        contract_id=contract.contract_id,
        items=items,
        participants=contract.participants,
        unresolved=contract.unresolved,
    )


async def parse_chat(
    raw_text: str, *, llm, store_: PreferenceStore, window_days: Optional[int] = None
) -> Contract:
    messages = recent_window(parse_whatsapp(raw_text), window_days)
    people = get_participants(messages)
    if not people:
        raise ContractError("Chat has no messages from people (only system lines).")

    known = {p: [f.fact for f in await store_.for_person(p, limit=6)] for p in people}
    raw = await llm.json_call(
        task="parse_chat",
        system=prompts.PARSE_CHAT_SYSTEM,
        text=prompts.parse_chat_user(render_for_llm(messages), people, known),
        out_model=LLMContract,
        context={"messages": messages},
    )
    contract = clean_contract(raw, messages, store.new_contract_id())
    store.put_contract(contract)

    from .preferences import PreferenceFact

    for p in contract.preferences_learned:
        await store_.add(
            PreferenceFact(
                requester=p.requester, fact=p.fact, kind=p.kind, source="chat"
            )
        )
    return contract

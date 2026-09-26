import asyncio

import pytest

from intelligence import store as item_store
from intelligence.contract import (
    ContractError,
    clean_contract,
    parse_chat,
    resolve_requester,
    to_spec_response,
)
from intelligence.mocks import MockLLM
from intelligence.schemas import LLMContract, LLMItem, LLMPreference
from intelligence.whatsapp import parse_whatsapp

RAW = (
    "9/24/26, 8:00 PM - Priya S: oat milk\n9/24/26, 8:01 PM - Sam: pasta\n"
    "9/24/26, 8:02 PM - Sam: not whole wheat\n9/24/26, 8:03 PM - Sam: dish soap for everyone\n"
)


def msgs():
    return parse_whatsapp(RAW)


def test_resolve_requester():
    people = ["Priya S", "Sam"]
    assert resolve_requester("priya", people) == "Priya S"
    assert resolve_requester("SAM", people) == "Sam"
    assert resolve_requester("Bob", people) is None


def test_invented_person_and_bad_sources_are_flagged():
    raw = LLMContract(
        items=[LLMItem(item="chips", requester="Bob", source_messages=[1, 99])]
    )
    c = clean_contract(raw, msgs(), "c_1")
    it = c.items[0]
    assert it.requester == "Sam" and it.needs_review and it.source_messages == [1]


def test_everyone_becomes_shared():
    raw = LLMContract(
        items=[LLMItem(item="dish soap", requester="everyone", source_messages=[3])]
    )
    it = clean_contract(raw, msgs(), "c_1").items[0]
    assert it.shared and it.requester == "Sam" and not it.needs_review


def test_duplicates_merge_stricter_wins():
    raw = LLMContract(
        items=[
            LLMItem(
                item="Pasta",
                requester="Sam",
                rigidity="flexible",
                spec=["pasta"],
                max_price=4,
                source_messages=[1],
            ),
            LLMItem(
                item="pasta",
                requester="sam",
                rigidity="strict",
                avoid=["whole wheat"],
                max_price=3,
                source_messages=[2],
            ),
            LLMItem(item="  ", requester="Sam"),
        ]
    )
    c = clean_contract(raw, msgs(), "c_1")
    assert len(c.items) == 1
    p = c.items[0]
    assert p.rigidity == "strict" and p.avoid == ["whole wheat"] and p.max_price == 3
    assert p.source_messages == [1, 2]


def test_preference_names_resolved():
    raw = LLMContract(
        items=[],
        preferences_learned=[
            LLMPreference(requester="priya", fact="vegan", kind="dietary")
        ],
    )
    assert (
        clean_contract(raw, msgs(), "c_1").preferences_learned[0].requester == "Priya S"
    )


def test_items_are_registered_in_the_store():
    c = clean_contract(
        LLMContract(
            items=[LLMItem(item="milk", requester="Priya S", source_messages=[0])]
        ),
        msgs(),
        "c_9",
    )
    item_store.put_contract(c)
    found = item_store.get_item(c.items[0].id)
    assert found is not None and found.item == "milk"
    assert item_store.get_contract("c_9") is c


def test_full_mock_parse(sample_text, store):
    c = asyncio.run(parse_chat(sample_text, llm=MockLLM(), store_=store))
    assert c.participants == ["Jordan", "Priya", "Sam", "Maya"] and len(c.items) == 8
    assert c.contract_id.startswith("c_")
    assert len(asyncio.run(store.all())) == 5  # preferences written during parse
    assert (
        item_store.get_item(c.items[0].id) is not None
    )  # registered for later /product/analyze


def test_spec_response_shape_exact_keys(sample_text, store):
    c = asyncio.run(parse_chat(sample_text, llm=MockLLM(), store_=store))
    resp = to_spec_response(c)
    dumped = resp.model_dump()
    assert set(dumped) == {"contract_id", "items", "participants", "unresolved"}
    for it in dumped["items"]:
        assert set(it) == {
            "id",
            "item",
            "requester",
            "rigidity",
            "spec",
            "reason",
            "substitute_rule",
            "priority",
            "aisle",
            "aisle_no",
            "avoid",
            "max_price",
            "quantity",
            "shared",
            "needs_review",
            "review_note",
            "evidence",
        }
        assert isinstance(it["spec"], str)
        assert it["aisle"] is None and it["aisle_no"] is None
        assert it["priority"] in ("must", "nice")


def test_empty_chat_raises(store):
    with pytest.raises(ContractError):
        asyncio.run(
            parse_chat(
                "9/24/26, 8:00 PM - System notice only, not from anyone\n",
                llm=MockLLM(),
                store_=store,
            )
        )

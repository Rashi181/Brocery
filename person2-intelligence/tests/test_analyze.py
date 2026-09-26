import asyncio

from intelligence.analyze import analyze_product, finalize_analysis
from intelligence.llm import LLMError
from intelligence.schemas import LLMAlternative, LLMAnalysis, LLMCheck


def run(item, checks, alt=None, price=None, **kw):
    out = LLMAnalysis(
        product_name="P", checks=checks, alternative=alt, read_price=price
    )
    return finalize_analysis(item, out, observed_price=None, **kw)


def test_every_criterion_gets_exactly_one_line(item):
    # item.spec = ['oat milk', 'unsweetened'], item.avoid = ['sweetened']. The model
    # answers 'unsweetened' twice and never answers 'sweetened' at all.
    a = run(
        item,
        [
            LLMCheck(criterion="Oat Milk", status="pass"),
            LLMCheck(criterion="unsweetened", status="pass"),
            LLMCheck(criterion="unsweetened", status="fail"),
        ],
    )
    spec_texts = [l.text for l in a.checklist]
    assert sum("oat milk" in t.lower() for t in spec_texts) <= 1  # not answered twice
    assert any(
        l.status == "warn" and "sweetened" in l.text for l in a.checklist
    )  # avoid never answered


def test_negated_words_never_cross_match(item):
    """Regression: 'sweetened' (avoid) must not be satisfied by a check on 'unsweetened' (spec)."""
    a = run(item, [LLMCheck(criterion="unsweetened", status="fail", kind="spec")])
    texts = [l.text for l in a.checklist]
    assert any("sweetened" in t and "couldn't verify" in t for t in texts)


def test_mislabelled_kind_still_matched(item):
    a = run(item, [LLMCheck(criterion="sweetened", status="pass", kind="spec")])
    # 'sweetened' criterion satisfies the avoid=['sweetened'] line even though the model tagged it 'spec'
    assert any(l.status == "pass" for l in a.checklist)


def test_price_is_deterministic(item):
    a = run(item, [], price=5.5)
    line = next(l for l in a.checklist if "5.50" in l.text)
    assert line.status == "fail" and "over Priya's $5.00" in line.text
    a = run(item, [], price=4.29)
    assert next(l for l in a.checklist if "4.29" in l.text).status == "pass"


def test_no_alternative_when_product_matches(item):
    checks = [
        LLMCheck(criterion=c, status="pass", kind=k)
        for c, k in [
            ("product identity", "spec"),
            ("oat milk", "spec"),
            ("unsweetened", "spec"),
            ("sweetened", "avoid"),
        ]
    ]
    a = run(
        item,
        checks,
        price=4.0,
        alt=LLMAlternative(product_name="Oatly", reason="better"),
    )
    assert a.match and a.alternative is None


def test_unseen_alternative_is_not_shown(item):
    a = run(
        item,
        [LLMCheck(criterion="unsweetened", status="fail")],
        alt=LLMAlternative(product_name="Oatly Unsweetened", reason="matches"),
    )
    assert not a.match and a.alternative is None


def test_alternative_gets_bbox_from_recent_detection(item, monkeypatch):
    from intelligence import store as item_store
    from intelligence.schemas import Detection

    item_store.reset()
    candidates = [
        Detection(
            prompt="Oatly Unsweetened oat milk",
            bbox=[0.3, 0.2, 0.2, 0.5],
            confidence=0.9,
            detection_id="shelf-1",
        )
    ]
    a = run(
        item,
        [LLMCheck(criterion="unsweetened", status="fail")],
        alt=LLMAlternative(
            product_name="Oatly Unsweetened", reason="matches", detection_id="shelf-1"
        ),
        candidates=candidates,
    )
    assert a.alternative.bbox == [0.3, 0.2, 0.2, 0.5]


def test_all_criteria_survive_for_expandable_card(item):
    checks = [
        LLMCheck(criterion=f"crit{i}", status="fail", detail="x" * 80, kind="spec")
        for i in range(8)
    ]
    long_item = item.model_copy(update={"spec": [f"crit{i}" for i in range(8)]})
    a = run(long_item, checks)
    assert len(a.checklist) == 11
    assert all(len(l.text) <= 240 for l in a.checklist)


def test_shared_item_uses_house_wording(item):
    shared = item.model_copy(update={"shared": True})
    a = run(shared, [], price=4.0)
    assert any("house's" in l.text for l in a.checklist)


class Boom:
    async def json_call(self, **kw):
        raise LLMError("timeout")


def test_llm_failure_returns_degraded_but_valid_response(item, store):
    a = asyncio.run(analyze_product(item, "AAAA", llm=Boom(), pref_store=store))
    # Muse is down: nothing was verified, so every criterion shows as "couldn't
    # verify" (warn) rather than a crash or a false "pass".
    assert not a.match and a.alternative is None
    assert a.checklist and all(l.status == "warn" for l in a.checklist)

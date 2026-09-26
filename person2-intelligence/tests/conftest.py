import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
FIX = ROOT / "fixtures"


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch, tmp_path):
    """Every test runs in mock mode with its own throwaway preference file
    and a clean in-memory item store."""
    monkeypatch.setenv("LLM_MODE", "mock")
    monkeypatch.setenv("SAM_MODE", "mock")
    monkeypatch.setenv("PREF_MODE", "local")
    monkeypatch.setenv("LOCAL_PREF_PATH", str(tmp_path / "prefs.json"))
    monkeypatch.setenv("MOCK_ANALYSIS_SCENARIO", "match")
    monkeypatch.setenv("CHAT_DATE_ORDER", "auto")
    from intelligence import store
    from intelligence.router import reset_singletons

    store.reset()
    reset_singletons()
    yield
    store.reset()


@pytest.fixture
def store(tmp_path):
    from intelligence.preferences import LocalPreferenceStore

    return LocalPreferenceStore(tmp_path / "store.json")


@pytest.fixture
def sample_text():
    return (FIX / "sample_chat_android.txt").read_text()


@pytest.fixture
def item():
    from intelligence.schemas import ContractItem

    return ContractItem(
        id="i_1",
        contract_id="c_1",
        item="oat milk",
        requester="Priya",
        rigidity="preferred",
        spec=["oat milk", "unsweetened"],
        avoid=["sweetened"],
        max_price=5.0,
        substitute_rule="any unsweetened oat milk",
        source_messages=[4],
    )

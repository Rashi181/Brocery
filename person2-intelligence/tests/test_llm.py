import asyncio
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from intelligence.llm import LLMError, MuseLLM, extract_json, to_data_url


class Out(BaseModel):
    a: int


@pytest.mark.parametrize(
    "text", ['{"a": 1}', '```json\n{"a": 1}\n```', 'Sure! {"a": 1} hope that helps']
)
def test_extract_json(text):
    assert extract_json(text) == {"a": 1}


def test_to_data_url_strips_existing_prefix():
    assert to_data_url("QUJD") == "data:image/jpeg;base64,QUJD"
    assert to_data_url("data:image/png;base64,QUJD") == "data:image/jpeg;base64,QUJD"


def resp(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content), finish_reason="stop"
            )
        ]
    )


class FakeCompletions:
    def __init__(self, script):
        self.script, self.calls = list(script), []

    async def create(self, **kw):
        self.calls.append(kw)
        nxt = self.script.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return resp(nxt)


def make(monkeypatch, script):
    monkeypatch.setenv("META_API_KEY", "test")
    llm = MuseLLM()
    fake = FakeCompletions(script)
    llm.client = SimpleNamespace(chat=SimpleNamespace(completions=fake))
    return llm, fake


def test_structured_output_rejected_falls_back(monkeypatch):
    llm, fake = make(
        monkeypatch,
        [Exception("Error code: 400 - response_format not supported"), '{"a": 2}'],
    )
    out = asyncio.run(llm.json_call(task="t", system="s", text="x", out_model=Out))
    assert (
        out.a == 2
        and "response_format" in fake.calls[0]
        and "response_format" not in fake.calls[1]
    )
    assert llm._structured_ok is False


def test_invalid_json_is_repaired(monkeypatch):
    llm, fake = make(monkeypatch, ['{"a": "not a number"}', '{"a": 3}'])
    assert (
        asyncio.run(llm.json_call(task="t", system="s", text="x", out_model=Out)).a == 3
    )
    assert "invalid" in fake.calls[1]["messages"][-1]["content"]


def test_gives_up_with_llm_error(monkeypatch):
    llm, _ = make(monkeypatch, ["nope", "still nope"])
    with pytest.raises(LLMError):
        asyncio.run(llm.json_call(task="t", system="s", text="x", out_model=Out))


def test_network_error_wrapped(monkeypatch):
    llm, _ = make(monkeypatch, [TimeoutError("slow")])
    with pytest.raises(LLMError, match="TimeoutError"):
        asyncio.run(llm.json_call(task="t", system="s", text="x", out_model=Out))


def test_images_sent_as_data_urls(monkeypatch):
    llm, fake = make(monkeypatch, ['{"a": 1}'])
    asyncio.run(
        llm.json_call(
            task="t", system="s", text="x", out_model=Out, images=["QUJD", None]
        )
    )
    parts = fake.calls[0]["messages"][1]["content"]
    assert parts[1] == {
        "type": "image_url",
        "image_url": {"url": "data:image/jpeg;base64,QUJD"},
    }
    assert len(parts) == 2  # None image skipped


def test_missing_key(monkeypatch):
    monkeypatch.setenv("META_API_KEY", "")
    monkeypatch.setenv("SAM_API_KEY", "")
    monkeypatch.setenv("MUSE_API_KEY", "")
    with pytest.raises(LLMError):
        MuseLLM()


def test_strict_schema_requires_optional_extraction_fields():
    from intelligence.llm import strict_schema
    from intelligence.schemas import LLMContract

    schema = strict_schema(LLMContract)
    item = schema["$defs"]["LLMItem"]
    assert set(item["required"]) == set(item["properties"])
    assert item["additionalProperties"] is False
    assert {"avoid", "quantity", "rigidity", "shared"} <= set(item["required"])

import asyncio,json
import httpx
import pytest
from intelligence.gemini_chat import GeminiChat
from intelligence.schemas import LLMContract
from intelligence.llm import LLMError

def test_chat_schema_and_validation(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY","fake")
    original=httpx.AsyncClient
    def handle(request):
        payload=json.loads(request.content)
        assert "responseJsonSchema" in payload["generationConfig"]
        assert payload["generationConfig"]["thinkingConfig"]["thinkingLevel"]=="low"
        return httpx.Response(200,json={"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":'{"items":[],"preferences_learned":[],"unresolved":[],"budget_hint":null}'}]}}]})
    monkeypatch.setattr(httpx,"AsyncClient",lambda **kw:original(transport=httpx.MockTransport(handle),**kw))
    result=asyncio.run(GeminiChat().json_call(system="extract",text="chat",out_model=LLMContract))
    assert result.items==[]

def test_chat_rejects_partial_output(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY","fake")
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,"AsyncClient",lambda **kw:original(transport=httpx.MockTransport(lambda req:httpx.Response(200,json={"candidates":[{"finishReason":"MAX_TOKENS"}]})),**kw))
    with pytest.raises(LLMError,match="incomplete"):
        asyncio.run(GeminiChat().json_call(system="extract",text="chat",out_model=LLMContract))

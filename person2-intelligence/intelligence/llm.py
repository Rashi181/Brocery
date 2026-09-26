"""Muse Spark client (Meta Model API is OpenAI-compatible).

json_call() always returns a validated Pydantic object or raises LLMError.
It tries structured output first; if the API rejects that parameter it falls
back to "return only JSON" prompting and remembers not to try again.
Invalid JSON gets one repair retry with the validation error fed back.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Optional, Sequence, Type, TypeVar

from pydantic import BaseModel, ValidationError

from .config import settings

log = logging.getLogger("intelligence.llm")
T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


def to_data_url(b64: str) -> str:
    b64 = b64.split(",", 1)[-1] if b64.startswith("data:") else b64
    return f"data:image/jpeg;base64,{b64}"


def extract_json(text: str) -> Any:
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model output")
    return json.loads(text[start : end + 1])


def strict_schema(model):
    """Require every output field so extraction cannot silently use schema defaults."""
    schema = model.model_json_schema()

    def visit(node):
        if isinstance(node, dict):
            node.pop("default", None)
            if node.get("type") == "object":
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}))
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(schema)
    return schema


class MuseLLM:
    def __init__(self) -> None:
        from openai import AsyncOpenAI  # imported here so mock mode needs no key

        if not settings.meta_api_key:
            raise LLMError("META_API_KEY is not set (or set LLM_MODE=mock)")
        self.client = AsyncOpenAI(
            api_key=settings.meta_api_key,
            base_url=settings.muse_base_url,
            timeout=settings.llm_timeout,
        )
        self.model = settings.muse_model
        self.effort = settings.muse_reasoning_effort
        self._structured_ok = True
        self.last_latency_ms: Optional[int] = None

    async def json_call(
        self,
        *,
        task: str,
        system: str,
        text: str,
        out_model: Type[T],
        images: Sequence[Optional[str]] = (),
        context: Optional[dict] = None,  # used only by the mock
        retries: int = 1,
    ) -> T:
        schema = json.dumps(strict_schema(out_model))
        user: list[dict] = [{"type": "text", "text": text}]
        user += [
            {"type": "image_url", "image_url": {"url": to_data_url(i)}}
            for i in images
            if i
        ]
        messages: list[dict] = [
            {
                "role": "system",
                "content": f"{system}\n\nReturn ONLY one JSON object matching this JSON schema:\n{schema}",
            },
            {"role": "user", "content": user if any(images) else text},
        ]
        last_err: Exception | None = None
        for attempt in range(retries + 1):
            raw = await self._create(messages, out_model)
            try:
                return out_model.model_validate(extract_json(raw))
            except (ValueError, ValidationError) as e:
                last_err = e
                log.warning(
                    "%s: invalid JSON on attempt %d: %s",
                    task,
                    attempt + 1,
                    str(e)[:300],
                )
                messages += [
                    {"role": "assistant", "content": raw},
                    {
                        "role": "user",
                        "content": f"That output was invalid: {str(e)[:600]}\nReturn only the corrected JSON object.",
                    },
                ]
        raise LLMError(f"{task}: model did not return valid JSON: {last_err}")

    async def _create(self, messages: list[dict], out_model: Type[BaseModel]) -> str:
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages}
        if self.effort:
            kwargs["extra_body"] = {"reasoning_effort": self.effort}
        if self._structured_ok:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": out_model.__name__,
                    "strict": True,
                    "schema": strict_schema(out_model),
                },
            }
        t0 = time.perf_counter()
        try:
            try:
                resp = await self.client.chat.completions.create(**kwargs)
            except (
                Exception
            ) as e:  # structured output unsupported -> plain JSON prompting
                looks_like_format_error = "400" in str(e) or "response_format" in str(e)
                if not self._structured_ok or not looks_like_format_error:
                    raise
                log.warning(
                    "structured output rejected, falling back to prompt-only JSON: %s",
                    str(e)[:200],
                )
                self._structured_ok = False
                kwargs.pop("response_format", None)
                resp = await self.client.chat.completions.create(**kwargs)
        except Exception as e:
            raise LLMError(
                f"Muse API call failed: {type(e).__name__}: {str(e)[:400]}"
            ) from e
        self.last_latency_ms = int((time.perf_counter() - t0) * 1000)
        if not resp.choices or resp.choices[0].finish_reason not in ("stop", None):
            raise LLMError(
                "Muse response was incomplete; retry with a clearer photo or shorter chat"
            )
        return resp.choices[0].message.content or ""


def build_llm():
    if settings.llm_mode == "live":
        return MuseLLM()
    from .mocks import MockLLM

    return MockLLM()

"""Mock LLM and mock SAM. Same interfaces as the live versions, no network,
deterministic. Everyone can build the whole pipeline against these before any
API keys exist.

- parse_chat      -> fixtures/mock_llm/parse_chat.json (matches the sample chat)
- analyze_product -> built from the item's spec; MOCK_ANALYSIS_SCENARIO=mismatch
                     makes the first criterion fail and names a plausible alternative
- detect          -> fixtures/mock_llm/detections.json, keyed by prompt keyword
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional, Sequence, Type, TypeVar

from pydantic import BaseModel

from .config import settings
from .schemas import ContractItem, Detection

T = TypeVar("T", bound=BaseModel)
FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "mock_llm"


class MockLLM:
    last_latency_ms = 0

    async def json_call(self, *, task: str, out_model: Type[T], context: Optional[dict] = None,
                        system: str = "", text: str = "", images: Sequence = (), retries: int = 1) -> T:
        ctx = context or {}
        if task == "parse_chat":
            data = json.loads((FIXTURES / "parse_chat.json").read_text())
        elif task == "analyze_product":
            data = self._analysis(ctx["item"])
        else:
            raise ValueError(f"MockLLM has no response for task '{task}'")
        return out_model.model_validate(data)

    def _analysis(self, item: ContractItem) -> dict:
        mismatch = settings.mock_analysis_scenario == "mismatch"
        checks = []
        for i, s in enumerate(item.spec):
            fail = mismatch and i == 0
            checks.append({"criterion": s, "status": "fail" if fail else "pass",
                           "detail": f"not {s}" if fail else s, "kind": "spec"})
        for a in item.avoid:
            checks.append({"criterion": a, "status": "pass", "detail": f"not {a}", "kind": "avoid"})
        alt = {"product_name": "Oatly Unsweetened", "reason": "mock: matches the request better"} if mismatch else None
        return {"product_name": f"Mock {item.item}", "read_price": None, "checks": checks,
                "alternative": alt, "confidence": 0.9}


class MockSAM:
    """fixtures/mock_llm/detections.json maps a lowercase keyword -> a fixed bbox,
    so any prompt containing that keyword 'detects'. Prompts matching nothing
    return no detection, same as the real API would for something not on shelf.
    """

    async def detect(self, image_b64: str, prompts: list[str]) -> list[Detection]:
        table = json.loads((FIXTURES / "detections.json").read_text())
        out = []
        for p in prompts:
            key = next((k for k in table if k in p.lower()), None)
            if key:
                d = table[key]
                out.append(Detection(prompt=p, bbox=d["bbox"], confidence=d["confidence"]))
        return out

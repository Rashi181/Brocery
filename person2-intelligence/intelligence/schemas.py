"""Two layers of models, on purpose:

  SPEC MODELS  (Spec* prefix, plus the literal request/response classes)
    Exactly the keys and types in the team's API Spec document. Nothing more,
    nothing less. These are what actually go over the wire.

  INTERNAL MODELS  (ContractItem, LLMAnalysis, etc.)
    Richer — spec + avoid, max_price, needs_review, confidence, etc. Muse
    Spark is prompted against these, and analyze.py/contract.py reason with
    them, because "unsweetened" as one criterion in a structured list is much
    easier to check and rank than as a substring of a free-text sentence.

  store.py holds the internal objects; router.py converts internal -> spec
  at the very last step, right before returning a response.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

Rigidity = Literal["strict", "preferred", "flexible"]
Priority = Literal["must", "nice"]
CheckStatus = Literal["pass", "fail", "warn"]
LineStatus = Literal["pending", "purchased", "substituted", "skipped"]


# ============================================================ internal
class ChatMessage(BaseModel):
    idx: int
    timestamp: Optional[datetime] = None
    sender: Optional[str] = None
    text: str
    is_media: bool = False
    is_system: bool = False


class LLMItem(BaseModel):
    """What we ask Muse Spark to extract. Richer than the spec's flat item."""
    item: str = Field(description="Short product name, e.g. 'oat milk'")
    requester: str = Field(description="Exact sender name from the chat")
    rigidity: Rigidity = "preferred"
    spec: list[str] = Field(default_factory=list, description="Positive requirements, one per entry")
    avoid: list[str] = Field(default_factory=list, description="Things the product must NOT be")
    max_price: Optional[float] = None
    quantity: str = "1"
    reason: Optional[str] = None
    substitute_rule: Optional[str] = None
    priority: Priority = "must"
    shared: bool = False
    source_messages: list[int] = Field(default_factory=list)


class LLMPreference(BaseModel):
    requester: str
    fact: str
    kind: Literal["dietary", "allergy", "dislike", "like", "other"] = "other"


class LLMContract(BaseModel):
    items: list[LLMItem]
    preferences_learned: list[LLMPreference] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    budget_hint: Optional[float] = None


class ContractItem(LLMItem):
    id: str
    contract_id: str
    needs_review: bool = False
    review_note: Optional[str] = None


class Contract(BaseModel):
    contract_id: str
    participants: list[str]
    items: list[ContractItem]
    preferences_learned: list[LLMPreference] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    budget_hint: Optional[float] = None
    messages: list[ChatMessage] = Field(default_factory=list)


class LLMCheck(BaseModel):
    criterion: str
    status: Literal["pass", "fail", "warn", "unknown"]
    detail: str = ""
    kind: Literal["spec", "avoid", "price", "preference"] = "spec"


class LLMAlternative(BaseModel):
    product_name: str
    reason: str


class LLMAnalysis(BaseModel):
    product_name: str
    read_price: Optional[float] = None
    checks: list[LLMCheck]
    alternative: Optional[LLMAlternative] = None
    confidence: float = 0.5


class PreferenceFact(BaseModel):
    requester: str
    fact: str
    kind: Literal["dietary", "allergy", "dislike", "like", "override", "feedback", "other"] = "other"
    item: Optional[str] = None
    trip_id: Optional[str] = None
    source: Literal["chat", "correction"] = "chat"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ============================================================ spec: 1. /chat/parse
class ChatParseRequest(BaseModel):
    raw_text: str


class SpecItem(BaseModel):
    id: str
    item: str
    requester: str
    rigidity: Rigidity
    spec: str
    reason: Optional[str] = None
    substitute_rule: Optional[str] = None
    priority: Priority
    aisle: Optional[str] = None
    aisle_no: Optional[int] = None


class ChatParseResponse(BaseModel):
    contract_id: str
    items: list[SpecItem]


# ============================================================ spec: 4. /vision/detect
class VisionDetectRequest(BaseModel):
    image_b64: str
    prompts: list[str]


class Detection(BaseModel):
    prompt: str
    bbox: list[float]  # [x, y, w, h] normalized 0-1
    confidence: float


class VisionDetectResponse(BaseModel):
    detections: list[Detection]


# ============================================================ spec: 5. /product/analyze
class AnalyzeRequest(BaseModel):
    trip_id: str
    item_id: str
    image_b64: str


class ChecklistLine(BaseModel):
    status: CheckStatus
    text: str


class SpecAlternative(BaseModel):
    text: str
    bbox: Optional[list[float]] = None


class AnalyzeResponse(BaseModel):
    match: bool
    product_name: str
    price: Optional[float] = None
    checklist: list[ChecklistLine]
    alternative: Optional[SpecAlternative] = None


# ============================================================ spec: 12/13. /preferences
class SpecPreference(BaseModel):
    text: str
    source: Literal["chat", "correction"]
    trip_id: Optional[str] = None


class PreferencesResponse(BaseModel):
    requester: str
    preferences: list[SpecPreference]


class CorrectionRequest(BaseModel):
    trip_id: str
    requester: str
    text: str


class OkResponse(BaseModel):
    ok: bool = True

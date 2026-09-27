"""HTTP endpoints, matching the team's API Spec exactly (paths, methods,
request/response shapes, error format). Person 4 mounts this:

    from intelligence.router import router as ai_router
    app.include_router(ai_router)
    install_error_handlers(app)   # from intelligence.errors — do this once

Endpoints Person 2 owns per the spec: /chat/parse, /vision/detect,
/product/analyze, /preferences (GET), /preferences/correction.
/trip/start, /aisles, /item/confirm, /item/substitute, /item/skip, /cart,
/checkout, /settlement all belong to Person 3/4 and are NOT here.
"""

from __future__ import annotations

import logging
import os
import time

from fastapi import APIRouter, Depends, BackgroundTasks

from .analyze import analyze_product
from .config import settings
from .contract import ContractError, parse_chat, to_spec_response
from .errors import AppError
from .learning import record_correction
from .llm import LLMError, build_llm
from .preferences import PreferenceStore, build_store, to_spec_source
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    ChatParseRequest,
    ChatParseResponse,
    CorrectionRequest,
    OkResponse,
    PreferencesResponse,
    SpecPreference,
    VisionDetectRequest,
    VisionDetectResponse,
)
from . import store as item_store
from .vision import VisionError, build_detector
from .whatsapp import ChatParseError

log = logging.getLogger("intelligence.router")
router = APIRouter(tags=["intelligence"])

_llm = None
_pref_store = None
_detector = None


def get_llm():
    global _llm
    if _llm is None:
        _llm = build_llm()
    return _llm


def get_chat_llm():
    provider = os.getenv("CHAT_PROVIDER", "auto").lower()
    if settings.llm_mode == "live" and (provider == "gemini" or (provider == "auto" and os.getenv("GEMINI_API_KEY"))):
        from .gemini_chat import GeminiChat
        return GeminiChat()
    return get_llm()


def get_store() -> PreferenceStore:
    global _pref_store
    if _pref_store is None:
        _pref_store = build_store()
    return _pref_store


def get_detector():
    global _detector
    if _detector is None:
        _detector = build_detector()
    return _detector


def reset_singletons() -> None:
    """For tests/check scripts after changing env vars."""
    global _llm, _pref_store, _detector
    _llm, _pref_store, _detector = None, None, None


@router.get("/ai/health")
async def health():
    return {
        "llm_mode": settings.llm_mode,
        "sam_mode": settings.sam_mode,
        "pref_mode": settings.pref_mode,
        "ok": True,
    }


@router.post("/chat/parse", response_model=ChatParseResponse)
async def chat_parse(
    body: ChatParseRequest, background_tasks: BackgroundTasks, llm=Depends(get_chat_llm), store=Depends(get_store)
):
    t0 = time.perf_counter()
    try:
        contract = await parse_chat(body.raw_text, llm=llm, store_=store, background_tasks=background_tasks)
    except ChatParseError as e:
        raise AppError(422, str(e), "CHAT_NOT_PARSEABLE")
    except ContractError as e:
        raise AppError(422, str(e), "CONTRACT_INVALID")
    except LLMError as e:
        raise AppError(502, f"AI parsing failed: {e}", "LLM_FAILED")
    log.info(
        "parsed chat: %d items in %.1fs", len(contract.items), time.perf_counter() - t0
    )
    return to_spec_response(contract)


@router.post("/vision/detect", response_model=VisionDetectResponse)
async def vision_detect(body: VisionDetectRequest, detector=Depends(get_detector)):
    if not body.prompts:
        raise AppError(422, "prompts must be a non-empty list", "MISSING_PROMPTS")
    try:
        detections = await detector.detect(body.image_b64, body.prompts)
    except VisionError as e:
        raise AppError(502, f"vision detection failed: {e}", "SAM_FAILED")
    item_store.record_detections(
        detections
    )  # so /product/analyze can find a bbox for its alternative
    return VisionDetectResponse(detections=detections)


@router.post("/product/analyze", response_model=AnalyzeResponse)
async def product_analyze(
    req: AnalyzeRequest, llm=Depends(get_llm), store=Depends(get_store)
):
    item = item_store.get_item(req.item_id)
    if item is None:
        raise AppError(
            404,
            f"unknown item_id '{req.item_id}'. Was /chat/parse called for this trip?",
            "ITEM_NOT_FOUND",
        )
    t0 = time.perf_counter()
    result = await analyze_product(item, req.image_b64, llm=llm, pref_store=store)
    log.info(
        "analyze %s -> match=%s in %.2fs",
        item.item,
        result.match,
        time.perf_counter() - t0,
    )
    return result


@router.get("/preferences", response_model=PreferencesResponse)
async def preferences(
    requester: str, item: str | None = None, store=Depends(get_store)
):
    facts = await store.for_person(requester, item, limit=20)
    return PreferencesResponse(
        requester=requester,
        preferences=[
            SpecPreference(text=f.fact, source=to_spec_source(f), trip_id=f.trip_id)
            for f in facts
        ],
    )


@router.post("/preferences/correction", response_model=OkResponse)
async def preferences_correction(body: CorrectionRequest, store=Depends(get_store)):
    await record_correction(body, store)
    return OkResponse(ok=True)

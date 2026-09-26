"""POST /preferences/correction: the runner overrides the AI -> memory.

Spec's request is deliberately thin ({trip_id, requester, text}) — the runner
just types what actually happened, in their own words. We store it verbatim
as the fact; there's nothing to reconstruct or reformat.
"""

from __future__ import annotations

from .preferences import PreferenceStore
from .schemas import CorrectionRequest, PreferenceFact


async def record_correction(
    req: CorrectionRequest, store: PreferenceStore
) -> PreferenceFact:
    return await store.add(
        PreferenceFact(
            requester=req.requester,
            fact=req.text,
            kind="override",
            trip_id=req.trip_id,
            source="correction",
        )
    )

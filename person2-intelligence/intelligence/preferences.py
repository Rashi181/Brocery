"""Per-person preference memory.

LocalPreferenceStore     - JSON file. Works offline, used in tests and as fallback.
BackboardPreferenceStore - writes every fact to Backboard (assistant-level memory,
    shared across threads) AND to the local mirror, so a slow or failed Backboard
    call never loses data or breaks the demo.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional, Protocol, get_args

from .config import settings
from .schemas import PreferenceFact

log = logging.getLogger("intelligence.preferences")
_PRIORITY_KINDS = ("allergy", "dietary")
_VALID_KINDS = set(get_args(PreferenceFact.model_fields["kind"].annotation))


def _same(a: str, b: str) -> bool:
    return a.strip().casefold() == b.strip().casefold()


def _tokens(s: Optional[str]) -> set[str]:
    return {t for t in re.findall(r"[a-z]+", (s or "").lower()) if len(t) > 2}


def rank_facts(
    facts: list[PreferenceFact], item: Optional[str], limit: int
) -> list[PreferenceFact]:
    """Allergies and diets first, then facts mentioning the item, then newest."""
    want = _tokens(item)

    def score(f: PreferenceFact):
        relevant = bool(want & (_tokens(f.item) | _tokens(f.fact)))
        return (f.kind in _PRIORITY_KINDS, relevant, f.created_at)

    return sorted(facts, key=score, reverse=True)[:limit]


def format_memory(f: PreferenceFact) -> str:
    return f"[{f.requester}] ({f.kind}) {f.fact}" + (
        f" — item: {f.item}" if f.item else ""
    )


def to_spec_source(f: PreferenceFact) -> str:
    """Spec's /preferences only knows two sources. Map our richer internal
    kinds onto them: facts learned from the chat stay 'chat', everything a
    human typed in (override, feedback, manual) becomes 'correction'."""
    return "chat" if f.source == "chat" else "correction"


class PreferenceStore(Protocol):
    async def add(self, fact: PreferenceFact) -> PreferenceFact: ...
    async def for_person(
        self, requester: str, item: Optional[str] = None, limit: int = 8
    ) -> list[PreferenceFact]: ...
    async def all(self) -> list[PreferenceFact]: ...


class LocalPreferenceStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _load(self) -> list[PreferenceFact]:
        if not self.path.exists():
            return []
        try:
            return [
                PreferenceFact.model_validate(x)
                for x in json.loads(self.path.read_text())
            ]
        except Exception as e:  # corrupted file should not kill the demo
            log.error("could not read %s: %s", self.path, e)
            return []

    def _save(self, facts: list[PreferenceFact]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps([f.model_dump(mode="json") for f in facts], indent=1)
        )

    async def has(self, fact: PreferenceFact) -> bool:
        return any(
            _same(f.requester, fact.requester) and _same(f.fact, fact.fact)
            for f in self._load()
        )

    async def add(self, fact: PreferenceFact) -> PreferenceFact:
        facts = self._load()
        if not any(
            _same(f.requester, fact.requester) and _same(f.fact, fact.fact)
            for f in facts
        ):
            facts.append(fact)
            self._save(facts)
        return fact

    async def for_person(
        self, requester: str, item: Optional[str] = None, limit: int = 8
    ) -> list[PreferenceFact]:
        return rank_facts(
            [f for f in self._load() if _same(f.requester, requester)], item, limit
        )

    async def all(self) -> list[PreferenceFact]:
        return self._load()

    async def clear(self) -> None:
        if self.path.exists():
            self.path.unlink()


class BackboardPreferenceStore:
    def __init__(
        self, api_key: str, assistant_id: str, mirror: LocalPreferenceStore
    ) -> None:
        from backboard import BackboardClient

        self.client = BackboardClient(api_key=api_key)
        self.assistant_id = assistant_id
        self.mirror = mirror

    async def add(self, fact: PreferenceFact) -> PreferenceFact:
        if await self.mirror.has(fact):  # don't spam Backboard with duplicates
            return fact
        await self.mirror.add(fact)
        try:
            await self.client.add_memory(
                self.assistant_id,
                content=format_memory(fact),
                metadata={
                    "requester": fact.requester,
                    "kind": fact.kind,
                    "item": fact.item or "",
                    "source": fact.source,
                    "trip_id": fact.trip_id or "",
                },
            )
        except Exception as e:
            log.warning("Backboard add_memory failed, kept in local mirror: %s", e)
        return fact

    async def for_person(
        self, requester: str, item: Optional[str] = None, limit: int = 8
    ) -> list[PreferenceFact]:
        facts = await self.mirror.for_person(requester, item, limit=50)
        try:
            res = await self.client.search_memories(
                self.assistant_id,
                query=f"{requester} {item or ''} food preferences allergies dislikes substitutions",
                limit=20,
            )
            for m in res.get("memories", []):
                meta = m.get("metadata") or {}
                content = m.get("content", "")
                owner = meta.get("requester") or ""
                if not (
                    _same(owner, requester)
                    or content.casefold().startswith(f"[{requester.casefold()}]")
                ):
                    continue
                text = re.sub(r"^\[[^\]]+\]\s*(\([a-z]+\)\s*)?", "", content).split(
                    " — item:"
                )[0]
                if not any(_same(text, f.fact) for f in facts):
                    kind = (
                        meta.get("kind")
                        if meta.get("kind") in _VALID_KINDS
                        else "other"
                    )
                    source = (
                        meta.get("source")
                        if meta.get("source") in ("chat", "correction")
                        else "correction"
                    )
                    facts.append(
                        PreferenceFact(
                            requester=requester,
                            fact=text,
                            kind=kind,
                            item=meta.get("item") or None,
                            source=source,
                            trip_id=meta.get("trip_id") or None,
                        )
                    )
        except Exception as e:
            log.warning("Backboard search failed, using local mirror only: %s", e)
        return rank_facts(facts, item, limit)

    async def all(self) -> list[PreferenceFact]:
        return await self.mirror.all()


async def ensure_backboard_assistant(api_key: str) -> str:
    """Create the household memory assistant once. Put the returned id in BACKBOARD_ASSISTANT_ID."""
    from backboard import BackboardClient

    client = BackboardClient(api_key=api_key)
    a = await client.create_assistant(
        name="household-preferences",
        description="Per-person grocery preferences, allergies and substitution history",
        system_prompt="You store grocery preferences for members of one household.",
    )
    return str(a.assistant_id)


def build_store() -> PreferenceStore:
    mirror = LocalPreferenceStore(settings.local_pref_path)
    if settings.pref_mode == "backboard":
        if not (settings.backboard_api_key and settings.backboard_assistant_id):
            log.error(
                "PREF_MODE=backboard but BACKBOARD_API_KEY / BACKBOARD_ASSISTANT_ID missing; using local"
            )
            return mirror
        return BackboardPreferenceStore(
            settings.backboard_api_key, settings.backboard_assistant_id, mirror
        )
    return mirror

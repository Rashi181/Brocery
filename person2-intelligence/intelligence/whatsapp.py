"""Parse a WhatsApp 'Export chat' .txt into structured messages.

Handles both export formats:
  Android: 9/24/26, 8:07 PM - Priya: oat milk pls
  iOS:     [9/24/26, 8:07:12 PM] Priya: oat milk pls
plus multi-line messages, media placeholders, system lines, invisible unicode
marks WhatsApp inserts, and DD/MM vs MM/DD dates.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Optional

from .config import settings
from .schemas import ChatMessage

_INVISIBLE = str.maketrans({"\u202f": " ", "\u00a0": " ", "\u200f": "", "\ufeff": ""})
_TIME = r"\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?\s?[Mm]\.?)?"
_DATE = r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"
ANDROID = re.compile(rf"^({_DATE}),?\s+({_TIME})\s+-\s+(.*)$")
IOS = re.compile(rf"^\[({_DATE}),?\s+({_TIME})\]\s+(.*)$")
SENDER = re.compile(r"^([^:]{1,60}?):\s?(.*)$", re.S)
MEDIA = re.compile(
    r"^(<media omitted>|<attached:.*>|(image|video|audio|sticker|gif|document|contact card) omitted"
    r"|.*\(file attached\)|this message was deleted|you deleted this message)$",
    re.I,
)


class ChatParseError(ValueError):
    pass


def _split_date(d: str) -> tuple[int, int, int]:
    a, b, c = (int(x) for x in re.split(r"[/.\-]", d))
    if c < 100:
        c += 2000
    return a, b, c


def _detect_order(dates: list[str]) -> str:
    forced = settings.date_order
    if forced in ("MDY", "DMY"):
        return forced
    for d in dates:
        a, b, _ = _split_date(d)
        if a > 12:
            return "DMY"
        if b > 12:
            return "MDY"
    return "MDY"  # US default when nothing disambiguates


def _parse_ts(date: str, time: str, order: str) -> Optional[datetime]:
    a, b, year = _split_date(date)
    month, day = (a, b) if order == "MDY" else (b, a)
    t = time.upper().replace(".", "").replace(" ", "")
    for fmt in ("%I:%M:%S%p", "%I:%M%p", "%H:%M:%S", "%H:%M"):
        try:
            tt = datetime.strptime(t, fmt)
            return datetime(year, month, day, tt.hour, tt.minute, tt.second)
        except ValueError:
            continue
    return None


def parse_whatsapp(raw: str) -> list[ChatMessage]:
    """Return messages in order. Raises ChatParseError if nothing looks like WhatsApp."""
    lines = raw.translate(_INVISIBLE).splitlines()
    heads: list[
        tuple[str, str, str]
    ] = []  # (date, time, rest incl. continuation lines)

    for line in lines:
        m = IOS.match(line.lstrip("\u200e")) or ANDROID.match(line.lstrip("\u200e"))
        if m:
            heads.append((m.group(1), m.group(2), m.group(3)))
        elif heads:
            d, t, rest = heads[-1]
            heads[-1] = (d, t, rest + "\n" + line)

    if not heads:
        raise ChatParseError(
            "No WhatsApp messages found. Is this an exported chat .txt?"
        )

    order = _detect_order([h[0] for h in heads])
    out: list[ChatMessage] = []
    for i, (d, t, rest) in enumerate(heads):
        ts = _parse_ts(d, t, order)
        sm = SENDER.match(rest)
        if not sm:  # Android system line: no "Name: " prefix
            out.append(
                ChatMessage(idx=i, timestamp=ts, text=rest.strip(), is_system=True)
            )
            continue
        sender, text = sm.group(1).strip(), sm.group(2)
        lrm = text.startswith("\u200e")  # iOS marks system/media lines this way
        text = text.replace("\u200e", "").strip()
        is_media = bool(MEDIA.match(text))
        is_system = lrm and not is_media
        out.append(
            ChatMessage(
                idx=i,
                timestamp=ts,
                sender=None if is_system else sender,
                text=text,
                is_media=is_media,
                is_system=is_system,
            )
        )
    return out


def recent_window(
    messages: list[ChatMessage], days: Optional[int] = None
) -> list[ChatMessage]:
    """Keep only messages within `days` of the latest message (exports include old history)."""
    days = settings.chat_window_days if days is None else days
    stamped = [m.timestamp for m in messages if m.timestamp]
    if not stamped or days <= 0:
        return messages
    cutoff = max(stamped) - timedelta(days=days)
    return [m for m in messages if m.timestamp is None or m.timestamp >= cutoff]


def participants(messages: list[ChatMessage]) -> list[str]:
    seen: dict[str, None] = {}
    for m in messages:
        if m.sender and not m.is_system:
            seen.setdefault(m.sender, None)
    return list(seen)


def render_for_llm(messages: list[ChatMessage]) -> str:
    """Numbered transcript so the model can cite source messages as #N."""
    rows = []
    for m in messages:
        if m.is_system:
            continue
        stamp = m.timestamp.strftime("%a %H:%M") if m.timestamp else "?"
        body = (
            "[photo or media, content unknown]"
            if m.is_media
            else m.text.replace("\n", "\n    ")
        )
        rows.append(f"#{m.idx} [{stamp}] {m.sender}: {body}")
    return "\n".join(rows)

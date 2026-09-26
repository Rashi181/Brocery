"""Prompts. Tune wording here, never inline in pipeline code."""
from __future__ import annotations

import json

from .schemas import ContractItem, PreferenceFact

PARSE_CHAT_SYSTEM = """\
You turn a household group chat into a shopping contract for the one person doing the grocery run (the runner).

Each chat line looks like: #N [day time] Sender: text. Use N when citing source_messages.

Extract every product someone asked for. For each item:
- item: short generic product name ("oat milk", "pasta", "corn tortillas").
- requester: the exact sender name of the person who wants it. If someone asks on another person's behalf ("grab X for Sam"), the requester is that person. Use only names that appear as senders.
- spec: positive requirements, one short criterion per entry ("unsweetened", "crunchy", "dozen").
- avoid: things it must NOT be ("whole wheat", "sweetened", "natural / oil separates", "dairy").
- max_price: a number if they gave a price ceiling.
- quantity: free text ("1", "a dozen", "2 bags").
- reason: WHY they want it this way, paraphrased from the chat. Keep it; later decisions depend on it.
- rigidity: "strict" if they insist, use words like must/only/has to/NOT, or it involves allergies or dietary rules; "flexible" if they say whatever/any/if they have it/on sale; otherwise "preferred".
- substitute_rule: what counts as an acceptable replacement, based on the reason ("any unsweetened oat brand OK, not almond").
- priority: "nice" if casual or optional, else "must".
- shared: true for household items or group meals ("we're out of dish soap", "for tacos thursday"). Set requester to the person who asked.
- source_messages: every message number you used for this item.

Rules:
- Messy follow-ups must be merged. "grab pasta" and later "not the whole wheat one again" are ONE item with avoid=["whole wheat"].
- If a request is later cancelled ("nvm", "found some", "don't need it"), leave it out.
- One item per product. A message listing several products becomes several items.
- A dietary fact about a person ("I'm lactose intolerant") applies to all of that person's items: add it to their avoid lists where relevant.
- Never invent requests. Media messages have unknown content; ignore them.
- preferences_learned: durable facts about a person that will matter on future trips (allergies, diets, dislikes, strong brand likes). Not one-off requests.
- unresolved: quote any message that seems to be a request but is too ambiguous to turn into an item.
- budget_hint: a number if the chat agreed on a budget, else null.
"""


def parse_chat_user(transcript: str, participants: list[str], known: dict[str, list[str]]) -> str:
    known_txt = "\n".join(f"- {p}: {'; '.join(f)}" for p, f in known.items() if f) or "(none yet)"
    return (
        f"Chat participants: {', '.join(participants)}\n\n"
        f"Known preferences from past trips (apply them when relevant):\n{known_txt}\n\n"
        f"CHAT:\n{transcript}"
    )


ANALYZE_SYSTEM = """\
You check one grocery product a shopper is holding against one person's request. The shopper glances at your answer while holding the product, so every detail must be short (max 10 words) and concrete.

For EACH spec criterion and EACH avoid criterion, output exactly one check:
- kind "spec": status pass if the product clearly meets it, fail if it clearly does not, unknown if you cannot read it.
- kind "avoid": status pass if the product is clearly NOT the avoided thing, fail if it is, unknown if unclear.
Also add at most one kind "preference" check using the person's known preferences (e.g. they disliked this brand before). Use fail for a clear conflict, warn for a possible one.

Read the product name and price from the packaging if visible.

alternative: only if the held product fails something. Give a short product_name a shopper would recognize on this shelf (e.g. "Oatly Unsweetened"), not a candidate id. Only suggest one if you are reasonably confident it would actually satisfy the request better.

Base everything on what is visible. Do not guess ingredients you cannot see; use unknown.
"""


def analyze_user(item: ContractItem, prefs: list[PreferenceFact]) -> str:
    req = item.model_dump(include={"item", "requester", "spec", "avoid", "max_price", "reason", "substitute_rule", "rigidity"})
    pref_txt = "\n".join(f"- {p.fact}" for p in prefs) or "(none)"
    return f"REQUEST:\n{json.dumps(req, indent=1)}\n\n{item.requester}'s known preferences:\n{pref_txt}"


DETECT_SYSTEM = """\
You locate grocery products in a shelf photo. For each text prompt given, find the best matching
product in the image and return a normalized bounding box [x, y, w, h] where x,y is the top-left
corner, all four values are fractions of the image width/height between 0 and 1, and w,h are the
box's width and height as fractions. If a prompt has no match in the image, omit it from the
output entirely (do not guess a box). confidence is your certainty in the match, 0 to 1.
"""


def detect_user(prompts: list[str]) -> str:
    return "Find these products in the image:\n" + "\n".join(f"- {p}" for p in prompts)

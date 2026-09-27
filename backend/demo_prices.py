"""Session-stable Gemini-generated demo prices; never real store prices."""
import time
import uuid
from decimal import Decimal, ROUND_HALF_UP

_QUOTES = {}
_PRICES = {}

def issue_quote(trip_id, product):
    if product.demo_unit_price is None or not product.matched_item_ids:
        return None
    key = (trip_id, product.name.casefold().strip())
    price = int((Decimal(str(product.demo_unit_price)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    _PRICES.setdefault(key, price)
    quote = {"id": uuid.uuid4().hex, "trip_id": trip_id, "name": product.name,
             "item_ids": product.matched_item_ids, "unit_cents": _PRICES[key],
             "expires": time.monotonic() + 900}
    _QUOTES[quote["id"]] = quote
    while len(_QUOTES) > 1000:
        _QUOTES.pop(next(iter(_QUOTES)))
    while len(_PRICES) > 1000:
        _PRICES.pop(next(iter(_PRICES)))
    return {"id": quote["id"], "unit_cents": quote["unit_cents"], "source": "Gemini demo estimate"}

def get_quote(id, trip_id, item_id):
    quote = _QUOTES.get(id)
    if not quote or quote["trip_id"] != trip_id or item_id not in quote["item_ids"] or quote["expires"] < time.monotonic():
        return None
    return quote

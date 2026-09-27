from test_integration import client, begin, clean
from gemini_identity import SceneProduct
from demo_prices import issue_quote

def quote(trip,price=3.49):
    return issue_quote(trip,SceneProduct(name="Doritos",category="chips",matched_item_ids=["i1"],visible_name="Doritos",box_2d=[0,0,900,900],view="front",demo_unit_price=price))

def test_demo_add_total_retry_and_provenance():
    trip=begin();q=quote(trip)
    assert quote(trip,9.99)["unit_cents"]==349
    body=dict(trip_id=trip,item_id="i1",quote_id=q["id"],quantity=2,acknowledge_unverified=True)
    first=client.post("/api/item/demo-add",json=body)
    assert first.status_code==200,first.text
    assert first.json()["spent"]==6.98
    line=first.json()["lines"][0]
    assert line["amount_cents"]==698 and not line["verified"]
    assert line["price_source"]=="Gemini demo estimate"
    assert client.post("/api/item/demo-add",json=body).json()["spent"]==6.98
    assert client.get("/api/settlement",params={"trip_id":trip}).json()["total"]==6.98

def test_quote_cannot_be_reused_for_other_trip_or_without_acknowledgement():
    trip=begin();q=quote(trip);other=begin()
    body=dict(trip_id=other,item_id="i1",quote_id=q["id"],quantity=1,acknowledge_unverified=True)
    assert client.post("/api/item/demo-add",json=body).status_code==409
    body.update(trip_id=trip,acknowledge_unverified=False)
    assert client.post("/api/item/demo-add",json=body).status_code==409
    body.update(acknowledge_unverified=True,quantity=0)
    assert client.post("/api/item/demo-add",json=body).status_code==422

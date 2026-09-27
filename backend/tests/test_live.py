from test_integration import client, clean, begin, photo, main
from live import LiveReading


def request(trip, **extra):
    return {"trip_id": trip, "track_id": "chips-1", "sequence": 1,
            "item_ids": ["i1"], "image_b64": photo(), **extra}


def test_live_analysis_is_recorded_for_cart():
    trip = begin()
    response = client.post('/api/product/observe', json=request(trip))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['track_id'] == 'chips-1'
    assert data['sequence'] == 1
    assert data['assessments'][0]['identity'] == 'pass'
    key = data['assessments'][0]['result']['analysis_id']
    assert main.ANALYSES[key][:2] == (trip, 'i1')
    assert main.TRIPS[trip]['considered']['i1'][0]['analysis_id'] == key


def test_live_rejects_wrong_trip_item_and_invalid_photo():
    trip = begin()
    assert client.post('/api/product/observe', json=request(trip, item_ids=['unknown'])).status_code == 404
    assert client.post('/api/product/observe', json=request(trip, image_b64='invalid')).status_code == 422


def test_changed_product_never_inherits_green_checks(monkeypatch):
    trip = begin()
    llm = main.get_llm()
    original = llm.json_call

    async def swapped(**kwargs):
        result = await original(**kwargs)
        return result.model_copy(update={'same_product': 'no'})

    monkeypatch.setattr(llm, 'json_call', swapped)
    data = client.post('/api/product/observe', json=request(trip, reference_b64=photo())).json()
    result = data['assessments'][0]
    assert result['identity'] == 'unknown'
    assert not result['result']['match']
    assert all(c['status'] != 'pass' for c in result['result']['checklist'])


def test_missing_assessment_is_unknown_not_silently_passed(monkeypatch):
    trip = begin()
    async def missing(**kwargs):
        return LiveReading(product_name='Unknown packet', visible_text='', view='unreadable', same_product='yes', assessments=[])
    monkeypatch.setattr(main.get_llm(), 'json_call', missing)
    data=client.post('/api/product/observe', json=request(trip)).json()
    assert data['assessments'][0]['identity']=='unknown'
    assert data['assessments'][0]['result']['match'] is False


def test_live_milk_text_overrides_model_pass(monkeypatch):
    trip=begin()
    llm=main.get_llm()
    original=llm.json_call
    async def milk(**kwargs):
        result=await original(**kwargs)
        result.assessments[0].analysis.visible_text='CONTAINS MILK INGREDIENTS'
        return result
    monkeypatch.setattr(llm,'json_call',milk)
    data=client.post('/api/product/observe',json=request(trip)).json()
    assert any(c['status']=='fail' and 'milk' in c['text'] for c in data['assessments'][0]['result']['checklist'])

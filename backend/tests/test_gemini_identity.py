import json
import asyncio
from types import SimpleNamespace
import pytest
import httpx
from fastapi import HTTPException
from test_live import client, begin, request
import gemini_identity as gemini


def test_identify_route_is_separate_from_ingredient_analysis(monkeypatch):
    async def fake(image, items):
        return gemini.ProductIdentity(name='Doritos', category='chips', matched_item_ids=[items[0].id], visible_name='Doritos')
    monkeypatch.setattr(gemini, 'identify_product', fake)
    trip = begin()
    response = client.post('/api/product/identify', json=request(trip))
    assert response.status_code == 200
    assert response.json()['name'] == 'Doritos'
    assert 'assessments' not in response.json()
    assert client.post('/api/product/identify', json=request(trip, item_ids=['alien'])).status_code == 404
    assert client.post('/api/product/identify', json=request(trip, image_b64='bad')).status_code == 422


def test_gemini_schema_and_membership(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-secret')
    original = httpx.AsyncClient
    def handler(request):
        assert request.headers['x-goog-api-key'] == 'test-secret'
        body = json.loads(request.content)
        assert body['generationConfig']['responseMimeType'] == 'application/json'
        return httpx.Response(200, json={'candidates': [{'finishReason':'STOP', 'content':{'parts':[{'text':json.dumps({
            'name':'Doritos', 'category':'chips', 'visible_name':'Doritos', 'matched_item_ids':['i1','alien']
        })}]}}]})
    monkeypatch.setattr(gemini.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    result = asyncio.run(gemini.identify_product('aGVsbG8=', [SimpleNamespace(id='i1', item='chips')]))
    assert result.matched_item_ids == ['i1']


def test_gemini_missing_key_is_actionable(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    with pytest.raises(HTTPException) as error:
        asyncio.run(gemini.identify_product('aGVsbG8=', []))
    assert error.value.status_code == 503


def test_gemini_quota_error_does_not_expose_provider_body(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-secret')
    original = httpx.AsyncClient
    monkeypatch.setattr(gemini.httpx, 'AsyncClient', lambda **kwargs: original(
        transport=httpx.MockTransport(lambda request: httpx.Response(429, text='private response')), **kwargs))
    with pytest.raises(HTTPException) as error:
        asyncio.run(gemini.identify_product('aGVsbG8=', []))
    assert error.value.status_code == 429
    assert 'private' not in error.value.detail


def test_suspended_consumer_has_safe_actionable_error(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-secret')
    original = httpx.AsyncClient
    monkeypatch.setattr(gemini.httpx, 'AsyncClient', lambda **kwargs: original(
        transport=httpx.MockTransport(lambda request: httpx.Response(403, json={'error':{
            'message':'private api_key:test-secret', 'details':[{'reason':'CONSUMER_SUSPENDED'}]}})), **kwargs))
    with pytest.raises(HTTPException) as error:
        asyncio.run(gemini.identify_product('aGVsbG8=', []))
    assert 'suspended' in error.value.detail
    assert 'test-secret' not in error.value.detail


def test_scene_boxes_and_unmatched_products(monkeypatch):
    async def fake(image, items, *, scene=False):
        assert scene
        return gemini.SceneIdentity(products=[gemini.SceneProduct(
            name='Oreo',category='cookies',matched_item_ids=[],visible_name='Oreo',
            box_2d=[100,200,500,700],view='front')])
    monkeypatch.setattr(gemini, 'identify_product', fake)
    trip=begin()
    response=client.post('/api/product/scene',json=request(trip))
    assert response.status_code==200
    assert response.json()['products'][0]['matched_item_ids']==[]
    assert response.json()['sequence']==1
    assert client.post('/api/product/scene',json=request(trip,image_b64='bad')).status_code==422
    assert client.post('/api/product/scene',json=request(trip,item_ids=['alien'])).status_code==404
    with pytest.raises(ValueError):
        gemini.SceneProduct(name='bad',category='chips',matched_item_ids=[],visible_name='',box_2d=[500,0,200,1200],view='front')

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
import json
import unittest
from unittest.mock import AsyncMock, patch
import httpx
from fastapi.testclient import TestClient
from main import app

class ChatTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.item = dict(requester='Alex', product='bananas', quantity=3, unit=None, max_budget=None, budget_scope=None, currency=None, preferences=[], restrictions=[], evidence=['Get 3 bananas.'], needs_clarification=[])

    def send(self, contract, finish='stop'):
        response = httpx.Response(200, json={'choices':[{'finish_reason':finish, 'message':{'content':json.dumps(contract)}}]})
        with patch.dict('os.environ', {'SAM_API_KEY':'test-only', 'MUSE_API_KEY':''}), patch('chat_contract.httpx.AsyncClient') as mock:
            post = AsyncMock(return_value=response)
            mock.return_value.__aenter__.return_value.post = post
            result = self.client.post('/api/chat/parse', content='Alex: Get 3 bananas.', headers={'Content-Type':'text/plain'})
            payload = post.call_args.kwargs['json']
            self.assertTrue(payload['response_format']['json_schema']['strict'])
            self.assertEqual(payload['messages'][1]['content'], 'Alex: Get 3 bananas.')
            return result

    def test_valid_and_empty(self):
        for items in [[self.item], []]:
            contract = dict(items=items, shared_constraints=[], unresolved_questions=[])
            response = self.send(contract)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['contract'], contract)

    def test_unsupported_output(self):
        for change in [{'evidence':['invented quote']}, {'quantity':-1}, {'budget_scope':'weekly'}, {'max_budget':-2}]:
            contract = dict(items=[dict(self.item, **change)], shared_constraints=[], unresolved_questions=[])
            self.assertEqual(self.send(contract).status_code, 502)
        self.assertEqual(self.send(dict(items=[], shared_constraints=[], unresolved_questions=[]), 'length').status_code, 502)

    def test_duplicate_items_removed_in_api_response(self):
        contract = dict(items=[self.item, self.item.copy()], shared_constraints=[], unresolved_questions=[])
        response = self.send(contract)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['contract']['items'], [self.item])

    def test_distinct_requests_preserved(self):
        variants = [dict(self.item, requester='Priya'), dict(self.item, quantity=4),
                    dict(self.item, restrictions=['Organic']), dict(self.item, max_budget=5),
                    dict(self.item, evidence=['3 bananas'])]
        contract = dict(items=[self.item, *variants, self.item.copy()], shared_constraints=[], unresolved_questions=[])
        response = self.send(contract)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['contract']['items'], [self.item, *variants])

    def test_list_order_does_not_create_duplicate(self):
        first = dict(self.item, restrictions=['Organic', 'Ripe'])
        second = dict(self.item, restrictions=['Ripe', 'Organic'])
        response = self.send(dict(items=[first, second], shared_constraints=[], unresolved_questions=[]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['contract']['items'], [first])

    def test_input_limits(self):
        for data, status in [('',400), ('x'*20001,400), ('x'*100001,413), (b'\xff',400)]:
            self.assertEqual(self.client.post('/api/chat/parse', content=data, headers={'Content-Type':'text/plain'}).status_code,status)
        self.assertEqual(self.client.post('/api/chat/parse',json={}).status_code,415)

    def test_missing_key(self):
        with patch.dict('os.environ', {'SAM_API_KEY':'', 'MUSE_API_KEY':''}):
            self.assertEqual(self.client.post('/api/chat/parse', content='Get milk', headers={'Content-Type':'text/plain'}).status_code,503)

if __name__ == '__main__':
    unittest.main()

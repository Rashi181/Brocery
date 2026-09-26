import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
import unittest
import json
from io import BytesIO
from unittest.mock import patch, AsyncMock
import httpx
from PIL import Image
from fastapi.testclient import TestClient
from main import app

class ProductTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        image = BytesIO()
        Image.new('RGB',(64,64),'white').save(image,'JPEG')
        self.image = image.getvalue()
        self.label = dict(product_name='Oat milk',price=4.5,currency='USD',price_basis='single_package',visible_text='Oat milk USD 4.50',ingredients_text=None,warnings=[])

    def send(self, label, status=200):
        response = httpx.Response(status,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(label)}}]})
        with patch.dict('os.environ',{'SAM_API_KEY':'test-only','MUSE_API_KEY':''}), patch('product_label.httpx.AsyncClient') as mock:
            post = AsyncMock(return_value=response)
            mock.return_value.__aenter__.return_value.post = post
            result = self.client.post('/api/product/read',content=self.image,headers={'Content-Type':'image/jpeg'})
            payload = post.call_args.kwargs['json']
            self.assertTrue(payload['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,'))
            return result

    def test_readable_and_unknown(self):
        for label in [self.label,dict(self.label,product_name=None,price=None,currency=None,visible_text='',price_basis='unknown')]:
            response = self.send(label)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['label'],label)

    def test_bad_evidence_and_price_rejected(self):
        for change in [dict(product_name='Invented name'),dict(ingredients_text='Made up ingredients'),dict(price=-1),dict(price=float('inf'))]:
            self.assertEqual(self.send(dict(self.label,**change)).status_code,502)

    def test_upstream_error_sanitized(self):
        response = self.send(self.label,401)
        self.assertEqual(response.status_code,502)
        self.assertEqual(response.json()['detail'],'Meta rejected the API key')

    def test_invalid_image(self):
        self.assertEqual(self.client.post('/api/product/read',content=b'bad',headers={'Content-Type':'image/jpeg'}).status_code,400)

if __name__ == '__main__':
    unittest.main()

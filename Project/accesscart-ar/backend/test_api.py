from pathlib import Path
import sys
import unittest
from io import BytesIO
import hashlib

sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
from fastapi.testclient import TestClient
from PIL import Image
from main import app, MAX_BYTES, parse_segmentation
from unittest.mock import patch, AsyncMock
import httpx
import ast

class CameraUploadTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def jpeg(self, size=(640, 360)):
        buffer = BytesIO()
        Image.new("RGB", size, "green").save(buffer, "JPEG")
        return buffer.getvalue()

    def test_jpeg_roundtrip(self):
        data = self.jpeg()
        response = self.client.post("/api/frames", content=data, headers={"Content-Type": "image/jpeg"})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual((result["width"], result["height"]), (640, 360))
        self.assertEqual(result["bytes"], len(data))
        self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())

    def test_segmentation_masks(self):
        # Published parser example: two valid encoded masks, not mocked geometry.
        metadata = (Path(__file__).parent / "vendor/meta_sam_parser-0.0.6.dist-info/METADATA").read_text(encoding="utf-8")
        example = metadata.split("output_text = (", 1)[1].split("\n)", 1)[0]
        text = ast.literal_eval("(" + example + "\n)")
        payload = {"status": "completed", "output": [{"content": [{"type": "output_text", "text": text}]}]}
        objects, overlay = parse_segmentation(payload, 320, 334)
        self.assertEqual(len(objects), 2)
        import base64
        image = Image.open(BytesIO(base64.b64decode(overlay.split(",", 1)[1])))
        self.assertEqual(image.size, (320, 334))
        self.assertIsNotNone(image.getbbox())

    def test_segment_endpoint(self):
        response = httpx.Response(200, json={"status": "completed", "output": []})
        with patch.dict("os.environ", {"SAM_API_KEY": "test-only"}), patch("main.httpx.AsyncClient") as factory:
            client = factory.return_value.__aenter__.return_value
            client.post = AsyncMock(return_value=response)
            result = self.client.post("/api/segment?prompt=bottle", content=self.jpeg(), headers={"Content-Type": "image/jpeg"})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["objects"], [])
            sent = client.post.call_args.kwargs
            self.assertEqual(sent["json"]["model"], "sam-3.1")
            self.assertTrue(sent["json"]["input"][0]["content"][1]["image_url"].startswith("data:image/jpeg;base64,"))
            client.post.return_value = httpx.Response(401, json={"error": "secret upstream details"})
            result = self.client.post("/api/segment", content=self.jpeg(), headers={"Content-Type": "image/jpeg"})
            self.assertEqual(result.status_code, 502)
            self.assertNotIn("secret upstream", result.text)
        with patch.dict("os.environ", {"SAM_API_KEY": ""}):
            result = self.client.post("/api/segment", content=self.jpeg(), headers={"Content-Type": "image/jpeg"})
            self.assertEqual(result.status_code, 503)

    def test_invalid_uploads(self):
        for data, mime, expected in [(b"", "image/jpeg", 400), (b"broken", "image/jpeg", 400),
                                      (b"text", "text/plain", 415),
                                      (b"x" * (MAX_BYTES + 1), "image/jpeg", 413),
                                      (self.jpeg((2001, 2000)), "image/jpeg", 413)]:
            with self.subTest(expected=expected, size=len(data)):
                response = self.client.post("/api/frames", content=data, headers={"Content-Type": mime})
                self.assertEqual(response.status_code, expected)

if __name__ == "__main__":
    unittest.main()

# Test 9: camera upload

From the accesscart-ar directory, start the backend in a VS Code PowerShell terminal:

    powershell -ExecutionPolicy Bypass -File backend/start.ps1

Leave it running. Vite forwards /api to 127.0.0.1:8000, so keep using the same Cloudflare URL pointing at the Vite development server. If Vite does not restart automatically after the config change, restart npm run dev.

On the phone: refresh, START AR, CAPTURE RAW FRAME, then SEND FRAME TO LAPTOP. Success displays the JPEG dimensions and byte count returned by FastAPI. Images are decoded in memory and not saved. This verifies transport only; segmentation is Test 10.

Dependencies are installed locally under backend/vendor. For a fresh checkout, install requirements with Python:

    python -m pip install --target backend/vendor -r backend/requirements.txt

Run backend tests:

    python backend/test_api.py

The /api proxy is for Vite development. A deployed production frontend will need its own reverse proxy.

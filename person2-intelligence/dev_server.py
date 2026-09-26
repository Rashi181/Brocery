"""Run the AI endpoints alone:  uvicorn dev_server:app --reload --port 8002
Docs at http://localhost:8002/docs  (try every endpoint from the browser)."""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from intelligence.errors import install_error_handlers
from intelligence.router import router

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
app = FastAPI(title="Household shopping AI (Person 2)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
install_error_handlers(app)
app.include_router(router)

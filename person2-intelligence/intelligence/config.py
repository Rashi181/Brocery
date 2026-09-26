"""Settings for the intelligence package. Every value is read from the
environment each time it's accessed, so tests and check scripts can flip
modes without restarting."""

import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    # --- LLM (Muse Spark via Meta Model API, OpenAI-compatible) ---
    @property
    def llm_mode(self) -> str:  # "mock" or "live"
        return os.getenv("LLM_MODE", "mock").lower()

    @property
    def meta_api_key(self) -> str:
        return (
            os.getenv("MUSE_API_KEY")
            or os.getenv("META_API_KEY")
            or os.getenv("SAM_API_KEY", "")
        )

    @property
    def muse_base_url(self) -> str:
        return os.getenv("MUSE_BASE_URL", "https://api.meta.ai/v1")

    @property
    def muse_model(self) -> str:
        return os.getenv("MUSE_MODEL", "muse-spark-1.3")

    @property
    def muse_reasoning_effort(self) -> str:
        return os.getenv("MUSE_REASONING_EFFORT", "")

    @property
    def llm_timeout(self) -> float:
        return float(os.getenv("LLM_TIMEOUT", "90"))

    # --- SAM 3.1 (vision/detect) ---
    @property
    def sam_mode(self) -> str:  # "mock" or "live"
        return os.getenv("SAM_MODE", "mock").lower()

    @property
    def sam_endpoint_url(self) -> str:
        # Fill in once you have real SAM 3.1 access at the event. See
        # intelligence/vision.py: _call_sam_live() for exactly what to edit.
        return os.getenv("SAM_ENDPOINT_URL", "")

    @property
    def sam_api_key(self) -> str:
        return os.getenv("SAM_API_KEY", "")

    @property
    def sam_confidence_threshold(self) -> float:
        return float(os.getenv("SAM_CONFIDENCE_THRESHOLD", "0.5"))

    # --- Preferences (Backboard with local mirror) ---
    @property
    def pref_mode(self) -> str:  # "local" or "backboard"
        return os.getenv("PREF_MODE", "local").lower()

    @property
    def backboard_api_key(self) -> str:
        return os.getenv("BACKBOARD_API_KEY", "")

    @property
    def backboard_assistant_id(self) -> str:
        return os.getenv("BACKBOARD_ASSISTANT_ID", "")

    @property
    def local_pref_path(self) -> str:
        return os.getenv("LOCAL_PREF_PATH", ".prefs.json")

    # --- Chat parsing ---
    @property
    def chat_window_days(self) -> int:
        return int(os.getenv("CHAT_WINDOW_DAYS", "14"))

    @property
    def date_order(self) -> str:  # "auto", "MDY" or "DMY"
        return os.getenv("CHAT_DATE_ORDER", "auto").upper()

    # --- Mock behaviour ---
    @property
    def mock_analysis_scenario(self) -> str:  # "match" or "mismatch"
        return os.getenv("MOCK_ANALYSIS_SCENARIO", "match").lower()


settings = Settings()

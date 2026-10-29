"""Minimal client for free-tier LLM providers via their OpenAI-compatible chat endpoints.

Supported: Google Gemini (free tier via AI Studio key), Groq (free tier), Mistral
(free "Experiment" plan) and xAI Grok (paid). Calls are spaced to respect free-tier
rate limits and retried on 429/5xx with backoff.
"""

import json
import logging
import re
import threading
import time
from dataclasses import dataclass

import httpx

from pipeline.config import Settings, get_settings

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Provider:
    base_url: str
    default_model: str
    key_setting: str


PROVIDERS: dict[str, Provider] = {
    "gemini": Provider("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.8-flash", "gemini_api_key"),
    "groq": Provider("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", "groq_api_key"),
    "mistral": Provider("https://api.mistral.ai/v1", "mistral-small-latest", "mistral_api_key"),
    "xai": Provider("https://api.x.ai/v1", "grok-4.3", "xai_api_key"),
}

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


class LLMError(Exception):
    pass


def parse_json_object(content: str) -> dict:
    """Parse a JSON object from model output, tolerating code fences and surrounding prose."""
    text = _FENCE.sub("", content.strip())
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise LLMError("Model response contained no JSON object")
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise LLMError(f"Model response was not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise LLMError("Model response JSON is not an object")
    return value


class LLMClient:
    _lock = threading.Lock()
    _last_call = 0.0

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.provider_name = self.settings.llm_provider.lower()
        provider = PROVIDERS.get(self.provider_name)
        self.provider = provider
        self.model = (self.settings.llm_model or (provider.default_model if provider else None))
        self.api_key = getattr(self.settings, provider.key_setting) if provider else None
        self._json_mode = True

    @property
    def available(self) -> bool:
        return self.provider is not None and bool(self.api_key)

    def describe(self) -> str:
        return f"{self.provider_name}:{self.model}" if self.available else "none"

    def _wait_for_slot(self) -> None:
        with LLMClient._lock:
            wait = LLMClient._last_call + self.settings.llm_min_interval_seconds - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            LLMClient._last_call = time.monotonic()

    def complete_json(self, system: str, user: str) -> dict:
        if not self.available:
            raise LLMError(f"LLM provider '{self.provider_name}' is not configured (missing API key?)")
        url = f"{self.provider.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        last_error = "unknown error"
        for attempt in range(self.settings.llm_max_retries + 1):
            body = {
                "model": self.model,
                "temperature": 0.2,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            }
            if self._json_mode:
                body["response_format"] = {"type": "json_object"}
            self._wait_for_slot()
            try:
                resp = httpx.post(url, json=body, headers=headers, timeout=self.settings.llm_timeout_seconds)
            except httpx.HTTPError as exc:
                last_error = f"network error: {exc}"
                time.sleep(2 ** attempt)
                continue

            if resp.status_code == 400 and self._json_mode and "response_format" in resp.text:
                log.info("%s rejected JSON mode; retrying with prompt-only JSON", self.describe())
                self._json_mode = False
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                retry_after = resp.headers.get("retry-after")
                delay = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else 5 * 2 ** attempt
                last_error = f"HTTP {resp.status_code}"
                log.warning("%s returned %s; retrying in %.0fs", self.describe(), resp.status_code, delay)
                time.sleep(min(delay, 60))
                continue
            if resp.status_code >= 400:
                raise LLMError(f"{self.describe()} returned HTTP {resp.status_code}: {resp.text[:300]}")

            try:
                content = resp.json()["choices"][0]["message"]["content"] or ""
                return parse_json_object(content)
            except (KeyError, IndexError, ValueError, LLMError) as exc:
                last_error = f"unparseable response: {exc}"
                continue
        raise LLMError(f"{self.describe()} failed after retries ({last_error})")

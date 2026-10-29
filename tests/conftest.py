"""Shared fixtures: an isolated SQLite database and deterministic fake NLP models."""

import hashlib
import os
from datetime import datetime, timedelta

import numpy as np
import pytest

os.environ["DATABASE_URL"] = "sqlite://"  # never touch a real database from tests
os.environ["LLM_PROVIDER"] = "none"

from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import database.session as db_session  # noqa: E402
from database.models import App, Base, Review  # noqa: E402
from pipeline.preprocessing import preprocess  # noqa: E402

TOPICS = {
    "crash": (["crash", "crashes", "closes", "freezes", "won't open"], np.eye(8, dtype=np.float32)[0]),
    "otp": (["otp", "verification code", "login code", "sign in"], np.eye(8, dtype=np.float32)[1]),
    "payment": (["charged twice", "payment", "refund", "deducted"], np.eye(8, dtype=np.float32)[2]),
}


class FakeSentiment:
    name = "fake-sentiment"

    def predict(self, texts):
        return [("negative", 0.9) if any(w in t.lower() for w in ("crash", "otp", "charged", "never", "lost")) else ("positive", 0.8) for t in texts]


class FakeClassifier:
    name = "fake-zero-shot"

    def predict(self, texts):
        out = []
        for t in texts:
            t = t.lower()
            if "crash" in t or "freez" in t:
                out.append(("crash_stability", 0.8))
            elif "otp" in t or "code" in t:
                out.append(("login_auth", 0.8))
            elif "charged" in t or "refund" in t:
                out.append(("payment_billing", 0.8))
            else:
                out.append(("praise", 0.7))
        return out


class FakeEmbedder:
    """Topic one-hot plus small deterministic noise, L2-normalised."""

    name = "fake-embedder"

    def encode(self, texts):
        vectors = []
        for t in texts:
            base = np.full(8, 0.0, dtype=np.float32)
            for words, axis in TOPICS.values():
                if any(w in t.lower() for w in words):
                    base += axis
            if not base.any():
                base[7] = 1.0
            seed = int(hashlib.md5(t.encode()).hexdigest()[:8], 16)
            noise = np.random.default_rng(seed).normal(0, 0.05, 8).astype(np.float32)
            v = base + noise
            vectors.append(v / np.linalg.norm(v))
        return np.stack(vectors)


class FakeModels:
    def __init__(self):
        self.sentiment, self.classifier, self.embedder = FakeSentiment(), FakeClassifier(), FakeEmbedder()

    def versions(self):
        return {"sentiment": self.sentiment.name, "classifier": self.classifier.name, "embedding": self.embedder.name}


@pytest.fixture()
def engine(monkeypatch):
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(eng, "connect")
    def _fk(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(eng)
    maker = sessionmaker(bind=eng, expire_on_commit=False)
    monkeypatch.setattr(db_session, "get_engine", lambda: eng)
    monkeypatch.setattr(db_session, "get_sessionmaker", lambda: maker)
    yield eng
    eng.dispose()


@pytest.fixture()
def session(engine):
    s = sessionmaker(bind=engine, expire_on_commit=False)()
    yield s
    s.close()


CRASH_TEXTS = [
    "The app crashes every time I open the camera screen",
    "Since the update it crashes on startup and closes immediately",
    "App freezes and then crashes when I open my profile page",
    "Keeps crashing after the latest update, it won't open at all",
    "It crashes whenever I try to upload a photo from the gallery",
    "Constant crashes on launch since yesterday, completely unusable now",
    "crashes when switching tabs, please fix this crash bug soon",
    "The app crashes during checkout and closes without any error",
]
OTP_TEXTS = [
    "OTP never arrives so I cannot sign in to my account",
    "Verification code never comes, stuck on the login code screen",
    "I never get the OTP SMS, cannot log in for two days",
    "Login code not received, sign in is impossible right now",
    "The OTP takes forever and then expires before it arrives",
    "Cannot sign in because the verification code never shows up",
]
PAYMENT_TEXTS = [
    "I was charged twice for one order and no refund yet",
    "Payment deducted from my bank but order failed, need refund",
    "Got charged twice again, support ignores my refund request",
    "Money deducted twice and the refund never came back to me",
    "Charged twice for the subscription, where is my refund",
]
PRAISE_TEXTS = ["Great app, works perfectly for me every day", "Love it", "Very nice and simple design overall"]


@pytest.fixture()
def seeded_app(session):
    """An app with clustered complaint themes spread over the last few weeks."""
    app = App(id="com.example.app", title="Example", store_url="https://play.google.com/store/apps/details?id=com.example.app")
    session.add(app)
    now = datetime(2026, 10, 15, 12, 0)
    texts = [(t, 1) for t in CRASH_TEXTS] + [(t, 2) for t in OTP_TEXTS] + [(t, 1) for t in PAYMENT_TEXTS] + [(t, 5) for t in PRAISE_TEXTS * 4]
    for i, (text, rating) in enumerate(texts):
        session.add(Review(
            app_id=app.id, source_review_id=f"r{i}", original_text=text, rating=rating,
            thumbs_up=i % 3, review_date=now - timedelta(days=i % 30), app_version="2.4.1" if i % 2 else "2.4.0",
            **preprocess(text, "en"),
        ))
    session.commit()
    return app

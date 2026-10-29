"""Pretrained NLP models: sentiment, zero-shot issue classification and sentence embeddings.

Models are loaded lazily and cached per process. Tests inject lightweight fakes
that implement the same ``name`` / ``predict`` / ``encode`` interface.
"""

import logging
import re
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from pipeline.config import get_settings
from pipeline.taxonomy import CATEGORIES, OTHER, TAXONOMY_VERSION

log = logging.getLogger(__name__)

# _FLOAT32_NOTE: recent transformers releases load weights in the checkpoint's dtype, and several
# zero-shot checkpoints are float16. Half precision is ~17x slower on CPU, so models are cast to float32.

_STAR_LABEL = re.compile(r"(\d)\s*star")
_SENTIMENT_ALIASES = {
    "negative": "negative", "neg": "negative", "label_0": "negative",
    "neutral": "neutral", "neu": "neutral", "label_1": "neutral",
    "positive": "positive", "pos": "positive", "label_2": "positive",
}


def map_sentiment_label(label: str) -> str:
    """Map the label vocabulary of common sentiment models onto negative/neutral/positive."""
    key = label.lower().strip()
    if key in _SENTIMENT_ALIASES:
        return _SENTIMENT_ALIASES[key]
    if match := _STAR_LABEL.search(key):  # e.g. nlptown "1 star" ... "5 stars"
        stars = int(match.group(1))
        return "negative" if stars <= 2 else "neutral" if stars == 3 else "positive"
    raise ValueError(f"Unrecognised sentiment label '{label}'")


class SentimentModel:
    def __init__(self, name: str, batch_size: int):
        from transformers import pipeline

        log.info("Loading sentiment model %s", name)
        self.name = name
        self.batch_size = batch_size
        self._pipe = pipeline("text-classification", model=name, device=-1)
        self._pipe.model.float()  # see _FLOAT32_NOTE

    def predict(self, texts: list[str]) -> list[tuple[str, float]]:
        outputs = self._pipe(texts, batch_size=self.batch_size, truncation=True, max_length=256)
        return [(map_sentiment_label(o["label"]), float(o["score"])) for o in outputs]


class ZeroShotClassifier:
    """Zero-shot NLI over the fixed taxonomy. Low-confidence predictions become 'other'."""

    hypothesis_template = "This app review is about {}."

    def __init__(self, name: str, batch_size: int, min_confidence: float):
        from transformers import pipeline

        log.info("Loading zero-shot model %s", name)
        self.name = f"{name}@taxonomy-v{TAXONOMY_VERSION}"
        self.batch_size = batch_size
        self.min_confidence = min_confidence
        self._key_by_hypothesis = {c.hypothesis: c.key for c in CATEGORIES}
        self._pipe = pipeline("zero-shot-classification", model=name, device=-1)
        self._pipe.model.float()  # see _FLOAT32_NOTE

    def predict(self, texts: list[str]) -> list[tuple[str, float]]:
        outputs = self._pipe(
            texts,
            candidate_labels=list(self._key_by_hypothesis),
            hypothesis_template=self.hypothesis_template,
            multi_label=False,
            batch_size=self.batch_size,
        )
        if isinstance(outputs, dict):
            outputs = [outputs]
        results = []
        for out in outputs:
            key, score = self._key_by_hypothesis[out["labels"][0]], float(out["scores"][0])
            results.append((key if score >= self.min_confidence else OTHER.key, score))
        return results


class Embedder:
    def __init__(self, name: str, batch_size: int):
        from sentence_transformers import SentenceTransformer

        log.info("Loading embedding model %s", name)
        self.name = name
        self.batch_size = batch_size
        self._model = SentenceTransformer(name, device="cpu").float()  # see _FLOAT32_NOTE

    def encode(self, texts: list[str]) -> np.ndarray:
        vectors = self._model.encode(
            texts, batch_size=self.batch_size, normalize_embeddings=True,
            convert_to_numpy=True, show_progress_bar=False,
        )
        return vectors.astype(np.float32)


@dataclass
class NLPModels:
    sentiment: SentimentModel
    classifier: ZeroShotClassifier
    embedder: Embedder

    def versions(self) -> dict:
        return {"sentiment": self.sentiment.name, "classifier": self.classifier.name, "embedding": self.embedder.name}


@lru_cache
def get_models() -> NLPModels:
    s = get_settings()
    return NLPModels(
        sentiment=SentimentModel(s.sentiment_model, s.inference_batch_size),
        classifier=ZeroShotClassifier(s.zero_shot_model, s.inference_batch_size, s.category_min_confidence),
        embedder=Embedder(s.embedding_model, s.inference_batch_size * 2),
    )

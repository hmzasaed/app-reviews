"""Text normalisation that keeps diagnostic detail (negations, punctuation, versions)."""

import re
import unicodedata

from langdetect import DetectorFactory, LangDetectException, detect_langs

DetectorFactory.seed = 0  # make langdetect deterministic

_CONTROL_CHARS = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏⁠﻿]")
_WHITESPACE = re.compile(r"\s+")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
# Phone/card-like digit runs (9+ digits allowing separators). Dotted versions like 2.4.1 are untouched.
_LONG_NUMBER = re.compile(r"(?<!\w)(?<!\d\.)\+?\d(?:[\d\s\-()]{7,}\d)(?!\w)(?!\.\d)")
_HAS_LETTER = re.compile(r"[^\W\d_]")
_WORD = re.compile(r"[^\W_]+")


def normalize_text(text: str | None) -> str:
    """Unicode NFKC, strip control/zero-width characters, collapse whitespace."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = _CONTROL_CHARS.sub("", text)
    return _WHITESPACE.sub(" ", text).strip()


def mask_pii(text: str) -> str:
    """Mask e-mail addresses and long digit runs (phone, card, account numbers)."""
    text = _EMAIL.sub("[email]", text)
    return _LONG_NUMBER.sub(lambda m: "[number]" if sum(ch.isdigit() for ch in m.group()) >= 9 else m.group(), text)


def is_empty_review(text: str) -> bool:
    """True for blank, emoji-only or punctuation-only content."""
    return not _HAS_LETTER.search(text)


def word_count(text: str) -> int:
    return len(_WORD.findall(text))


def detect_language(text: str, fallback: str | None) -> str | None:
    """Detect language, preferring the store language whenever detection is not clear-cut.

    langdetect is confidently wrong on short reviews ("so far so good" -> Somali), so short
    texts, low-confidence results and texts where the store language is a candidate all
    keep the store language.
    """
    if word_count(text) < 6:
        return fallback
    try:
        candidates = detect_langs(text)
    except LangDetectException:
        return fallback
    if fallback and any(c.lang == fallback and c.prob >= 0.1 for c in candidates):
        return fallback
    return candidates[0].lang if candidates[0].prob >= 0.85 else fallback


def preprocess(original: str | None, store_lang: str | None) -> dict:
    normalized = mask_pii(normalize_text(original))
    empty = is_empty_review(normalized)
    return {
        "normalized_text": normalized,
        "is_empty": empty,
        "language": None if empty else detect_language(normalized, store_lang),
    }

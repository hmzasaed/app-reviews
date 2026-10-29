import pytest

from pipeline.ingestion import parse_app_id
from pipeline.nlp import map_sentiment_label
from pipeline.preprocessing import is_empty_review, mask_pii, normalize_text, preprocess


@pytest.mark.parametrize("value, expected", [
    ("com.example.app", "com.example.app"),
    ("https://play.google.com/store/apps/details?id=com.whatsapp&hl=en", "com.whatsapp"),
    ("play.google.com/store/apps/details?id=org.telegram.messenger", "org.telegram.messenger"),
    ("  com.Example_1.app2  ", "com.Example_1.app2"),
])
def test_parse_app_id_valid(value, expected):
    assert parse_app_id(value) == expected


@pytest.mark.parametrize("value", ["notapackage", "https://example.com/?id=com.x.y", "https://play.google.com/store/apps", "1com.bad.id"])
def test_parse_app_id_invalid(value):
    with pytest.raises(ValueError):
        parse_app_id(value)


def test_normalize_keeps_negations_and_punctuation():
    text = "It   does​n't work!!\n\nNever   opens on v2.4.1"
    assert normalize_text(text) == "It doesn't work!! Never opens on v2.4.1"


def test_mask_pii_masks_contacts_but_not_versions():
    masked = mask_pii("Email me at jane.doe@mail.com or call +1 (555) 123-4567. Version 2.4.1 build 20261018")
    assert "[email]" in masked and "jane.doe" not in masked
    assert "[number]" in masked and "555" not in masked
    assert "2.4.1" in masked and "20261018" in masked  # 8 digits: not masked


def test_empty_review_detection():
    assert is_empty_review("👍👍👍")
    assert is_empty_review("!!! ...")
    assert not is_empty_review("ok")


def test_short_text_uses_store_language():
    assert preprocess("nice app", "en")["language"] == "en"
    assert preprocess("", "en") == {"normalized_text": "", "is_empty": True, "language": None}


@pytest.mark.parametrize("text", ["very poor software working", "so far so good", "best app for all", "it's much better now honestly"])
def test_english_reviews_that_langdetect_misreads_stay_english(text):
    assert preprocess(text, "en")["language"] == "en"


def test_clearly_foreign_reviews_are_detected():
    text = "Kalau tidak bisa di update jangan kasih update, aplikasi ini sangat lambat dan sering keluar sendiri"
    assert preprocess(text, "en")["language"] == "id"


@pytest.mark.parametrize("label, expected", [
    ("negative", "negative"), ("LABEL_1", "neutral"), ("Positive", "positive"), ("1 star", "negative"), ("3 stars", "neutral"), ("5 stars", "positive"),
])
def test_sentiment_label_mapping(label, expected):
    assert map_sentiment_label(label) == expected

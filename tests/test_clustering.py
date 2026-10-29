import numpy as np

from pipeline.clustering import (
    NOISE, build_clusters, cluster_labels, effective_min_cluster_size, extract_keywords, match_clusters,
    merge_similar_labels, select_representatives,
)
from tests.conftest import CRASH_TEXTS, OTP_TEXTS, PAYMENT_TEXTS, FakeEmbedder


def _data():
    texts = CRASH_TEXTS + OTP_TEXTS + PAYMENT_TEXTS + ["random unrelated words about weather", "my cat likes the colour blue"]
    return texts, FakeEmbedder().encode(texts)


def test_hdbscan_and_baseline_separate_topics():
    texts, emb = _data()
    for method in ("hdbscan", "agglomerative"):
        labels = cluster_labels(emb, method=method, min_cluster_size=4, distance_threshold=0.3)
        crash_labels = set(labels[: len(CRASH_TEXTS)])
        otp_labels = set(labels[len(CRASH_TEXTS): len(CRASH_TEXTS) + len(OTP_TEXTS)])
        assert len(crash_labels) == 1 and NOISE not in crash_labels, method
        assert crash_labels.isdisjoint(otp_labels), method


def test_too_few_points_are_all_noise():
    _, emb = _data()
    assert (cluster_labels(emb[:6], min_cluster_size=5) == NOISE).all()


def test_build_clusters_keywords_and_centroids():
    texts, emb = _data()
    labels = cluster_labels(emb, method="agglomerative", min_cluster_size=4, distance_threshold=0.3)
    clusters = build_clusters(emb, labels, texts)
    assert clusters[0].members == list(range(len(CRASH_TEXTS)))  # largest first
    assert any("crash" in k for k in clusters[0].keywords)
    for c in clusters:
        assert abs(np.linalg.norm(c.centroid) - 1) < 1e-5


def test_keywords_ignore_stop_words():
    kws = extract_keywords([["the app crashes on startup", "app crashes again"], ["otp code never arrives", "no otp code"]])
    assert "app" not in kws[0] and "the" not in kws[0]
    assert any("otp" in k for k in kws[1])


def test_representatives_skip_near_duplicates():
    v = np.array([[1, 0], [1, 0], [0.9, 0.436]], dtype=np.float32)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    reps = select_representatives(v, np.array([1, 0], dtype=np.float32), k=3)
    assert reps == [0, 2]


def test_match_clusters_is_one_to_one_and_thresholded():
    a, b = np.array([1, 0], dtype=np.float32), np.array([0, 1], dtype=np.float32)
    matches = match_clusters([a, b, a], {10: a, 20: b}, threshold=0.8)
    assert matches == {0: 10, 1: 20}
    assert match_clusters([a], {20: b}, threshold=0.8) == {}


def test_merge_similar_labels_is_conservative():
    rng = np.random.default_rng(0)
    base = {0: [1, 0, 0, 0], 1: [0.95, 0.31, 0, 0], 2: [0.6, 0.8, 0, 0], 3: [0, 0, 1, 0]}
    labels = np.repeat([0, 1, 2, 3], 5)
    emb = np.stack([np.array(base[l], dtype=np.float32) + rng.normal(0, 0.01, 4) for l in labels] + [np.array([0, 0, 0, 1.0])])
    emb = (emb / np.linalg.norm(emb, axis=1, keepdims=True)).astype(np.float32)
    merged = merge_similar_labels(emb, np.append(labels, NOISE), threshold=0.9)
    assert merged[0] == merged[5]  # clusters 0 and 1 are near-duplicates (cos ~0.95)
    assert len({merged[0], merged[10], merged[15]}) == 3  # 2 is only ~0.6-0.8 similar; 3 is unrelated
    assert merged[-1] == NOISE


def test_min_cluster_size_scales_with_data():
    assert effective_min_cluster_size(20, 5) == 5
    assert effective_min_cluster_size(2500, 5) == 25

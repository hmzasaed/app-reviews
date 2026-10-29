"""Topic clustering: group complaints that describe the same underlying problem.

Default: UMAP (cosine) -> HDBSCAN, leaving unrelated reviews as noise (label -1),
followed by c-TF-IDF keywords per cluster (the BERTopic recipe, without the extra
dependency). An agglomerative cosine-threshold baseline is available for comparison.
"""

import logging
from dataclasses import dataclass

import numpy as np
from sklearn.cluster import HDBSCAN, AgglomerativeClustering
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, CountVectorizer

log = logging.getLogger(__name__)

NOISE = -1
KEYWORD_STOP_WORDS = sorted(
    ENGLISH_STOP_WORDS
    | {"app", "apps", "application", "please", "pls", "plz", "just", "really", "good", "bad", "like",
       "use", "using", "time", "dont", "don", "doesn", "didn", "isn", "can", "cant", "won", "ve", "ll",
       "im", "it", "thing", "things", "make", "makes", "way", "even", "also", "still", "get", "got"}
)


@dataclass
class Cluster:
    label: int
    members: list[int]  # indices into the input arrays
    centroid: np.ndarray  # L2-normalised
    keywords: list[str]


def effective_min_cluster_size(n: int, configured: int) -> int:
    """Scale the minimum cluster size with the dataset so large apps don't yield hundreds of micro-clusters."""
    return max(configured, int(round(np.sqrt(n) / 2)))


def cluster_labels(
    embeddings: np.ndarray,
    method: str = "hdbscan",
    min_cluster_size: int = 5,
    distance_threshold: float = 0.45,
    random_state: int = 42,
) -> np.ndarray:
    n = len(embeddings)
    if n < max(min_cluster_size * 2, 10):
        return np.full(n, NOISE)

    if method == "agglomerative":
        labels = AgglomerativeClustering(
            n_clusters=None, metric="cosine", linkage="average", distance_threshold=distance_threshold
        ).fit_predict(embeddings)
        sizes = np.bincount(labels)
        return np.where(sizes[labels] >= min_cluster_size, labels, NOISE)

    if method != "hdbscan":
        raise ValueError(f"Unknown clustering method '{method}'")

    reduced = embeddings
    if n >= 50:
        try:
            import umap

            reduced = umap.UMAP(
                n_neighbors=min(15, n - 1), n_components=5, min_dist=0.0,
                metric="cosine", random_state=random_state,
            ).fit_transform(embeddings)
        except ImportError:
            log.warning("umap-learn not installed; clustering raw embeddings")
    return HDBSCAN(min_cluster_size=min_cluster_size, min_samples=max(2, min_cluster_size // 2), copy=True).fit_predict(reduced)


def merge_similar_labels(embeddings: np.ndarray, labels: np.ndarray, threshold: float) -> np.ndarray:
    """Merge clusters whose centroids are near-duplicates (HDBSCAN often splits one topic).

    Complete linkage: clusters are only merged if *every* pair of centroids in the group has
    cosine similarity >= ``threshold``, which keeps genuinely different issues apart.
    """
    cluster_ids = sorted(set(labels.tolist()) - {NOISE})
    if len(cluster_ids) < 2:
        return labels
    centroids = np.stack([centroid_of(embeddings[labels == cid]) for cid in cluster_ids])
    groups = AgglomerativeClustering(
        n_clusters=None, metric="cosine", linkage="complete", distance_threshold=1 - threshold
    ).fit_predict(centroids)
    mapping = {cid: int(group) for cid, group in zip(cluster_ids, groups)}
    return np.array([mapping.get(label, NOISE) for label in labels.tolist()])


def extract_keywords(cluster_texts: list[list[str]], top_n: int = 8) -> list[list[str]]:
    """Class-based TF-IDF: terms frequent in one cluster but rare across the others."""
    docs = [" ".join(texts) for texts in cluster_texts]
    if not docs:
        return []
    vectorizer = CountVectorizer(
        stop_words=KEYWORD_STOP_WORDS, ngram_range=(1, 2), token_pattern=r"(?u)\b[^\W\d_]{2,}\b", lowercase=True
    )
    try:
        counts = vectorizer.fit_transform(docs)
    except ValueError:  # only stop words
        return [[] for _ in docs]
    terms = vectorizer.get_feature_names_out()
    counts = counts.toarray().astype(float)
    tf = counts / np.maximum(counts.sum(axis=1, keepdims=True), 1)
    avg_words = counts.sum() / len(docs)
    idf = np.log(1 + avg_words / np.maximum(counts.sum(axis=0), 1))
    scores = tf * idf

    results = []
    for row in scores:
        chosen: list[str] = []
        for idx in np.argsort(row)[::-1]:
            if row[idx] <= 0 or len(chosen) >= top_n:
                break
            term = terms[idx]
            if any(term in c or c in term for c in chosen):
                continue
            chosen.append(term)
        results.append(chosen)
    return results


def centroid_of(vectors: np.ndarray) -> np.ndarray:
    centroid = vectors.mean(axis=0)
    norm = np.linalg.norm(centroid)
    return (centroid / norm if norm else centroid).astype(np.float32)


def select_representatives(vectors: np.ndarray, centroid: np.ndarray, k: int = 10) -> list[int]:
    """Positions of the most central members, skipping near-duplicate wording."""
    sims = vectors @ centroid
    chosen: list[int] = []
    for pos in np.argsort(-sims, kind="stable"):
        if any(float(vectors[pos] @ vectors[c]) > 0.97 for c in chosen):
            continue
        chosen.append(int(pos))
        if len(chosen) == k:
            break
    return chosen


def build_clusters(embeddings: np.ndarray, labels: np.ndarray, texts: list[str]) -> list[Cluster]:
    cluster_ids = sorted(set(labels.tolist()) - {NOISE})
    groups = [np.flatnonzero(labels == cid) for cid in cluster_ids]
    keywords = extract_keywords([[texts[i] for i in g] for g in groups])
    clusters = [
        Cluster(label=cid, members=members.tolist(), centroid=centroid_of(embeddings[members]), keywords=kws)
        for cid, members, kws in zip(cluster_ids, groups, keywords)
    ]
    clusters.sort(key=lambda c: len(c.members), reverse=True)
    return clusters


def match_clusters(
    new_centroids: list[np.ndarray], existing: dict[int, np.ndarray], threshold: float
) -> dict[int, int]:
    """Greedy one-to-one matching of new clusters to existing issues by centroid similarity.

    Returns {new_cluster_index: existing_issue_id} for pairs above ``threshold``.
    """
    pairs = []
    for i, centroid in enumerate(new_centroids):
        for issue_id, old in existing.items():
            sim = float(centroid @ old)
            if sim >= threshold:
                pairs.append((sim, i, issue_id))
    matches: dict[int, int] = {}
    used: set[int] = set()
    # Most similar pairs first; ties go to the larger cluster (clusters are sorted by size).
    for _, i, issue_id in sorted(pairs, key=lambda p: (-p[0], p[1])):
        if i not in matches and issue_id not in used:
            matches[i] = issue_id
            used.add(issue_id)
    return matches

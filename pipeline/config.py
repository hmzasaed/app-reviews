"""Central configuration, read from environment variables or a .env file."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database. Use the Supabase *session pooler* connection string in production;
    # SQLite works for local experiments and tests.
    database_url: str = "sqlite:///./reviews.db"

    # Review collection defaults
    default_lang: str = "en"
    default_country: str = "us"
    default_max_reviews: int = 1000
    ingest_batch_size: int = 200
    ingest_batch_delay_seconds: float = 1.0
    ingest_max_retries: int = 4

    # Languages the NLP models are expected to handle. Other languages are stored
    # but excluded from analysis until a multilingual model is configured.
    supported_languages: list[str] = ["en"]

    # NLP models (Hugging Face Hub IDs)
    sentiment_model: str = "cardiffnlp/twitter-roberta-base-sentiment-latest"
    zero_shot_model: str = "MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    category_min_confidence: float = 0.35
    inference_batch_size: int = 32

    # Clustering
    clustering_method: str = "hdbscan"  # "hdbscan" or "agglomerative"
    min_cluster_size: int = 5
    agglomerative_distance_threshold: float = 0.45
    cluster_merge_threshold: float = 0.78  # merge near-duplicate clusters; set >1 to disable
    issue_match_threshold: float = 0.80

    # Free LLM provider for cluster summaries: gemini | groq | mistral | xai | none
    llm_provider: str = "gemini"
    llm_model: str | None = None
    gemini_api_key: str | None = None
    groq_api_key: str | None = None
    mistral_api_key: str | None = None
    xai_api_key: str | None = None
    llm_min_interval_seconds: float = 4.0  # stay under free-tier requests-per-minute limits
    llm_max_retries: int = 4
    llm_timeout_seconds: float = 60.0
    max_summaries_per_run: int = 15
    min_reviews_for_summary: int = 3

    # API
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()

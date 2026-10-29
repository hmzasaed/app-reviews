# Play Store Review Analysis

Turns Google Play reviews into **ranked, evidence-backed reported issues**. Enter an app URL, collect reviews, and see what users say is broken, how many reviews mention it, what to look at first, and the exact reviews behind each finding.

Findings are *user-reported issues*, not confirmed bugs. The system never marks a root cause as confirmed.

## Stack

| Part                 | Choice                                                                                                                  | Why                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database             | **Supabase** (managed Postgres)                                                                                   | Free tier. SQL joins and aggregates for analytics, unique constraints for idempotent ingestion, pgvector available later. Firebase/Firestore was not chosen: it is a document store with no joins or aggregate queries, which this schema depends on. |
| LLM (summaries only) | **Gemini** (free tier) by default; **Groq** (free) and **Mistral** (free "Experiment" plan) supported | All three use OpenAI-compatible endpoints, so switching is one env var. xAI's Grok is also wired in but is paid.                                                                                                                                      |
| Collection           | `google-play-scraper`                                                                                                 | Batched, retried, incremental                                                                                                                                                                                                                         |
| NLP                  | Hugging Face Transformers + Sentence Transformers                                                                       | Pretrained; no training needed for the MVP                                                                                                                                                                                                            |
| Clustering           | UMAP + HDBSCAN + c-TF-IDF keywords (the BERTopic recipe), plus an agglomerative baseline                                |                                                                                                                                                                                                                                                       |
| API                  | FastAPI + SQLAlchemy 2                                                                                                  |                                                                                                                                                                                                                                                       |
| Dashboard            | React + Vite + TypeScript + Tailwind + Recharts                                                                         |                                                                                                                                                                                                                                                       |

The LLM runs only *after* clustering, on bounded, structured input. Sentiment, classification, and clustering all run locally for free, so free-tier LLM rate limits only affect the ~15 summaries per run.

## How it works

```
Play Store ─► ingestion (batches, retries, dedupe on app+review id, incremental)
          ─► preprocessing (NFKC, whitespace, PII masking, language detection; negations kept)
          ─► sentiment (cardiffnlp twitter-roberta)  +  issue category (zero-shot NLI, fixed taxonomy, low confidence → "other")
          ─► complaint embeddings (all-MiniLM-L6-v2, cached per review)
          ─► UMAP → HDBSCAN clusters (unrelated reviews stay unclustered) + c-TF-IDF keywords
          ─► persistent issue tracking (new clusters matched to existing issues by centroid similarity)
          ─► priority score + confidence
          ─► LLM summary (validated) for the top issues
          ─► FastAPI ─► React dashboard
```

**Priority** (0–100): `P = 100 × (0.35·F + 0.30·S + 0.20·R + 0.15·G)`

- **F (frequency):** half relative to the largest issue, half absolute (log-scaled, saturating at 100 reviews), so small datasets don't distort the ranking.
- **S (severity):** category base severity blended with the share of 1–2★ reviews. Explicit rules lift it to ≥0.9 when reviews describe lost money or lost data.
- **R (recency):** exponential decay, with a 14-day half-life measured from the newest analysed review.
- **G (growth):** change in the issue's *share* of reviews between the last 14 days and the 14 days before. It is scored only when both windows have enough reviews.

Labels: Critical ≥80, High ≥60, Medium ≥35, Low <35. Developers can override the label, and must give a reason. Every override, rename, status change, and merge is recorded in the issue history. Confidence (cluster coherence plus amount of evidence) is reported separately from priority.

**LLM guardrails:**

- Review text is passed as untrusted data, never as instructions.
- Output is schema-validated.
- Cited evidence IDs must belong to the cluster.
- Numbers in the summary that don't appear in the input are flagged.
- `root_cause_confirmed` is always false.
- Responses are cached by input hash.
- After two consecutive provider failures, the run switches to keyword summaries.

## Setup

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **Connect** and copy the **Session pooler** connection string. Put it in `.env` as `DATABASE_URL` with your database password filled in.
3. Tables are created automatically on API start, or by running `python -m pipeline.cli init-db`. You can also paste [database/schema.sql](database/schema.sql) into the Supabase SQL editor. RLS is enabled on every table so the public anon key can't read them; the API connects as the owner.

### 2. Free LLM key (pick one)

- Gemini: [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Set `LLM_PROVIDER=gemini` and `GEMINI_API_KEY=...`.
- Groq: [console.groq.com/keys](https://console.groq.com/keys). Set `LLM_PROVIDER=groq` and `GROQ_API_KEY=...`.
- Mistral: [console.mistral.ai](https://console.mistral.ai/api-keys). Set `LLM_PROVIDER=mistral` and `MISTRAL_API_KEY=...`.

Without a key, set `LLM_PROVIDER=none` and issues get keyword-based titles and summaries. Free-tier model names and limits change often. Override the model with `LLM_MODEL`, and raise `LLM_MIN_INTERVAL_SECONDS` if you see HTTP 429 errors.

### 3. Backend

```bash
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
copy .env.example .env            # then edit it
uvicorn backend.app.main:app --reload
```

API docs: http://localhost:8000/docs. The first analysis downloads about 1 GB of Hugging Face models, which are then cached.

### 4. Dashboard

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to port 8000.

### Docker

```bash
docker compose up --build
```

The dashboard runs at http://localhost:8080 and the API at http://localhost:8000. The database is still your Supabase project from `.env`.

## CLI (pipeline without the API)

```bash
python -m pipeline.cli add "https://play.google.com/store/apps/details?id=com.example.app"
python -m pipeline.cli sync com.example.app --max 1000 --since-days 90
python -m pipeline.cli analyze com.example.app
python -m pipeline.cli issues com.example.app
python -m pipeline.cli export com.example.app --kind issues --format csv
```

### Evaluation (human-labelled benchmark)

```bash
python -m pipeline.cli label-sample com.example.app --n 400   # stratified by star rating
# fill in sentiment_label, category_label, issue_group in the CSV
python -m pipeline.cli evaluate reports/com.example.app_label_sample.csv
```

This reports sentiment and category macro-F1, plus pairwise cluster precision and recall: of the review pairs grouped together, how many really describe the same issue.

## API (`/api/v1`)

| Method | Endpoint                                   | Purpose                                                                  |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| POST   | `/apps`                                  | Register an app (URL or package ID)                                      |
| GET    | `/apps`, `/apps/{id}`                  | List / get apps                                                          |
| DELETE | `/apps/{id}`                             | Delete an app and its data                                               |
| POST   | `/apps/{id}/sync`                        | Start review collection (background job)                                 |
| POST   | `/apps/{id}/analyze`                     | Start an analysis run (background job)                                   |
| GET    | `/jobs/{id}`, `/apps/{id}/jobs`        | Job status / history                                                     |
| GET    | `/apps/{id}/overview`                    | KPIs, distributions, weekly timeline, versions, top and emerging issues  |
| GET    | `/apps/{id}/issues`                      | Ranked issues (filter by status/category, sort)                          |
| GET    | `/issues/{id}`, `/issues/{id}/reviews` | Issue detail with priority reasoning, evidence, history / member reviews |
| PATCH  | `/issues/{id}`                           | Rename, change status, override priority (reason required)               |
| POST   | `/issues/{id}/merge`                     | Merge into another issue                                                 |
| GET    | `/apps/{id}/reviews`                     | Search and filter reviews                                                |
| GET    | `/apps/{id}/export`                      | CSV/JSON export of issues or reviews                                     |

## Project layout

```
pipeline/   ingestion, preprocessing, nlp, clustering, prioritization, summarization, llm, issues, analysis, jobs, cli
database/   SQLAlchemy models, engine/session, generated schema.sql
backend/    FastAPI app (api/, schemas.py, serializers.py)
frontend/   React dashboard
tests/      unit + end-to-end tests (fake models, in-memory SQLite; no network)
reports/    CLI exports
```

## Tests

```bash
pytest
```

## Performance notes

- Models run on CPU and are cast to float32. Recent transformers releases load the zero-shot checkpoint as float16, which was about 17× slower on CPU.
- On a 4-core laptop, classification takes roughly 0.3 s per review on the first run. Predictions and embeddings are cached per review and model version, so re-runs only process new reviews.
- A larger zero-shot model, e.g. `MoritzLaurer/deberta-v3-base-zeroshot-v2.0`, is about 4× slower. Switch with `ZERO_SHOT_MODEL` if your benchmark shows it is worth the cost.

## Known limitations

- `google-play-scraper` is unofficial. Pagination and limits can change, and the job result reports how many reviews were actually retrieved.
- Only English is analysed by default (`SUPPORTED_LANGUAGES`). Other languages, Roman Urdu included, are stored but skipped until a multilingual model is configured and evaluated.
- Jobs run in-process (FastAPI background tasks) with a single worker. Move to Celery/Redis when volume requires it.
- There is no authentication yet. Don't expose the API publicly as-is.
- The priority weights are starting assumptions. Validate them with a labelled benchmark (300–500 reviews) and adjust.
- Splitting an issue isn't supported yet (rename, merge, status, and priority override are).

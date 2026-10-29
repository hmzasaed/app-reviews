FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models
WORKDIR /app

# CPU-only torch keeps the image ~2 GB smaller than the default CUDA build.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY pyproject.toml ./
COPY pipeline ./pipeline
COPY database ./database
COPY backend ./backend
RUN pip install --no-cache-dir .

EXPOSE 8000
# Jobs run as in-process background tasks: keep a single worker.
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

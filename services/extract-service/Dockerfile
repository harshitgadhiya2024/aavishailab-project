# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# This service parses untrusted, potentially hostile file content (archives,
# Office documents, PDFs, images), so unlike the regex-only dlp-service it
# genuinely needs OS-level packages: the tesseract OCR engine (+ language
# packs) and libraries pypdfium2/Pillow/py7zr link against.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-hin \
      libjpeg62-turbo \
      zlib1g \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Runs as a non-root user with no write access outside /tmp — least
# privilege for a service whose entire job is parsing hostile input.
# Nothing here needs outbound network access either; enforce that at the
# docker-compose network level (internal network, no default route out).
RUN useradd --system --uid 10002 extract \
    && mkdir -p /tmp/extract-scratch \
    && chown -R extract /srv /tmp/extract-scratch
ENV TMPDIR=/tmp/extract-scratch
USER extract

EXPOSE 6400

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:6400/healthz').status==200 else 1)"

# Fewer workers than dlp-service: each request here is CPU-heavy (archive
# walking, PDF rasterisation, tesseract subprocesses), not the microsecond
# regex matches dlp-service handles — see README.md for the replica/worker
# sizing guidance instead of over-provisioning a single container.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "6400", "--workers", "2", "--timeout-keep-alive", "75"]

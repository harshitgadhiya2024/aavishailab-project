# syntax=docker/dockerfile:1
#
# dlp-service now does the whole DLP pipeline, extraction and OCR included,
# so it needs two native pieces at runtime: the tesseract binary (OCR of
# photographed documents and scanned PDF pages) and the pdfium shared
# library (PDF text and page rendering), loaded with dlopen. Both need
# glibc, so this is a Debian build and a Debian slim runtime rather than
# musl + distroless.
FROM rust:1-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# pdfium from bblanchon/pdfium-binaries (BSD/Apache-2.0), matching the
# build platform's architecture (the production host is arm64).
FROM debian:bookworm-slim AS pdfium
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
         arm64) PLATFORM=linux-arm64 ;; \
         amd64) PLATFORM=linux-x64 ;; \
         *) echo "unsupported arch ${TARGETARCH}" && exit 1 ;; \
       esac \
    && mkdir -p /pdfium \
    && curl -fsSL "https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-${PLATFORM}.tgz" \
       | tar -xz -C /pdfium

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      tesseract-ocr \
      tesseract-ocr-eng \
      tesseract-ocr-hin \
    && rm -rf /var/lib/apt/lists/*
COPY --from=pdfium /pdfium/lib/libpdfium.so /usr/local/lib/libpdfium.so
COPY --from=builder /src/target/release/dlp-service /usr/local/bin/dlp-service

# Parses untrusted, possibly hostile files: no root, and nothing writable
# but its scratch directory (OCR hands tesseract images through temp files).
RUN useradd --system --uid 10003 dlp && mkdir -p /tmp/dlp-scratch && chown dlp /tmp/dlp-scratch
ENV TMPDIR=/tmp/dlp-scratch \
    PDFIUM_LIB_PATH=/usr/local/lib/libpdfium.so
USER dlp

EXPOSE 6200
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD ["/usr/local/bin/dlp-service", "--healthcheck"]
ENTRYPOINT ["/usr/local/bin/dlp-service"]

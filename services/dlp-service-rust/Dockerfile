# syntax=docker/dockerfile:1
#
# Alpine's musl libc gives a fully static binary with no extra cross-compile
# config (no OpenSSL/native deps here — hmac/sha2/regex are pure Rust), so
# the final stage can be distroless/static instead of a full Debian slim,
# matching the image-size discipline the other Go services already use.
FROM rust:1-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM gcr.io/distroless/static-debian12
COPY --from=builder /src/target/release/dlp-service /dlp-service
USER nonroot:nonroot
EXPOSE 6200
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD ["/dlp-service", "--healthcheck"]
ENTRYPOINT ["/dlp-service"]

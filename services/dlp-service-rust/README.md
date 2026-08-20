# dlp-service (Rust)

A Rust/axum port of `services/dlp-service` (Python/FastAPI), and the
service `docker-compose.yml` actually builds and runs as `dlp-service` as
of this cutover. The Python original stays in the repo, untouched, as the
rollback path — see **Rollback** below.

## Why this was ported (Phase 2 of the Rust migration plan)

The Python version's hot path (`app/detectors.py`, `app/scoring.py`) did,
per 4MB scan window per policy:

- `text.upper()` and `text.lower()` — two full copies of the window
- `re.compile(p.regex)` **inside the per-request loop** for every custom
  pattern — no cache
- six separate full-buffer regex passes, on a backtracking engine with
  **no linear-time guarantee** — meaning a typo'd or malicious
  org-supplied `custom_patterns` regex could hang a worker indefinitely
  (a real ReDoS exposure, not a theoretical one — reproduced below)

This port fixes both the performance and the correctness problem with the
same change: `regex` crate matching is a DFA with a linear-time guarantee,
so it's both faster and structurally immune to catastrophic backtracking.

## What changed vs. what didn't

Byte-for-byte identical: request/response JSON shapes, the HMAC token
format and verification (`app/auth.py`), the scoring formula, detector
weights, checksums (Luhn/Verhoeff), redaction, null-tolerant list
deserialization, and the fail-open contract on error. This was ported
field-by-field from the Python source (`detectors.py`, `scoring.py`,
`schemas.py`, `auth.py`, `config.py`) — see the module doc comments in
`src/` for the specific line-level correspondence.

What's different: the implementation. Zero-copy `&str`/`&[u8]` scanning
instead of repeated full-buffer allocation; regexes compiled once via
`LazyLock` instead of per-request; `Config` is a plain injected struct
(via axum `State`) instead of a mutable global, which is also what makes
per-test overrides (like a tiny `max_scan_size` to hit the 413 path)
possible without `monkeypatch`-style global mutation.

## Verification

**56 tests** port the Python suite's 41 (12 detector + 16 scoring + 13
API) plus 15 new ones covering things the Rust type system/regex engine
change the shape of (e.g. the ReDoS regression test below). Run:

```bash
cargo test
```

**Differential testing** — 21 cases (clean text, real-shaped documents
with embedded secrets, base64-in-text, all-256-byte binary content,
digit-dense adversarial input, 500-match custom patterns, null JSON
lists, multi-policy severity resolution) run against both the live
Python container and this service, comparing responses field-by-field.
All 21 matched byte-for-byte, both against a locally-run dev build and
against the actual `docker build` image. See `scripts/loadtest/` sibling
tooling for the pattern; the differential script itself was a scratch
file, not checked in — the point was the verification, not a permanent
fixture, since the Python original disappears once this is trusted.

**Benchmark** — the scenario the plan specifically called out: a 4MB scan
window (matching `scanstream.go`'s window size) against 5 policies
(matching "an org with 5 DLP policies"), 20 requests, measured against
the live containers on this host:

```
python   p50=3745ms  p95=3810ms
rust     p50= 185ms  p95= 197ms      (20.2x)
```

**ReDoS regression** — `(a+)+$` against a 33-character non-matching
string (`"a"*32 + "!"`) as a `custom_patterns` regex:

```
rust:   responded in 0.002s
python: hung, connection closed by the server after 5.2s
```

(also asserted directly in `src/detectors.rs`'s
`test_custom_pattern_catastrophic_backtracking_pattern_completes_instantly`,
so this can't silently regress if the regex engine is ever swapped.)

**Image size** — `gcr.io/distroless/static-debian12` + a musl-static
binary (built via `rust:1-alpine`, no cross-compile config needed since
there are no native/OpenSSL dependencies): **9.6MB**, vs. the Python
image's 264MB.

## Rollback

If this needs to be reverted, `docker-compose.yml`'s `dlp-service.build.context`
is the only thing that changed to effect the cutover:

```yaml
dlp-service:
  build:
    context: ./services/dlp-service     # was: ./services/dlp-service-rust
```

Rebuild and restart; the Python service has been untouched and boots with
the same env vars, port, and healthcheck contract.

## Local development

```bash
cargo run                 # listens on 0.0.0.0:6200
cargo test                # unit + integration tests
cargo build --release     # optimized binary at target/release/dlp-service
docker build -t dlp-service-rust .
```

`Cargo.lock` is committed — this is a deployed binary/service (not a
library other crates depend on), where pinning exact transitive versions
for reproducible builds is the recommended practice, unlike a library
crate where you'd normally leave it out.

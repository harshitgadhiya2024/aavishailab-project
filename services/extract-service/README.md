# extract-service

Deep content extraction for the DLP pipeline: turns any uploaded file —
CSV, Excel, JSON, DOCX, PDF, ZIP/TAR/GZ/7z, images, RTF, legacy `.doc`/
`.xls`/`.ppt`, Outlook `.msg`, `.eml`, multipart form uploads, plain text
and chat-message-shaped JSON/form bodies — into plain-text segments the
existing `dlp-service` regex/scoring engine can scan. It never makes a
policy decision itself; it only extracts.

Stateless and holds no data. Every request is independent; scale replicas
horizontally behind admin-api.

## Why this exists

Before this service, DLP scanned uploaded content as raw bytes lossily
decoded as UTF-8. A PAN number inside a `.docx` or `.xlsx` was invisible —
those are ZIP/binary containers, not text. This service unpacks the
container (recursively, through nested archives and email attachments) and
hands the detector engine what's actually inside.

## API

`POST /v1/extract` — request body is the raw file bytes
(`application/octet-stream`); metadata travels as query params
(`org_id`, `filename`, `content_type`, `ocr`, `images`, `deadline_ms`),
matching the convention `admin-api`'s agent-facing endpoints already use.
Response is `application/x-ndjson`, one JSON object per line, streamed as
extraction proceeds so a caller can act on an early result (e.g. stop
reading once a DLP window blocks) without waiting for the rest of a large
file:

```json
{"kind":"segment","seq":1,"part":"q3.zip!hr/salary.xlsx!sheet1","filename":"salary.xlsx","mime":"...","source":"xlsx","text":"..."}
{"kind":"image","seq":2,"part":"onboarding.pdf!page3","sha256":"…","mime":"image/jpeg","w":1568,"h":1100,"b64":"…","ocr_text":"..."}
{"kind":"unscannable","seq":3,"part":"vault.zip!keys.7z","reason":"encrypted_archive","detail":"..."}
{"kind":"summary","parts":37,"bytes_in":812734912,"complete":true,"elapsed_ms":48210,"ocr_pages":12,"ocr_images":4,"images":4}
```

Auth: the same short-TTL HMAC bearer-token scheme as `dlp-service`
(`app/auth.py` is a byte-for-byte copy of the convention), minted by
admin-api's `internal/extractclient`.

## Format coverage and licensing notes

See `app/sniff.py` for the dispatch table and `app/extract/*.py` for each
extractor. Two library choices are deliberate and licence-driven:

- **PDF uses `pypdfium2` (BSD/Apache-2.0), not PyMuPDF.** PyMuPDF is
  AGPL-3.0, which is incompatible with shipping this as closed-source
  commercial software.
- **No `extract-msg` for Outlook `.msg`** (it's GPL) — `.msg` bodies are
  read directly from their well-known OLE property streams instead
  (`app/extract/legacy_office.py`).
- RAR archives are reported `unscannable(unsupported_archive)` rather than
  shelling out to the non-free `unrar` binary.

Legacy binary Office formats (`.doc`/`.xls`/`.ppt`) get best-effort
printable-text-run extraction, not full document-model fidelity — see the
docstring in `legacy_office.py`. This reliably surfaces free text (what DLP
cares about) without a heavyweight or copyleft-licensed binary-format
parser.

## No file-size limit, bounded resource safety

There is deliberately no "file too big" rejection anywhere in this
service. What IS bounded — because otherwise a hostile or pathological
file could exhaust CPU/RAM regardless of the real product requirement — are
the safety limits in `app/config.py`: archive nesting depth, entry count,
total decompressed bytes, expansion ratio, and per-request deadline.
Hitting one of these produces an explicit `unscannable` record (with a
`reason` a DLP policy's `on_unscannable` setting can act on), never a
silent skip.

Zip-slip is structurally impossible here: archive entries are never
written to disk by their own path — each one is read into memory and
handed straight to the generic dispatcher, so a `../../etc/passwd` entry
name is only ever a display string.

XXE is blocked by using `defusedxml` for every XML parse (OOXML parts,
raw XML/HTML bodies) — verified in `tests/test_security.py`.

## OCR

Tesseract (Apache-2.0), driven via `pytesseract`, which shells out to the
`tesseract` binary as a subprocess per call — that subprocess boundary is
what keeps a pathological image from ever blocking or crashing this
service's own process; `pytesseract`'s own `timeout` parameter is the
actual enforcement mechanism (see `app/extract/ocr.py`).

PDF pages get their real text layer first; a page with less than
`EXTRACT_OCR_TEXT_THRESHOLD` characters (a scanned/photographed page with
no real text layer) is rasterised and OCR'd instead. Standalone and
embedded images go straight to OCR, budget permitting
(`EXTRACT_OCR_MAX_PAGES` / `EXTRACT_OCR_MAX_IMAGES`).

## Vision-AI hook

Every image that clears the minimum-dimension filter also gets a
downscaled (1568px long edge, JPEG q80) base64 copy in its `image`
NDJSON record — sized for a vision model's tiling, so `ai-service`'s
`/v1/dlp/classify-image` endpoint (see the top-level plan, Phase 3) can use
it directly without re-decoding anything. This service does not call
ai-service itself — that decision (cost budget, caching, whether vision is
even enabled for the org) belongs to admin-api, the orchestrator.

## Local development

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 6400
```

## Tests

```bash
.venv/bin/pytest -q
```

`tests/corpus.py` builds every fixture format in-memory (real ZIP/OOXML/
OLE-CFB/PDF bytes, not mocked) — nothing binary is checked into the repo.
`tests/test_formats.py` is the format matrix; `tests/test_security.py` is
the hostile-input corpus (decompression bombs, XXE, zip-slip-shaped names,
nesting/entry/deadline limits); `tests/test_api.py` exercises the real
FastAPI app end-to-end including auth.

Known gap for full production sign-off: the OOXML/PDF fixtures are
hand-built to the spec rather than produced by python-docx/openpyxl/a real
PDF writer. They exercise the real parsing libraries correctly, but a
compatibility pass against files actually saved by Word/Excel/Acrobat is
recommended before launch.

## Scaling

CPU-bound (archive walking, PDF rasterisation, tesseract subprocesses),
unlike the microsecond regex matches in `dlp-service`. Size replica count
to expected concurrent large-file/OCR-heavy uploads, not request rate
alone; `--workers 2` per container in the shipped Dockerfile is a starting
point, not a tuned value — validate against `scripts/loadtest` before
relying on it at scale.

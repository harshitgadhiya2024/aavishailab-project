# Data Loss Prevention (DLP)

Records sensitive data leaving the company — through a browser or a desktop
app — without ever blocking the send. Monitor-only, by design: the upload
always proceeds, the company sees what went out.

## How it decides what's worth scanning

Most of what the agent's proxy sees on any given day is not a person
sending anything — analytics beacons, error reporters, a doc polling for
changes, app telemetry. `dlp-service-rust`'s `inspect.rs` is the gate: it
only scans a request when it is one of:

- a **real file** (a multipart part with a filename, or a body that is a
  document/image/archive by content type or magic bytes — including a raw
  upload whose content type lies, like Gmail/Drive's resumable uploads,
  which label a `.txt`/`.csv` body as a plain form),
- a **known send endpoint** (email, chat message, AI prompt, comment,
  cloud-storage upload — matched by host + exact path, not a loose
  substring, so a background call on the same host doesn't count),
- a **form the person submitted** by navigating (`Sec-Fetch-Mode: navigate`).

Everything else is dropped before a detector or an LLM ever sees it, and the
decision is logged (host, path without its query string, content type,
size, and either the verdict or the skip reason) so "why wasn't my upload
logged" can be answered from the logs without ever logging content.

## What it extracts and scans

`dlp-service-rust` does the whole pipeline in Rust:

- **Extraction**: DOCX/XLSX/PPTX (as zipped XML), ZIP/TAR/GZIP/7z (with
  nesting-depth, entry-count and expansion-ratio limits so an archive bomb
  can't exhaust memory), PDF (via pdfium — text layer first), legacy
  `.doc`/`.xls`/`.ppt`/Outlook `.msg`, `.eml`, RTF, CSV/JSON/XML/HTML/form
  bodies, multipart uploads.
- **OCR** (tesseract): a PDF page with a sparse text layer is rendered and
  OCR'd; a standalone image is OCR'd directly. Runs as a subprocess with a
  timeout, so a bad image can't hang the scanner.
- **Pattern detectors**: credit card (Luhn + real network prefix/length),
  Aadhaar (Verhoeff checksum + context or grouped formatting), PAN,
  AWS/GitHub/generic API keys, source-code file extensions.
- **AI tier**: an LLM classifies text/images/audio for the leaks no pattern
  describes (a salary sheet, a contract, a photographed ID). Cached by
  content hash, budgeted per org per day, and only runs when a policy
  enables the detector and pattern detection hasn't already blocked.

## The dashboard shows the destination as a person would name it

A browser incident shows the **product** the site is (Microsoft Teams,
Outlook, OneDrive, Google Sheets, ChatGPT — looked up by host, and by path
where one domain serves several products), with the raw host underneath for
investigation. A desktop-app incident shows the **app's name** (from its
User-Agent, or its host), never a telemetry subdomain.

## Known, permanent limitation

**WhatsApp** (and anything else end-to-end encrypted) cannot be read by a
network-based DLP — the agent only ever sees encrypted bytes. No fix closes
this; it's the same limitation every network DLP product (Zscaler,
Netskope, etc.) has. The available mitigation is Application Control
(blocking the app outright), not content inspection.

## Bugs fixed this cycle

See [../bug-fixes.md](../bug-fixes.md) for full detail. Summary, in order:

1. Every request scanned regardless of whether it was a user action —
   background traffic filled the log with false incidents.
2. Detectors matched IDs/timestamps as cards, and 12-digit record IDs as
   Aadhaar numbers.
3. The same value found multiple times inflated the score.
4. A file's name came from the URL's last path segment ("log", "Ping"),
   so almost everything showed "File upload" with no real name.
5. Extraction, OCR and the AI tier were in Python (extract-service,
   ai-service) — ported entirely into `dlp-service-rust`.
6. Outlook on the web's send action was never recognised (it shares an
   endpoint with its draft autosave).
7. ChatGPT's typing-draft endpoint was counted as a separate prompt each
   time — one prompt logged up to four times.
8. OneDrive/SharePoint uploads (from Teams) had no file name — the name
   only exists in the URL, not the body.
9. The same file uploaded twice by one app in quick succession (Teams
   uploads an attached image once to storage, once to its preview
   gateway) recorded two identical incidents.
10. A destination showed as a raw host (`in-prod.asyncgw.teams.microsoft
    .com`, `cozzera-my.sharepoint.com`) instead of the product name.

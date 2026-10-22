---
kind: guide
slug: what-dlp-detects
title: What DLP detects
excerpt: Card numbers, Indian identity and tax numbers, credentials, source code, and whole documents recognised by AI classification.
category: Data protection
tags: dlp, pan, aadhaar, gst, api keys, source code
author: Aavishield team
seo_title: Sensitive Data Types Aavishield DLP Detects
seo_description: Card numbers, PAN, Aadhaar, GST, bank details, API keys, tokens, database URLs, source code, salary sheets, contracts and ID scans.
order: 21
published: 2026-10-20
---
Aavishield DLP looks for two kinds of sensitive data: things with a recognisable pattern, and documents that only make sense as a whole.

## Financial and identity data

- Card numbers
- PAN
- Aadhaar
- GST numbers
- Bank details

## Secrets and code

- API keys and tokens
- Database URLs
- Source code

## Documents, by AI classification

Some sensitive documents have no fixed pattern. AI classification recognises them by what they are:

- Salary sheets
- Contracts
- Photographed or scanned IDs

## Images and scans

Images and scanned PDFs are read with OCR before classification, so a photo of an ID card is treated like the text on it.

## Related

- [How data loss prevention works](/knowledge-hub/how-dlp-works)

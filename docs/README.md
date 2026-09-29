# Documentation index

This folder is the one place feature detail, bug history and platform
verification status live. The repo root has one `README.md` — the product
description — and nothing else; everything else is here.

- [architecture.md](architecture.md) — services, how a request flows through
  the system, what runs where.
- [platform-verification.md](platform-verification.md) — **the status
  matrix**: what's verified on macOS / Windows / Ubuntu, with evidence, and
  what's still pending.
- [bug-fixes.md](bug-fixes.md) — every bug found and fixed in this
  verification cycle (2026-09-29 → 2026-09-30), in order, with root cause,
  fix and commit hash.
- `features/` — one file per feature area, describing what it does today and
  linking to the bugs that shaped it:
  - [features/dlp.md](features/dlp.md) — Data Loss Prevention
  - [features/web-gateway.md](features/web-gateway.md) — URL/domain filtering
  - [features/application-control.md](features/application-control.md) —
    blocking desktop apps
  - [features/vpn-control.md](features/vpn-control.md) — VPN/anonymizer
    blocking
  - [features/browser-protection.md](features/browser-protection.md) —
    closing browsers open before protection was applied

**Keeping this current:** when a feature changes or a bug is fixed, update
the relevant `features/*.md` file and add an entry to `bug-fixes.md`. Do not
create new markdown files elsewhere in the repo — this folder and the root
`README.md` are the only documentation the project keeps.

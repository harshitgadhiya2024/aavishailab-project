# Bug fix history — 2026-09-29 → 2026-09-30 verification cycle

Chronological. Every entry: what was found (and how), the root cause, the
fix, and the commit. All commits are on `main` and deployed to production
unless noted otherwise.

---

### 1. DLP recorded background traffic as if a person sent it
**Found:** production DB for one org showed 126 DLP "incidents" over one
day; on inspection, every single one was background traffic (Google Docs
sync, analytics beacons, internal RPCs) — none was a real upload. Detectors
were also matching record IDs as credit cards and 12-digit IDs as Aadhaar
numbers, and a repeated value inflated the score.
**Fix:** `dlp-service-rust`'s `inspect.rs` gates every request on being a
real file, a known send endpoint, or a person-submitted form before any
detector runs. Card/Aadhaar detectors tightened (real network
prefix/length, Verhoeff + context). Duplicate values within one scan count
once. The 126 false incidents (plus 369 more found the same way on a
second account, plus 3 ChatGPT-draft duplicates found later) were deleted
from production after a full backup.
**Commit:** `1294114`, `dd13b3f` (agent sends query + Sec-Fetch headers so
the server can make this decision).

### 2. The entire DLP pipeline was split across Go, Python and Rust
**Found:** extraction (documents/archives/PDF/OCR) lived in a Python
`extract-service`; AI classification lived in Python `ai-service`; pattern
detection lived in `dlp-service-rust`; orchestration lived in Go
`admin-api`. Decided to consolidate into one stack per
[[dlp-all-in-rust]] (see agent memory).
**Fix:** the whole pipeline — inspection, extraction, OCR, detectors, AI
tier — ported into `dlp-service-rust`. `extract-service` deleted.
`ai-service`'s `/v1/dlp/*` endpoints and modules deleted (it keeps the AI
Assistant chat). admin-api's `scan-dlp` now makes one call to
`dlp-service-rust`'s `POST /v1/scan-upload` and only owns policy loading
and event storage.
**Commits:** `4fa0dbc`, `fb37f50`, `14684ac`.

### 3. Outlook on the web's sent email was never scanned
**Found:** while testing real uploads through Gmail/Outlook/Teams.
**Root cause:** Outlook web sends mail through
`/owa/service.svc?action=CreateItem` — the same endpoint its draft
autosave uses. Only the request body's `MessageDisposition` field tells a
send from a save.
**Fix:** recognise `SendAndSaveCopy`/`SendOnly` as a send; `SaveOnly` stays
unrecorded.
**Commit:** `f621c0e`.

### 4. One ChatGPT prompt logged up to four times
**Found:** live testing — one prompt with a pasted AWS key produced four
identical incidents.
**Root cause:** ChatGPT posts the in-progress draft to
`/backend-api/f/conversation/prepare` while the person is still typing; the
send-endpoint rule matched any path containing `/f/conversation`, so every
draft post counted as a send.
**Fix:** send rules can now match a path exactly or by its ending, not just
by substring; ChatGPT (and Claude.ai) match only their actual send
endpoint.
**Commit:** `b278d8b`.

### 5. AWS VPN Client wasn't blocked by default
**Found:** live testing — the app opened and connected freely despite the
"VPNs blocked by default" policy.
**Root cause:** missing from the built-in VPN/anonymizer catalog.
**Fix:** added (macOS app + bundled OpenVPN binary, Windows/Linux clients).
**Commit:** `123cc93`.

### 6. OneDrive/SharePoint uploads had no file name
**Found:** a DOCX sent through Teams recorded with an empty file name.
**Root cause:** Teams uploads the file to SharePoint as a raw body; the
real name only exists in the URL
(`.../root:/Folder/salary.docx:/content`), never in the body. The agent's
old filename guess (last URL segment) produced "content".
**Fix:** when the body carries no name, the last URL path segment with a
real file extension is used (percent-decoded).
**Commit:** `063a59d`.

### 7. The same image uploaded once produced two incidents
**Found:** attaching a driving-licence photo in Teams produced two
identical incidents 0.7 seconds apart.
**Root cause:** Teams uploads the attached file to SharePoint *and* to its
own image-preview gateway — one action, two uploads of the same bytes.
**Fix:** before storing a file-upload event, admin-api checks whether the
same device recorded the same finding (identical masked matches) within
the last 60 seconds, under a per-device lock; if so, the upload is folded
into the earlier event (backfilling the file name if only the new copy had
one). Messages/emails are never folded this way — only file uploads.
**Commit:** `7346fb7`.

### 8. The DLP log showed raw hostnames instead of product names
**Found:** requested directly — `in-prod.asyncgw.teams.microsoft.com`,
`cozzera-my.sharepoint.com` meant nothing to a company admin.
**Fix:** `dlp-service-rust` names the product from the host (and path,
where one domain serves several — `docs.google.com/spreadsheets` →
"Google Sheets", `/document` → "Google Docs"); unknown sites are named from
their domain ("stylic.ai" → "Stylic AI"). A desktop app's own UA name is
normalised the same way ("Teams" → "Microsoft Teams"). The raw host still
shows underneath for investigation.
**Commit:** `fff3a91`.

### 9. Web Gateway logged pages that were never opened
**Found:** `r.stripe.com` appearing repeatedly in the Web Gateway log on a
device where Stripe's checkout was never opened — the person had opened a
page that merely *embeds* Stripe.
**Fix:** a block is only recorded as a "visit" when the request itself was
a page navigation (`Sec-Fetch-Dest: document`); an embedded resource
(script, iframe, background fetch) is still blocked, just not logged as if
the person opened it.
**Commit:** `4700820`.

### 10. A device re-enrolled for a new employee duplicated in Application
Control
**Found:** on a second Mac, every app was listed twice under Application
Control, and blocks set there did nothing.
**Root cause:** the agent sent no stable hardware identity at enrollment,
so re-enrolling the same laptop for a different employee matched on
hostname + employee, missed, and created a second device row. The original
device kept all installed-app history; the new (empty) device is what
controls were actually toggled against, which never reached the running
agent.
**Fix:** the agent now sends a hashed hardware identity (macOS
IOPlatformUUID / Windows MachineGuid / Linux `/etc/machine-id`) at
enrollment; the server matches on it first, so a reinstall reuses the same
device row. The app list also only shows software from devices that still
exist and belong to a current employee.
**Commit:** `de48127`.

### 11. Already-open browsers bypassed protection entirely
**Found:** while diagnosing #9/#10's device — Gmail/Outlook/Teams tabs open
before the agent was installed were never filtered or scanned, and reload
didn't fix it; only quitting and reopening the browser did.
**Root cause:** a browser keeps its already-open HTTPS connections and
reuses them on reload; pointing the system proxy at the agent doesn't move
connections that already exist.
**Fix:** the agent closes every running browser the moment it turns the
system proxy on from fully off (install, login, working hours starting, a
Disconnect ending), and notifies the person why. See
[features/browser-protection.md](features/browser-protection.md).
**Commit:** `c90999d`.

### 12. Gmail/Drive's raw-body uploads (`.txt`/`.csv`) were never scanned
**Found:** while re-testing DLP after the above fixes — a `.txt` file with
a card/Aadhaar/PAN number produced no incident when uploaded through
Gmail's resumable-upload flow.
**Root cause:** Google's resumable upload sends a file's raw bytes labelled
`application/x-www-form-urlencoded` (not multipart, not the file's real
content type). PDF/DOCX were still recognised by magic bytes; a `.txt`
looked like an ordinary form and was skipped.
**Fix:** a body sent to an upload/attachment-shaped endpoint that is
neither JSON nor a real `key=value` form is now treated as a file. Also
added: every scan decision (host, path without its query, content type,
size, verdict or skip reason — never content) is now logged at `info`, so
"why wasn't my upload logged" is answerable from the logs; background
telemetry stays at `debug`.
**Commit:** `0eaac3f`.

### 13. One `null` field from the server froze all later Application
Control blocks
**Found:** live testing — MongoDB Compass, MySQLWorkbench and Telegram were
all blocked in the UI and kept opening anyway; WhatsApp, blocked seconds
earlier, closed correctly.
**Root cause:** MongoDB Compass was added to the catalog from the
installed-software inventory — it's matched by bundle ID and path, so it
has no process names, and the server sent `"process_names": null`. The
agent's JSON parser rejected the **entire** rules response on that one
null field, and silently kept enforcing whatever rules it had parsed
before — so nothing blocked after that app in the list was ever enforced
on the device.
**Fix:** the server's `AppControlMatcher` always marshals its three list
fields as `[]`, never `null` — this alone fixes every already-installed
agent, no update needed. The agent additionally reads a null list as empty
(belt and braces) and now warns instead of silently keeping stale rules if
parsing ever fails for another reason.
**Commits:** `3162def` (server + agent), `f0589aa` (a related agent-only
fix: log why the process exits when the window is Quit, which had been
showing up in logs as an unexplained restart that looked like a crash
during this same testing session).

### 14. Production database moved to Neon, then reverted
**What happened:** production's Postgres was pointed at a Neon-hosted
database (Singapore region) to evaluate it; all client data (organizations,
employees, devices, activity) was removed from the bundled container
database, keeping only the superadmin login, per instruction. Neon's
Mumbai↔Singapore round-trip measured ~58ms per query (vs. sub-1ms local),
and Neon has no Mumbai region — Singapore is already the closest available.
Given the latency, production was **reverted to the bundled Postgres
container** (`ADMIN_API_DATABASE_URL` unset again), and the bundled
database's own client data (all organizations, employees, devices,
policies, activity, screenshots, tokens — full list in the commit/session
log) was then wiped the same way, keeping only the superadmin login. A full
`pg_dump` backup was taken before that deletion.
**Commit:** `1bf7529` (the `ADMIN_API_DATABASE_URL` override itself, which
stays — it's what made the revert a one-line `.env` change rather than a
code change).

### 15. One employee's app block reached the whole company; App Block also turned on Network Block
**What happened:** an admin blocked Microsoft Teams for one employee
(Harshit Patel), and Teams was also killed on a teammate's Mac (Riya
Patel). There were two causes:
1. The per-employee switch saved the rule's targets as
   `{"employee_ids":[…]}` with no `scope`. The matcher read a missing
   scope as "whole company", so every employee in the org matched. There
   was also only one rule per (company, app), so a second employee's
   switch rewrote the first employee's rule.
2. `block_network` and `block_process` carry GORM `default:` tags. GORM
   leaves a false field out of the INSERT, so the column default (network
   on) won. On Postgres it also reads the defaults back into the struct
   after the INSERT. The result was that every rule created with only
   App Block on came out with Network Block on too.

**Fix (admin-api):**
- A rule can now belong to one employee (`app_control_rules.employee_id`).
- The unique index is on (org, app, employee).
- The dashboard switch writes only that employee's own row.
- Targets with no `scope` are inferred from their lists: an employee list
  means only those employees, a team list means only those teams, and
  nothing at all means the whole company. This also protects Web Gateway
  and DLP policies saved without a scope.
- The switches are written explicitly after the row is created, from the
  values the admin asked for.
- A boot migration converts existing single-employee rules to the new shape.

**Tested:** end to end against a local stack with two companies, two teams
and four employees (30/30 checks). The tests covered:
- per-employee App Block and Network Block
- unblocking one employee while a teammate stays blocked
- a company admin getting 404 on another company's rows
- Web Gateway policies scoped to the company, a team, one employee, and
  an employee list with no scope

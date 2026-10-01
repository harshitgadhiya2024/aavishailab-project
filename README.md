# Aavishield

Aavishield is an endpoint security platform for companies: a lightweight
agent runs on each employee's device and acts as a local secure gateway,
enforcing company policy on everything the device does online.

## What it does

- **Web Gateway** — blocks and logs access to websites by category or
  domain (social media, AI tools, gambling, sensitive banking/government
  sites, and any custom list an admin adds).
- **Data Loss Prevention (DLP)** — watches outbound uploads, messages and
  emails across the apps and sites employees actually use (Gmail, Outlook,
  Microsoft Teams, OneDrive, ChatGPT, and any other site or app) for
  sensitive data — card numbers, government IDs, API keys and credentials,
  source code, and content an AI model recognises as sensitive even with no
  fixed pattern (a salary sheet, a contract, a photographed ID). It reads
  inside documents, archives, PDFs and images, including OCR of scanned or
  photographed pages. Monitor-only: nothing is ever blocked, so the
  business is never disrupted — the company simply sees what left.
- **Application Control** — blocks specific desktop applications outright,
  by name or by what's seen installed on a device.
- **VPN Control** — VPNs and anonymizers (desktop clients, downloads, and
  known browser extensions) are blocked by default on every device, no
  setup required.
- **Malware scanning** — downloads are scanned before they finish landing
  on disk.
- **Device posture** — checks disk encryption, firewall status, OS
  patch level and antivirus presence.
- **Screenshots & activity monitoring** — periodic screen capture and
  application usage, for the devices an org chooses to monitor.

## How it's built

One agent binary (Rust) runs identically on macOS, Windows and Linux,
intercepting the device's traffic as a local HTTPS proxy. It enforces
policy it pulls from a central control plane, and streams uploads and
downloads to dedicated scanning services for DLP and malware detection.
Three web dashboards sit on top: one for company admins, one for the
employee enrolling their own device, and one for the platform operator.
The public marketing site lives in `frontend/website` (Next.js,
served at aavishield.aavishailab.com).

See [`docs/`](docs/) for architecture detail, how each feature works, the
history of bugs found and fixed, and current verification status per
platform.

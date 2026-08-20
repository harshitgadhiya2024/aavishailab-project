# Delphic Secure Client Connector (native packaging)

Turns the endpoint agent from a **downloaded shell script** into a **signed
native application with a menu-bar / tray UI** — the Zscaler-Client-Connector
experience (Phase 1 of the roadmap in `FEATURE_STATUS_AND_ROADMAP.md §4`).

The enforcement logic is unchanged — it's the same `aavishield-agent.py` daemon
(local proxy, policy cache, DLP/malware scanning, TLS interception, posture
reporting). This package wraps it in:

- **`tray.py`** — a cross-platform menu-bar/tray app (pystray + Pillow): shows a
  green shield when protected / grey when paused, the device + org identity,
  last sync, and one-click **Open Employee Portal / View logs / Pause / Resume /
  Quit**. Enforcement stays in the background service; this is the friendly face.
- **`aavishield-connector.spec`** — PyInstaller spec that bundles the tray + the
  agent daemon into one binary (macOS `.app` menu-bar bundle, Windows `.exe`).
- **`build-macos.sh`** — PyInstaller → code-sign (Developer ID, hardened
  runtime) → `pkgbuild`/`productbuild` → **notarize + staple** → `.pkg`.
- **`build-windows.ps1`** — PyInstaller → Authenticode sign → Inno Setup → sign
  the installer → `.exe`.

## Build (on a signing machine)
```bash
# macOS
export DEVELOPER_ID_APP="Developer ID Application: Acme (TEAMID)"
export DEVELOPER_ID_INSTALLER="Developer ID Installer: Acme (TEAMID)"
export NOTARY_PROFILE="acme-notary"
./build-macos.sh            # -> dist/DelphicSecureConnector-1.0.0.pkg

# Windows (PowerShell)
$env:SIGN_CERT="C:\certs\acme.pfx"; $env:SIGN_PASS="…"
./build-windows.ps1         # -> Output\DelphicSecureConnector-1.0.0-Setup.exe
```
Without the signing env vars the scripts still produce a working (unsigned)
build for testing — the OS will show a Gatekeeper/SmartScreen warning, which is
exactly what signing removes.

## What the installer does
Same steps the old shell installer performed, now inside a proper package:
1. Installs the app to `/Applications` (mac) / `Program Files` (win).
2. Registers the agent daemon as a **launchd** (mac) / **Windows service** so it
   auto-starts and self-heals.
3. Sets the system proxy to `127.0.0.1:6118` and trusts the org CA (for TLS
   inspection).
4. Launches the menu-bar/tray connector.

## Distribution
Host the signed `.pkg` / `.exe` as a static download and link it from the
employee portal (the existing `GET /api/v1/portal/download/:os` shell installer
remains as a fallback for unmanaged/quick installs). For managed fleets, deploy
the package via **Jamf / Intune** — the same binary, pushed centrally, which is
how you get the tamper-resistant, always-on posture of a real client connector.

## Roadmap beyond this (Phase 2, documented in the report)
A future native data-plane (macOS Network Extension / Windows WFP/TUN, rewritten
in Go) replaces the system-proxy model so *all* traffic is captured and the
service is tamper-proof. This package is Phase 1: native, signed, friendly —
shipped reusing 100% of the working agent logic.

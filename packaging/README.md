# Agent packaging

Builds native installers that bundle their own Python runtime, so target
machines no longer need Python preinstalled.

| Platform | Output | Persistence | Build on |
|---|---|---|---|
| macOS | `aavishield-agent-<v>.pkg` | LaunchAgent (`KeepAlive`) | macOS (Apple Silicon only — see known gaps below) |
| Windows | `aavishield-agent-<v>.msi` | `HKLM\...\Run` | Windows + WiX v3 |
| Linux | `aavishield-agent-<v>-<arch>.deb` + `.tar.gz` | systemd user unit | Ubuntu 22.04 |

```bash
pip install -r scripts/agent/requirements-build.txt

bash packaging/macos/build.sh 1.1.0
bash packaging/linux/build.sh 1.1.0
powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 -Version 1.1.0
```

Each script is a no-op on signing when no certificate is configured, so the
pipeline works before certificates exist — the artifacts are just unsigned and
will be blocked by Gatekeeper/SmartScreen on real employee machines.

## What you need for signed release builds

### macOS

| Item | Where from | Notes |
|---|---|---|
| Apple Developer Program (organization) | developer.apple.com — $99/yr | Needs a D-U-N-S number |
| `Developer ID Application` cert | Developer portal | Signs the binary |
| `Developer ID Installer` cert | Developer portal | Signs the `.pkg` |
| Notary credentials | `xcrun notarytool store-credentials` | Needs an App Store Connect API key |

```bash
export DEVELOPER_ID_APP="Developer ID Application: Acme Inc (TEAMID)"
export DEVELOPER_ID_INSTALLER="Developer ID Installer: Acme Inc (TEAMID)"
export NOTARY_PROFILE="aavishield"
```

Without notarization macOS shows *"cannot be opened because Apple cannot check
it for malicious software"*. Notarization is what removes the quarantine
gymnastics the old shell installer required.

### Windows

| Item | Where from | Notes |
|---|---|---|
| Code-signing certificate | DigiCert / Sectigo — ~$300–700/yr | **EV** recommended; OV works but SmartScreen warns until reputation builds |
| Hardware token or cloud HSM | Issued with an EV cert | EV private keys cannot be exported |

```powershell
$env:SIGNING_CERT_THUMBPRINT = "abc123..."
# or
$env:SIGNING_CERT_PFX = "C:\certs\aavishield.pfx"
$env:SIGNING_CERT_PASSWORD = "..."
```

### Linux

Nothing. There is no OS-level gatekeeper to satisfy. Repository signing only
matters if you later publish to an apt/yum repo.

## Enrollment

Signed packages are identical for every employee, so the enrollment token
can't be baked in at build time the way the old per-download shell installers
did it. The agent looks for a token in this order:

1. `AAVISHIELD_ENROLL_TOKEN` + `AAVISHIELD_ADMIN_URL` environment variables
2. An `enroll.json` drop — `~/.aavishield/`, `/etc/aavishield/`, or
   `C:\ProgramData\Aavishield\`
3. Nothing found → the agent exits with instructions rather than running unenrolled

Unattended/MDM installs:

```bash
# Windows
msiexec /i aavishield-agent.msi /qn TOKEN=dse_xxx ADMINURL=https://api.example.com

# Linux
sudo AAVISHIELD_ENROLL_TOKEN=dse_xxx AAVISHIELD_ADMIN_URL=https://api.example.com \
     dpkg -i aavishield-agent.deb

# macOS — drop the file before installing. The chown matters: the agent runs
# as the console user afterward and needs write access to the directory to
# delete the drop once it's read it; without it the token sits on disk forever.
sudo mkdir -p /etc/aavishield
sudo chown "$(id -u):$(id -g)" /etc/aavishield
echo '{"token":"dse_xxx","admin_url":"https://api.example.com"}' | sudo tee /etc/aavishield/enroll.json
sudo installer -pkg aavishield-agent.pkg -target /
```

## Publishing for auto-update

### Automated (recommended) — `.github/workflows/agent-packages.yml`

Trigger it manually (Actions tab → "Agent packages" → "Run workflow", give it
a version) or push a tag matching `agent-v*`. It builds all three platforms
in parallel (macOS on `macos-14`, Windows on `windows-latest`, Linux on
`ubuntu-22.04`) and, if the secrets below are set, publishes each straight to
production over `POST /internal/admin/agent-packages` — no SSH/deploy access
to the server needed. Signing secrets are optional on every platform; without
them the job still produces (and publishes) working, unsigned artifacts.

Repo secrets to set (Settings → Secrets and variables → Actions):

| Secret | Required for |
|---|---|
| `AAVISHIELD_ADMIN_URL` | Publishing at all (e.g. `https://aavishield-api.aavishailab.com`) |
| `AGENT_PACKAGE_UPLOAD_TOKEN` | Publishing at all — must match the server's env var of the same name |
| `DEVELOPER_ID_APP`, `DEVELOPER_ID_INSTALLER`, `NOTARY_PROFILE`, `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD` | Signed/notarized macOS build |
| `SIGNING_CERT_THUMBPRINT` or `SIGNING_CERT_PFX_B64` (the `.pfx` file, base64-encoded — e.g. `base64 -i cert.pfx \| pbcopy`) + `SIGNING_CERT_PASSWORD` | Signed Windows build |

Without the first two secrets the workflow still builds and uploads to
GitHub's own artifact storage (the "agent-packages" run artifact) — publish
step just no-ops so the pipeline stays testable before production is wired up.

### Manual

Drop the built artifacts plus a `manifest.json` into admin-api's
`AGENT_PACKAGE_DIR` (default `/app/agent-packages`), or `POST` a single file to
`/internal/admin/agent-packages` (`platform`, `version`, `file` form fields,
`Authorization: Bearer $AGENT_PACKAGE_UPLOAD_TOKEN`) the same way CI does:

```json
{ "version": "1.2.0",
  "artifacts": { "macos": "aavishield-agent-1.2.0.pkg",
                 "windows": "aavishield-agent-1.2.0.msi",
                 "linux": "aavishield-agent-1.2.0-amd64.deb" } }
```

admin-api computes each SHA-256 from the bytes on disk and ignores any hash in
the manifest, so a stale or hand-edited checksum can never be served. Agents
poll `/internal/agent/version` every 6 hours, verify the hash before executing
anything, and restart under their supervisor to apply.

Only frozen (PyInstaller) builds self-update — a source checkout is left alone.

**Keep platform releases in lockstep.** The manifest has one `version` field
shared by all platforms — publishing macOS at 1.4.1 while Linux is still at
1.4.0 overwrites `version` to 1.4.1 but leaves the Linux filename pointing at
the 1.4.0 binary. Build/publish all platforms for a release together (which
is what the CI workflow does — one run, three parallel jobs, one version
input) rather than triggering them separately.

## Known gaps

- **macOS is Apple Silicon only.** `macos-14` builds a native arm64 `.pkg`
  that will not install on an Intel Mac. Making it universal2 isn't a
  one-line flag: the interpreter is universal2, but pip installs arch-
  specific wheels for compiled deps (Pillow's `_imagingft.so` came back
  arm64-only and PyInstaller refused to build — "is not a fat binary").
  A real fix needs either every dependency built and `lipo`-merged for both
  arches, or two separate builds merged after freezing — and needs real
  Intel Mac hardware to verify the result actually runs, not just builds.
- **Windows and Linux both build x86_64 only** — an ARM64 Windows or Linux
  device (rare on a typical corporate fleet, but not nonexistent) can't
  install either. Same class of fix as above if it ever matters.

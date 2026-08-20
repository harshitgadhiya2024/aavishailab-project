#!/usr/bin/env bash
#
# Builds a Linux .deb (and a portable .tar.gz) for the Aavishield agent.
#
#   ./packaging/linux/build.sh [version]
#
# Linux has no equivalent of Gatekeeper/SmartScreen, so there is no signing
# requirement to ship — apt repository signing is a separate concern if you
# later publish to one.
set -euo pipefail

VERSION="${1:-1.1.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="$REPO_ROOT/build/linux"
ROOT_DIR="$BUILD_DIR/root"
OUT_DIR="$REPO_ROOT/dist"

ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
INSTALL_PREFIX="/opt/aavishield"

# Which deployment this build belongs to. Baked into the binary because the
# package is generic — with no employee-specific token to carry an admin URL,
# the agent has to already know where to enrol and which portal to open.
ADMIN_URL="${AAVISHIELD_ADMIN_URL:-https://aavishield-api.aavishailab.com}"
PORTAL_URL="${AAVISHIELD_PORTAL_URL:-https://aavishield-employee.aavishailab.com}"

echo "==> Building Aavishield agent $VERSION for Linux ($ARCH)"
echo "    admin:  $ADMIN_URL"
echo "    portal: $PORTAL_URL"

rm -rf "$BUILD_DIR"
mkdir -p "$ROOT_DIR$INSTALL_PREFIX" "$ROOT_DIR/DEBIAN" \
         "$ROOT_DIR/usr/lib/systemd/user" "$ROOT_DIR/usr/lib/systemd/system" "$OUT_DIR"

# ─── 1. Freeze the agent ──────────────────────────────────────────────────────
# The deployment URLs are stamped into a scratch copy rather than the tracked
# source, so a build never leaves the working tree modified.
echo "==> Freezing agent with PyInstaller"
cd "$REPO_ROOT"
STAMPED_SRC="$BUILD_DIR/src"
mkdir -p "$STAMPED_SRC"
cp scripts/agent/aavishield-agent.py "$STAMPED_SRC/aavishield-agent.py"
python3 - "$STAMPED_SRC/aavishield-agent.py" "$ADMIN_URL" "$PORTAL_URL" <<'STAMP'
import re, sys
path, admin, portal = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
for name, value in (("DEFAULT_ADMIN_URL", admin), ("DEFAULT_PORTAL_URL", portal)):
    src, n = re.subn(rf'^{name}\s*=\s*".*"\r?$', f'{name}  = "{value}"',
                     src, count=1, flags=re.M)
    if n != 1:
        sys.exit(f"could not stamp {name} — the agent's constants moved")
open(path, "w").write(src)
STAMP

AAVISHIELD_AGENT_SRC="$STAMPED_SRC/aavishield-agent.py" \
python3 -m PyInstaller --clean --noconfirm --distpath "$BUILD_DIR/dist" \
    --workpath "$BUILD_DIR/work" packaging/aavishield-agent.spec

cp "$BUILD_DIR/dist/aavishield-agent" "$ROOT_DIR$INSTALL_PREFIX/aavishield-agent"
chmod 755 "$ROOT_DIR$INSTALL_PREFIX/aavishield-agent"

# ─── 2. systemd user unit ─────────────────────────────────────────────────────
# A user unit, not a system one: the agent edits the desktop session's proxy
# settings. Restart=always is what lets the auto-updater exit-and-reappear.
cat > "$ROOT_DIR/usr/lib/systemd/user/aavishield-agent.service" <<'UNIT'
[Unit]
Description=Aavishield security agent
After=network-online.target

[Service]
Type=simple
ExecStart=/opt/aavishield/aavishield-agent
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

# ─── 2b. CA-trust system unit ─────────────────────────────────────────────────
# Root, unlike the agent above: installing the org CA writes to the system
# trust store. It cannot do its job at postinst time — nobody has enrolled yet,
# so there are no credentials to fetch the CA with — so it polls until one
# appears and then exits. Restart=on-failure rather than always: a clean exit
# means the CA is trusted and there is nothing left to do.
cat > "$ROOT_DIR/usr/lib/systemd/system/aavishield-catrust.service" <<'UNIT'
[Unit]
Description=Aavishield SSL Inspection CA trust helper
After=network-online.target

[Service]
Type=simple
ExecStart=/opt/aavishield/aavishield-agent --ca-trust-daemon
Restart=on-failure
RestartSec=60

[Install]
WantedBy=multi-user.target
UNIT

# ─── 3. Debian metadata ───────────────────────────────────────────────────────
INSTALLED_SIZE=$(du -sk "$ROOT_DIR$INSTALL_PREFIX" | cut -f1)
cat > "$ROOT_DIR/DEBIAN/control" <<CONTROL
Package: aavishield-agent
Version: $VERSION
Section: net
Priority: optional
Architecture: $ARCH
Maintainer: Aavishield <support@aavishield.com>
Installed-Size: $INSTALLED_SIZE
Description: Aavishield security agent
 Local enforcement proxy that applies your organisation's web, DLP and
 malware policy to this device. Bundles its own Python runtime.
CONTROL

# Enrollment for unattended installs:
#   sudo AAVISHIELD_ENROLL_TOKEN=dse_... AAVISHIELD_ADMIN_URL=https://... \
#        dpkg -i aavishield-agent.deb
cat > "$ROOT_DIR/DEBIAN/postinst" <<'POSTINST'
#!/bin/bash
set -e
if [[ -n "${AAVISHIELD_ENROLL_TOKEN:-}" ]]; then
    mkdir -p /etc/aavishield
    printf '{"token":"%s","admin_url":"%s"}\n' \
        "$AAVISHIELD_ENROLL_TOKEN" "${AAVISHIELD_ADMIN_URL:-}" > /etc/aavishield/enroll.json
    chmod 644 /etc/aavishield/enroll.json
fi
systemctl --global enable aavishield-agent.service 2>/dev/null || true

# The CA-trust helper is systemwide, so unlike the agent it is enabled and
# started here rather than waiting for a desktop session.
mkdir -p /etc/aavishield
systemctl daemon-reload 2>/dev/null || true
systemctl enable --now aavishield-catrust.service 2>/dev/null || true

echo "Aavishield agent installed. Start it with: systemctl --user start aavishield-agent"
exit 0
POSTINST
chmod 755 "$ROOT_DIR/DEBIAN/postinst"

# The CA-trust helper has to stop before the certificate goes: left running, it
# would notice the missing CA and install it straight back.
cat > "$ROOT_DIR/DEBIAN/prerm" <<'PRERM'
#!/bin/bash
set -e
systemctl --global disable aavishield-agent.service 2>/dev/null || true
systemctl disable --now aavishield-catrust.service 2>/dev/null || true
exit 0
PRERM
chmod 755 "$ROOT_DIR/DEBIAN/prerm"

# Removing the package has to take the trust decision with it — an org CA left
# in the store outlives any reason to trust it.
cat > "$ROOT_DIR/DEBIAN/postrm" <<'POSTRM'
#!/bin/bash
set -e
if [[ "${1:-}" == "remove" || "${1:-}" == "purge" ]]; then
    rm -f /usr/local/share/ca-certificates/aavishield-ca.crt
    command -v update-ca-certificates >/dev/null 2>&1 && update-ca-certificates --fresh >/dev/null 2>&1 || true
    rm -rf /etc/aavishield
    systemctl daemon-reload 2>/dev/null || true
fi
exit 0
POSTRM
chmod 755 "$ROOT_DIR/DEBIAN/postrm"

# ─── 4. Build ─────────────────────────────────────────────────────────────────
DEB_OUT="$OUT_DIR/aavishield-agent-$VERSION-$ARCH.deb"
TGZ_OUT="$OUT_DIR/aavishield-agent-$VERSION-$ARCH.tar.gz"

if command -v dpkg-deb >/dev/null 2>&1; then
    echo "==> dpkg-deb"
    dpkg-deb --build --root-owner-group "$ROOT_DIR" "$DEB_OUT"
    echo "Built: $DEB_OUT"
    sha256sum "$DEB_OUT"
else
    echo "==> dpkg-deb unavailable — skipping .deb"
fi

# Portable tarball for non-Debian distros.
tar -czf "$TGZ_OUT" -C "$BUILD_DIR/dist" aavishield-agent
echo "Built: $TGZ_OUT"
sha256sum "$TGZ_OUT" 2>/dev/null || shasum -a 256 "$TGZ_OUT"

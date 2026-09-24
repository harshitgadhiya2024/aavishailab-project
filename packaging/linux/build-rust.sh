#!/usr/bin/env bash
#
# Builds a Linux .deb (and a portable .tar.gz) for the Rust Aavishield
# connector (services/endpoint-agent). A sibling to build.sh, which does the
# same for the Python connector — see packaging/macos/build-rust.sh's header
# for why this is a separate script rather than a shared one with a flag.
#
#   ./packaging/linux/build-rust.sh [version]
#
# Needs a real Rust toolchain plus the desktop-UI system headers the
# connector's GUI/tray/screen-capture link against — the same set
# Dockerfile.build and CI's rust-test-endpoint-agent job install. Easiest
# run inside that image:
#
#   docker build -f services/endpoint-agent/Dockerfile.build \
#     -t aavishield-agent-build services/endpoint-agent
#   docker run --rm -v "$PWD":/repo -w /repo aavishield-agent-build \
#     ./packaging/linux/build-rust.sh
#
set -euo pipefail

VERSION="${1:-1.0.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="$REPO_ROOT/services/endpoint-agent"
BUILD_DIR="$REPO_ROOT/build/linux-rust"
ROOT_DIR="$BUILD_DIR/root"
OUT_DIR="$REPO_ROOT/dist"

ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
INSTALL_PREFIX="/opt/aavishield"

ADMIN_URL="${AAVISHIELD_ADMIN_URL:-https://aavishield-api.aavishailab.com}"
PORTAL_URL="${AAVISHIELD_PORTAL_URL:-https://aavishield-employee.aavishailab.com}"

echo "==> Building Aavishield Rust connector $VERSION for Linux ($ARCH)"
echo "    admin:  $ADMIN_URL"
echo "    portal: $PORTAL_URL"

rm -rf "$BUILD_DIR"
mkdir -p "$ROOT_DIR$INSTALL_PREFIX" "$ROOT_DIR/DEBIAN" "$ROOT_DIR/usr/lib/systemd/user" "$OUT_DIR"

# ─── 1. Build the agent ───────────────────────────────────────────────────────
# AAVISHIELD_VERSION stamps into the binary via build.rs (see its own doc
# comment) — without this, config::AGENT_VERSION falls back to a fixed dev
# string that would make update.rs think an update is *always* available
# and loop forever redownloading itself, since the fallback never equals
# whatever version the manifest actually advertises.
echo "==> cargo build --release"
(cd "$AGENT_DIR" && AAVISHIELD_VERSION="$VERSION" cargo build --release)
AGENT_BUILD_BIN="$AGENT_DIR/target/release/aavishield-agent"
[[ -x "$AGENT_BUILD_BIN" ]] || { echo "!! build did not produce $AGENT_BUILD_BIN" >&2; exit 1; }
cp "$AGENT_BUILD_BIN" "$ROOT_DIR$INSTALL_PREFIX/aavishield-agent"
chmod 755 "$ROOT_DIR$INSTALL_PREFIX/aavishield-agent"

# ─── 2. systemd user unit ─────────────────────────────────────────────────────
# A user unit, not a system one — same reasoning as build.sh: the agent edits
# the desktop session's proxy settings. Environment= carries the deployment
# URLs; config::resolved_admin_url()/resolved_portal_url() already check
# these exact env var names before falling back to the compiled-in defaults,
# so — unlike build.sh's Python source-stamping step — nothing about the
# binary itself needs to change per deployment.
cat > "$ROOT_DIR/usr/lib/systemd/user/aavishield-agent.service" <<UNIT
[Unit]
Description=Aavishield security agent (Rust)
After=network-online.target

[Service]
Type=simple
Environment=AAVISHIELD_ADMIN_URL=$ADMIN_URL
Environment=AAVISHIELD_PORTAL_URL=$PORTAL_URL
ExecStart=$INSTALL_PREFIX/aavishield-agent
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

# No CA-trust system unit here — see this script's header comment and
# packaging/macos/build-rust.sh's: the Rust connector doesn't install the CA
# into the system trust store yet (README's Scope section), so shipping a
# unit that claims to would be actively misleading.

# ─── 3. Debian metadata ───────────────────────────────────────────────────────
# Depends: is computed, not hand-listed. The connector's GUI/tray/screen-
# capture stack (eframe, tray-icon, xcap) dynamically links against the
# better part of GTK3 — `ldd` on the built binary runs to ~80 lines of
# transitive libraries. Hand-writing that list is exactly the kind of thing
# that silently goes stale the next time a dependency bump changes what's
# linked, and a Depends: line that's merely *incomplete* fails at install
# time on a clean machine in a way that never shows up on a dev box where
# every library already happens to be present — which is exactly how this
# was found: the first real `dpkg -i` into an actual clean Debian container
# failed with "libgbm.so.1: cannot open shared object file", because
# nothing in this script had ever told dpkg the package needed it.
# dpkg-shlibdeps resolves this correctly and minimally — it already
# collapses libgtk-3-0's own enormous transitive chain down to the ~10
# packages actually worth declaring, since apt pulls in the rest when it
# installs those. It needs a debian/control to run at all (a packaging-
# script-only quirk — it was written assuming a full `debian/` source
# tree, which this flat DEBIAN/ layout deliberately isn't), so a throwaway
# one is created just to satisfy that check.
echo "==> dpkg-shlibdeps (computing runtime library dependencies)"
SHLIBS_SCRATCH="$BUILD_DIR/shlibdeps-scratch"
mkdir -p "$SHLIBS_SCRATCH/debian"
cp "$ROOT_DIR$INSTALL_PREFIX/aavishield-agent" "$SHLIBS_SCRATCH/aavishield-agent"
cat > "$SHLIBS_SCRATCH/debian/control" <<'SCRATCH_CONTROL'
Source: aavishield-agent-rust
Section: net
Priority: optional
Maintainer: Aavishield <support@aavishield.com>

Package: aavishield-agent-rust
Architecture: any
Depends: ${shlibs:Depends}
Description: scratch control file — dpkg-shlibdeps needs one to run at all
SCRATCH_CONTROL
RUNTIME_DEPENDS=$(cd "$SHLIBS_SCRATCH" && dpkg-shlibdeps -O ./aavishield-agent 2>/dev/null | sed -n 's/^shlibs:Depends=//p')
if [[ -z "$RUNTIME_DEPENDS" ]]; then
    echo "!! dpkg-shlibdeps produced no output — refusing to build a .deb with no Depends:" >&2
    echo "   (this would fail to link on a machine that doesn't happen to already have" >&2
    echo "   every library this binary needs, the exact bug this step exists to catch)" >&2
    exit 1
fi
echo "    Depends: $RUNTIME_DEPENDS"

INSTALLED_SIZE=$(du -sk "$ROOT_DIR$INSTALL_PREFIX" | cut -f1)
cat > "$ROOT_DIR/DEBIAN/control" <<CONTROL
Package: aavishield-agent-rust
Version: $VERSION
Section: net
Priority: optional
Architecture: $ARCH
Maintainer: Aavishield <support@aavishield.com>
Installed-Size: $INSTALLED_SIZE
Depends: $RUNTIME_DEPENDS
Conflicts: aavishield-agent
Replaces: aavishield-agent
Description: Aavishield security agent (Rust connector)
 Local enforcement proxy that applies your organisation's web, DLP and
 malware policy to this device. Native binary, no bundled runtime.
CONTROL

# Enrollment for unattended installs — identical contract to build.sh's, so
# an existing MDM/provisioning script that already sets these two env vars
# before `dpkg -i` works unchanged against either package:
#   sudo AAVISHIELD_ENROLL_TOKEN=dse_... AAVISHIELD_ADMIN_URL=https://... \
#        dpkg -i aavishield-agent-rust.deb
cat > "$ROOT_DIR/DEBIAN/postinst" <<'POSTINST'
#!/bin/bash
set -e
if [[ -n "${AAVISHIELD_ENROLL_TOKEN:-}" ]]; then
    mkdir -p /etc/aavishield
    printf '{"token":"%s","admin_url":"%s"}\n' \
        "$AAVISHIELD_ENROLL_TOKEN" "${AAVISHIELD_ADMIN_URL:-}" > /etc/aavishield/enroll.json
    chmod 644 /etc/aavishield/enroll.json
fi

# dpkg installs this root-owned, but the agent runs as the unprivileged
# desktop user via the --user unit below, and update.rs's
# download_and_swap() replaces its own binary in place — without this it
# would silently fail to write and auto-update would never actually apply,
# the identical failure mode build.sh's own postinst documents for Python.
if [[ -n "${SUDO_USER:-}" ]]; then
    chown -R "$SUDO_USER" /opt/aavishield 2>/dev/null || true
fi

systemctl --global enable aavishield-agent.service 2>/dev/null || true
echo "Aavishield Rust connector installed. Start it with: systemctl --user start aavishield-agent"
exit 0
POSTINST
chmod 755 "$ROOT_DIR/DEBIAN/postinst"

cat > "$ROOT_DIR/DEBIAN/prerm" <<'PRERM'
#!/bin/bash
set -e
systemctl --global disable aavishield-agent.service 2>/dev/null || true
exit 0
PRERM
chmod 755 "$ROOT_DIR/DEBIAN/prerm"

cat > "$ROOT_DIR/DEBIAN/postrm" <<'POSTRM'
#!/bin/bash
set -e
if [[ "${1:-}" == "remove" || "${1:-}" == "purge" ]]; then
    rm -rf /etc/aavishield
    systemctl daemon-reload 2>/dev/null || true
fi
exit 0
POSTRM
chmod 755 "$ROOT_DIR/DEBIAN/postrm"

# ─── 4. Build ─────────────────────────────────────────────────────────────────
DEB_OUT="$OUT_DIR/aavishield-agent-rust-$VERSION-$ARCH.deb"
TGZ_OUT="$OUT_DIR/aavishield-agent-rust-$VERSION-$ARCH.tar.gz"

if command -v dpkg-deb >/dev/null 2>&1; then
    echo "==> dpkg-deb"
    dpkg-deb --build --root-owner-group "$ROOT_DIR" "$DEB_OUT"
    echo "Built: $DEB_OUT"
    sha256sum "$DEB_OUT"
else
    echo "==> dpkg-deb unavailable — skipping .deb"
fi

tar -czf "$TGZ_OUT" -C "$ROOT_DIR$INSTALL_PREFIX" aavishield-agent
echo "Built: $TGZ_OUT"
sha256sum "$TGZ_OUT" 2>/dev/null || shasum -a 256 "$TGZ_OUT"

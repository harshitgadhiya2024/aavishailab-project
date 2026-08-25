#!/usr/bin/env bash
#
# Builds a macOS .pkg installer for the Aavishield agent.
#
#   ./packaging/macos/build.sh [version]
#
# Signing and notarization are opt-in via environment variables. Without them
# the build still produces a working (unsigned) .pkg for internal testing —
# unsigned packages will be blocked by Gatekeeper on employee machines, so
# release builds must set these:
#
#   DEVELOPER_ID_APP="Developer ID Application: Acme Inc (TEAMID)"
#   DEVELOPER_ID_INSTALLER="Developer ID Installer: Acme Inc (TEAMID)"
#   NOTARY_PROFILE="aavishield"     # from: xcrun notarytool store-credentials
#
set -euo pipefail

VERSION="${1:-1.1.0}"
IDENTIFIER="com.aavishield.agent"
CATRUST_IDENTIFIER="com.aavishield.catrust"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="$REPO_ROOT/build/macos"
ROOT_DIR="$BUILD_DIR/root"
OUT_DIR="$REPO_ROOT/dist"

# /Applications, not /usr/local: Spotlight and Launchpad only index the former.
# An app under /usr/local can't be searched for and isn't in Launchpad, so it
# reads as a stray background process rather than software the company
# installed. /usr/local keeps only non-app state (the CA-trust marker).
INSTALL_PREFIX="/Applications"

# Which deployment this build belongs to. Baked into the binary because the
# package is generic — with no employee-specific token to carry an admin URL,
# the agent has to already know where to enrol and which portal to open.
ADMIN_URL="${AAVISHIELD_ADMIN_URL:-https://aavishield-api.aavishailab.com}"
PORTAL_URL="${AAVISHIELD_PORTAL_URL:-https://aavishield-employee.aavishailab.com}"

echo "==> Building Aavishield agent $VERSION for macOS ($(uname -m))"
echo "    admin:  $ADMIN_URL"
echo "    portal: $PORTAL_URL"

rm -rf "$BUILD_DIR"
mkdir -p "$ROOT_DIR$INSTALL_PREFIX" "$ROOT_DIR/Library/LaunchAgents" \
         "$ROOT_DIR/Library/LaunchDaemons" "$OUT_DIR"

# ─── 1. Freeze the agent ──────────────────────────────────────────────────────
# The deployment URLs are stamped into a scratch copy rather than the tracked
# source, so a build never leaves the working tree modified.
echo "==> Freezing agent with PyInstaller"
cd "$REPO_ROOT"
STAMPED_SRC="$BUILD_DIR/src"
mkdir -p "$STAMPED_SRC"
cp scripts/agent/aavishield-agent.py "$STAMPED_SRC/aavishield-agent.py"
# AGENT_VERSION is stamped too, not just the URLs: it's what the app window,
# the tray, and the device record all report, and leaving it at the source's
# hardcoded value made every release show that old number regardless of the
# .pkg it shipped in (v1.5.0 on a 2.1.x build).
python3 - "$STAMPED_SRC/aavishield-agent.py" "$ADMIN_URL" "$PORTAL_URL" "$VERSION" <<'STAMP'
import re, sys
path, admin, portal, version = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
src = open(path).read()
for name, value in (("DEFAULT_ADMIN_URL", admin), ("DEFAULT_PORTAL_URL", portal),
                    ("AGENT_VERSION", version)):
    src, n = re.subn(rf'^{name}\s*=\s*".*"\r?$', f'{name}  = "{value}"',
                     src, count=1, flags=re.M)
    if n != 1:
        sys.exit(f"could not stamp {name} — the agent's constants moved")
open(path, "w").write(src)
STAMP

# AAVISHIELD_VERSION feeds CFBundleShortVersionString. Without it the bundle
# reports the spec's 1.0.0 fallback, so Finder's Get Info and the installer's
# upgrade check both disagree with the version the agent actually reports.
AAVISHIELD_AGENT_SRC="$STAMPED_SRC/aavishield-agent.py" \
AAVISHIELD_VERSION="$VERSION" \
python3 -m PyInstaller --clean --noconfirm --distpath "$BUILD_DIR/dist" \
    --workpath "$BUILD_DIR/work" packaging/aavishield-agent.spec

# The spec wraps EXE in a BUNDLE() on macOS — see packaging/aavishield-agent.spec
# for why a bare Mach-O binary isn't enough for the tray icon to show up.
APP_NAME="Aavishield.app"
AGENT_BIN="$INSTALL_PREFIX/$APP_NAME/Contents/MacOS/aavishield-agent"
cp -R "$BUILD_DIR/dist/$APP_NAME" "$ROOT_DIR$INSTALL_PREFIX/$APP_NAME"
chmod 755 "$ROOT_DIR$INSTALL_PREFIX/$APP_NAME/Contents/MacOS/aavishield-agent"

# ─── 2. Sign the app bundle ───────────────────────────────────────────────────
# Hardened runtime is required for notarization. Signing the bundle path (not
# just the inner binary) lets codesign pick up Info.plist and seal the bundle
# as a unit, which is what Gatekeeper/notarization expect.
if [[ -n "${DEVELOPER_ID_APP:-}" ]]; then
    echo "==> Signing app bundle as: $DEVELOPER_ID_APP"
    codesign --force --options runtime --timestamp \
        --sign "$DEVELOPER_ID_APP" "$ROOT_DIR$INSTALL_PREFIX/$APP_NAME"
else
    echo "==> DEVELOPER_ID_APP unset — building UNSIGNED (testing only)"
fi

# ─── 3. LaunchAgent ───────────────────────────────────────────────────────────
# A LaunchAgent (per-user) rather than a LaunchDaemon (root): the agent edits
# the logged-in user's proxy settings and needs their session. KeepAlive is what
# makes the auto-updater's exec-and-exit restart work.
cat > "$ROOT_DIR/Library/LaunchAgents/$IDENTIFIER.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$IDENTIFIER</string>
    <key>ProgramArguments</key>
    <array><string>$AGENT_BIN</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>/tmp/aavishield-agent.out</string>
    <key>StandardErrorPath</key><string>/tmp/aavishield-agent.err</string>
</dict>
</plist>
PLIST

# ─── 3b. CA-trust LaunchDaemon ────────────────────────────────────────────────
# Root, unlike the agent: installing the org CA writes to the System keychain.
# It cannot do its job at install time — nobody has enrolled yet, so there are
# no credentials to fetch the CA with — so it polls until one appears and then
# exits. KeepAlive is deliberately absent; StartInterval restarts it, and a
# run that finds the marker already there returns immediately.
cat > "$ROOT_DIR/Library/LaunchDaemons/$CATRUST_IDENTIFIER.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$CATRUST_IDENTIFIER</string>
    <key>ProgramArguments</key>
    <array>
        <string>$AGENT_BIN</string>
        <string>--ca-trust-daemon</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>StartInterval</key><integer>300</integer>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>/var/log/aavishield-catrust.log</string>
    <key>StandardErrorPath</key><string>/var/log/aavishield-catrust.log</string>
</dict>
</plist>
PLIST

# ─── 3c. No on-disk uninstaller ───────────────────────────────────────────────
# Deliberately absent. Removal is company-controlled now: the portal only
# serves an uninstaller once an administrator sets uninstall_allowed on the
# device (see DownloadUninstaller in admin-api). Shipping a self-service
# uninstaller in /Applications would hand every employee the exact bypass that
# policy exists to prevent.

# ─── 4. postinstall ───────────────────────────────────────────────────────────
mkdir -p "$BUILD_DIR/scripts"
cat > "$BUILD_DIR/scripts/postinstall" <<'POST'
#!/bin/bash
# Loads the LaunchAgent into the console user's session. Installers run as
# root, so bootstrapping into the user's GUI domain needs an explicit uid.
set -e
CONSOLE_USER=$(stat -f%Su /dev/console)
CONSOLE_UID=$(id -u "$CONSOLE_USER")
PLIST="/Library/LaunchAgents/com.aavishield.agent.plist"
CATRUST_PLIST="/Library/LaunchDaemons/com.aavishield.catrust.plist"

# pkgbuild preserves the payload's build-time ownership (the CI runner's
# uid), which has no reliable relationship to this Mac's actual console
# user. The agent runs as that console user via the LaunchAgent above, and
# AutoUpdater._download_and_swap() writes its own replacement binary into
# this same directory — without this chown that write silently fails with
# a permission error nobody sees (the update loop only logs at debug), so
# the agent can build/publish new versions forever and never actually
# self-update on a real Mac.
chown -R "$CONSOLE_USER" /Applications/Aavishield.app 2>/dev/null || true

launchctl bootout   "gui/$CONSOLE_UID/com.aavishield.agent" 2>/dev/null || true
launchctl bootstrap "gui/$CONSOLE_UID" "$PLIST" 2>/dev/null || true
launchctl enable    "gui/$CONSOLE_UID/com.aavishield.agent" 2>/dev/null || true

# The CA-trust helper runs in the system domain, not the user's. Reinstalling
# over a version whose CA is already trusted is fine: the helper sees its own
# marker and exits without touching the keychain again.
mkdir -p /etc/aavishield
launchctl bootout   system "$CATRUST_PLIST" 2>/dev/null || true
launchctl bootstrap system "$CATRUST_PLIST" 2>/dev/null || true
exit 0
POST
chmod +x "$BUILD_DIR/scripts/postinstall"

# ─── 5. Build the package ─────────────────────────────────────────────────────
PKG_RAW="$BUILD_DIR/$IDENTIFIER-raw.pkg"
PKG_OUT="$OUT_DIR/aavishield-agent-$VERSION.pkg"

echo "==> pkgbuild"
pkgbuild --root "$ROOT_DIR" --scripts "$BUILD_DIR/scripts" \
    --identifier "$IDENTIFIER" --version "$VERSION" \
    --install-location / "$PKG_RAW"

echo "==> productbuild"
if [[ -n "${DEVELOPER_ID_INSTALLER:-}" ]]; then
    productbuild --package "$PKG_RAW" --sign "$DEVELOPER_ID_INSTALLER" "$PKG_OUT"
else
    productbuild --package "$PKG_RAW" "$PKG_OUT"
fi

# ─── 6. Notarize ──────────────────────────────────────────────────────────────
# Without notarization macOS shows "cannot be opened because Apple cannot check
# it for malicious software" — this step is what makes the installer just work.
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
    echo "==> Notarizing (this takes a few minutes)"
    xcrun notarytool submit "$PKG_OUT" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$PKG_OUT"
else
    echo "==> NOTARY_PROFILE unset — skipping notarization"
fi

echo ""
echo "Built: $PKG_OUT"
shasum -a 256 "$PKG_OUT"

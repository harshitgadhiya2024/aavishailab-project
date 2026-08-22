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

INSTALL_PREFIX="/usr/local/aavishield"

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
         "$ROOT_DIR/Library/LaunchDaemons" "$ROOT_DIR/Applications" "$OUT_DIR"

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

# ─── 3c. On-disk uninstaller ──────────────────────────────────────────────────
# A .pkg install has no Add/Remove-Programs equivalent on macOS — nothing shows
# up in Launchpad or Finder to remove it. Dropping a double-clickable uninstaller
# in /Applications (the one place every Mac user already looks to remove
# software) is what makes "how do I uninstall this" answerable without going
# back to the portal or a terminal one-liner from IT.
cat > "$ROOT_DIR/Applications/Aavishield Uninstaller.command" <<'UNINSTALL'
#!/usr/bin/env bash
set -euo pipefail

INSTALL_PREFIX="/usr/local/aavishield"
CONFIG_FILE="$HOME/.aavishield/config.json"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }

clear
echo -e "${BOLD}${BLUE}🛡️  Aavishield Agent Uninstaller — macOS${NC}"
echo "────────────────────────────────────────"
echo
read -p "This will remove the Aavishield agent from this Mac. Continue? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }

if [[ -f "$CONFIG_FILE" ]]; then
    DEVICE_ID=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('device_id',''))" 2>/dev/null || echo "")
    AGENT_KEY=$(python3  -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('agent_key',''))"  2>/dev/null || echo "")
    ADMIN_URL=$(python3  -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('admin_url',''))"  2>/dev/null || echo "")
    if [[ -n "$DEVICE_ID" && -n "$AGENT_KEY" && -n "$ADMIN_URL" ]]; then
        info "Notifying Aavishield server..."
        curl -s -X POST "$ADMIN_URL/internal/agent/offline" \
            -H "Authorization: Bearer $DEVICE_ID:$AGENT_KEY" \
            -H "Content-Type: application/json" -d '{}' 2>/dev/null || true
        ok "Server notified"
    fi
fi

info "This needs your Mac login password to remove system files."
if sudo -v; then
    sudo launchctl bootout system /Library/LaunchDaemons/com.aavishield.catrust.plist 2>/dev/null || true
    sudo launchctl bootout "gui/$(id -u)" /Library/LaunchAgents/com.aavishield.agent.plist 2>/dev/null || true
    sudo rm -f /Library/LaunchDaemons/com.aavishield.catrust.plist \
               /Library/LaunchAgents/com.aavishield.agent.plist
    sudo rm -rf /etc/aavishield "$INSTALL_PREFIX"
    sudo pkgutil --forget com.aavishield.agent 2>/dev/null || true
    ok "Agent stopped and files removed"

    info "Removing system proxy settings..."
    while IFS= read -r SERVICE; do
        [[ -z "$SERVICE" || "$SERVICE" == "An asterisk"* ]] && continue
        networksetup -setwebproxystate       "$SERVICE" off 2>/dev/null || true
        networksetup -setsecurewebproxystate "$SERVICE" off 2>/dev/null || true
        networksetup -setproxybypassdomains  "$SERVICE" "" 2>/dev/null || true
    done < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2)
    ok "Proxy cleared"

    info "Removing SSL Inspection certificate..."
    sudo security delete-certificate -c "Aavishield SSL Inspection CA" /Library/Keychains/System.keychain 2>/dev/null \
        && ok "Certificate removed" || info "No certificate found (nothing to remove)"
else
    echo "Admin password required — uninstall cancelled."
    exit 1
fi

rm -rf "$HOME/.aavishield"

echo
echo -e "${BOLD}${GREEN}✅  Aavishield Agent removed successfully!${NC}"
echo
read -p "Press Enter to close..."
UNINSTALL
chmod +x "$ROOT_DIR/Applications/Aavishield Uninstaller.command"

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
chown -R "$CONSOLE_USER" /usr/local/aavishield 2>/dev/null || true

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

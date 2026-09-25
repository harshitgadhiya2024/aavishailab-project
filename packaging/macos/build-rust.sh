#!/usr/bin/env bash
#
# Builds a macOS .pkg installer for the Rust Aavishield connector
# (services/endpoint-agent). A sibling to build.sh, which does the same for
# the Python connector — kept as two scripts, not one with a language flag,
# because the two differ in exactly the ways that make a shared script worse
# than two clear ones: no PyInstaller freeze step, no source-stamping (the
# Rust binary reads its deployment URLs from the LaunchAgent's own
# EnvironmentVariables instead of having them compiled in), and no CA-trust
# LaunchDaemon — the Rust connector doesn't install the CA into the system
# trust store yet (see the top-level README's Scope section), so shipping a
# daemon that claims to would be actively misleading.
#
#   ./packaging/macos/build-rust.sh [version]
#
# Signing and notarization are opt-in via environment variables, exactly as
# in build.sh:
#
#   DEVELOPER_ID_APP="Developer ID Application: Acme Inc (TEAMID)"
#   DEVELOPER_ID_INSTALLER="Developer ID Installer: Acme Inc (TEAMID)"
#   NOTARY_PROFILE="aavishield"     # from: xcrun notarytool store-credentials
#
set -euo pipefail

VERSION="${1:-1.0.0}"
IDENTIFIER="com.aavishield.agent"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="$REPO_ROOT/services/endpoint-agent"
BUILD_DIR="$REPO_ROOT/build/macos-rust"
ROOT_DIR="$BUILD_DIR/root"
OUT_DIR="$REPO_ROOT/dist"

# /Applications, not /usr/local — same reasoning as build.sh: Spotlight and
# Launchpad only index the former, and an unindexed background process reads
# as something a person should be suspicious of, not software their company
# installed on purpose.
INSTALL_PREFIX="/Applications"
APP_NAME="Aavishield.app"

ADMIN_URL="${AAVISHIELD_ADMIN_URL:-https://aavishield-api.aavishailab.com}"
PORTAL_URL="${AAVISHIELD_PORTAL_URL:-https://aavishield-employee.aavishailab.com}"

# Apple Silicon only, same known gap build.sh's own comments document for
# the Python build (and the same one agent-packages.yml's macos job carries
# for the exact same reason: cross-compiling universal2 from this toolchain
# needs Apple's SDK for the other slice, which this environment can't fetch
# from an unofficial source). A universal2 build is a separate piece of
# work — `rustup target add x86_64-apple-darwin` plus `lipo` to merge the
# two slices — not attempted here.
if [[ "$(uname -m)" != "arm64" ]]; then
    echo "!! This produces an arm64-only binary; building on $(uname -m) would produce the wrong slice." >&2
    exit 1
fi

echo "==> Building Aavishield Rust connector $VERSION for macOS (arm64)"
echo "    admin:  $ADMIN_URL"
echo "    portal: $PORTAL_URL"

rm -rf "$BUILD_DIR"
mkdir -p "$ROOT_DIR$INSTALL_PREFIX" "$ROOT_DIR/Library/LaunchAgents" "$OUT_DIR"

# ─── 1. Build the agent ───────────────────────────────────────────────────────
# AAVISHIELD_VERSION stamps into the binary via build.rs (see its own doc
# comment) — without this, config::AGENT_VERSION falls back to a fixed dev
# string that would make update.rs think an update is *always* available
# and loop forever redownloading itself, since the fallback never equals
# whatever version the manifest actually advertises.
echo "==> cargo build --release"
(cd "$AGENT_DIR" && AAVISHIELD_VERSION="$VERSION" cargo build --release --target aarch64-apple-darwin)
AGENT_BUILD_BIN="$AGENT_DIR/target/aarch64-apple-darwin/release/aavishield-agent"
[[ -x "$AGENT_BUILD_BIN" ]] || { echo "!! build did not produce $AGENT_BUILD_BIN" >&2; exit 1; }

# ─── 2. Assemble the .app bundle ──────────────────────────────────────────────
# A real bundle, not a bare Mach-O binary: macOS's TCC privacy system (Screen
# Recording, Accessibility/Input Monitoring — both of which this connector
# needs, for screenshots and activity counting) keys its grants to bundle
# identity. A raw executable can still trigger the prompts, but shows up in
# System Settings → Privacy under whatever the binary happens to be named
# that run, not as "Aavishield" consistently across reinstalls/updates.
APP_DIR="$ROOT_DIR$INSTALL_PREFIX/$APP_NAME"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$AGENT_BUILD_BIN" "$APP_DIR/Contents/MacOS/aavishield-agent"
chmod 755 "$APP_DIR/Contents/MacOS/aavishield-agent"
cp "$REPO_ROOT/packaging/icons/aavishield.icns" "$APP_DIR/Contents/Resources/aavishield.icns"

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Aavishield</string>
    <key>CFBundleDisplayName</key><string>Aavishield</string>
    <key>CFBundleIdentifier</key><string>$IDENTIFIER</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleExecutable</key><string>aavishield-agent</string>
    <key>CFBundleIconFile</key><string>aavishield</string>
    <!-- Menu-bar-only app: the tray icon is the whole point, and an
         un-hidden connector would also claim a Dock icon and appear in
         Cmd+Tab, which nothing about this product wants. -->
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
    <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST

# ─── 3. Sign the app bundle ───────────────────────────────────────────────────
# Always signed, never "unsigned", because there is no such thing here: an
# un-codesigned Rust binary still carries the ad-hoc, linker-generated
# signature the toolchain puts there, and that signature is actively wrong
# for a bundle. It identifies the app as `aavishield_agent-<hash of the
# binary>` rather than $IDENTIFIER, leaves `Info.plist=not bound`, and
# seals no resources — so macOS never reads the bundle identity this
# Info.plist declares.
#
# That is not cosmetic. TCC grants (Screen Recording, Input Monitoring)
# are recorded against the signing identity, so with the linker's
# signature every rebuild is a *different app* to the OS. A device that
# was granted Screen Recording shows its grant against an identity the
# next build no longer has, screenshots silently become wallpaper (see
# screenshot.rs), and the permission list fills with one stale entry per
# build — observed exactly that way on a real Mac.
#
# Re-signing ad-hoc with an explicit --identifier fixes the identity and
# the sealing. It does NOT fix updates: an ad-hoc signature has no stable
# designated requirement, so TCC still matches on the code directory hash
# and a new build is still a new app. Only a Developer ID certificate
# gives a grant something stable to survive an update against, which is
# why DEVELOPER_ID_APP is what a real release must set.
if [[ -n "${DEVELOPER_ID_APP:-}" ]]; then
    echo "==> Signing app bundle as: $DEVELOPER_ID_APP"
    codesign --force --options runtime --timestamp --identifier "$IDENTIFIER" --sign "$DEVELOPER_ID_APP" "$APP_DIR"
else
    echo "==> DEVELOPER_ID_APP unset — signing ad-hoc as $IDENTIFIER"
    echo "    NOTE: TCC grants will not survive an update. Set DEVELOPER_ID_APP for a real release."
    codesign --force --options runtime --identifier "$IDENTIFIER" --sign - "$APP_DIR"
fi

# Proves the two things that were wrong before: the bundle identity is
# $IDENTIFIER, and the Info.plist declaring it is sealed into the
# signature. Cheap, and it fails the build rather than shipping a package
# whose permissions quietly will not stick.
echo "==> Verifying the bundle's signed identity"
codesign --verify --strict "$APP_DIR"
sig_info="$(codesign -dv --verbose=2 "$APP_DIR" 2>&1)"
grep -q "^Identifier=$IDENTIFIER\$" <<<"$sig_info" || {
    echo "!! signed identifier is not $IDENTIFIER:" >&2
    grep "^Identifier=" <<<"$sig_info" >&2
    exit 1
}
grep -q "Info.plist=not bound" <<<"$sig_info" && {
    echo "!! Info.plist is not sealed into the signature — TCC will not bind grants to $IDENTIFIER" >&2
    exit 1
}
echo "    ok: $(grep '^Identifier=' <<<"$sig_info")"

# ─── 4. LaunchAgent ────────────────────────────────────────────────────────────
# Per-user, not per-machine, for the same reason build.sh's does: the agent
# edits the logged-in user's proxy settings and needs their session.
# EnvironmentVariables carries the deployment URLs — config::
# resolved_admin_url()/resolved_portal_url() already check these exact names
# before falling back to the compiled-in defaults, so this is the whole
# "stamping" step; unlike build.sh, nothing about the binary itself needs to
# change per deployment.
cat > "$ROOT_DIR/Library/LaunchAgents/$IDENTIFIER.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$IDENTIFIER</string>
    <key>ProgramArguments</key>
    <array><string>$INSTALL_PREFIX/$APP_NAME/Contents/MacOS/aavishield-agent</string></array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AAVISHIELD_ADMIN_URL</key><string>$ADMIN_URL</string>
        <key>AAVISHIELD_PORTAL_URL</key><string>$PORTAL_URL</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>/tmp/aavishield-agent.out</string>
    <key>StandardErrorPath</key><string>/tmp/aavishield-agent.err</string>
</dict>
</plist>
PLIST

# No CA-trust LaunchDaemon here — see this script's header comment. Adding
# one back is a one-line change (copy build.sh's step 3b) the moment
# uninstall.rs's macOS path gains its counterpart, CA installation.

# ─── 5. postinstall ────────────────────────────────────────────────────────────
mkdir -p "$BUILD_DIR/scripts"
cat > "$BUILD_DIR/scripts/postinstall" <<'POST'
#!/bin/bash
# Loads the LaunchAgent into the console user's session. Installers run as
# root, so bootstrapping into the user's GUI domain needs an explicit uid —
# identical reasoning to build.sh's postinstall.
set -e
CONSOLE_USER=$(stat -f%Su /dev/console)
CONSOLE_UID=$(id -u "$CONSOLE_USER")
PLIST="/Library/LaunchAgents/com.aavishield.agent.plist"

# pkgbuild preserves the payload's build-time ownership; the agent runs as
# the console user via the LaunchAgent above and update.rs's
# download_and_swap() writes its own replacement binary in place — without
# this chown that write fails silently on a real Mac the same way it did
# for the Python build before build.sh's own postinstall gained this line.
chown -R "$CONSOLE_USER" /Applications/Aavishield.app 2>/dev/null || true

launchctl bootout   "gui/$CONSOLE_UID/com.aavishield.agent" 2>/dev/null || true
launchctl bootstrap "gui/$CONSOLE_UID" "$PLIST" 2>/dev/null || true
launchctl enable    "gui/$CONSOLE_UID/com.aavishield.agent" 2>/dev/null || true
exit 0
POST
chmod +x "$BUILD_DIR/scripts/postinstall"

# ─── 6. Build the package ──────────────────────────────────────────────────────
PKG_RAW="$BUILD_DIR/$IDENTIFIER-raw.pkg"
PKG_OUT="$OUT_DIR/aavishield-agent-rust-$VERSION.pkg"

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

# ─── 7. Notarize ────────────────────────────────────────────────────────────────
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

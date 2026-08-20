#!/usr/bin/env bash
#
# Build a SIGNED, NOTARIZED macOS installer (.pkg) for the Delphic Secure
# Client Connector. Run on a Mac with Xcode command-line tools and an Apple
# Developer ID. This turns "download a script" into a proper native app.
#
# Required env:
#   DEVELOPER_ID_APP="Developer ID Application: Your Company (TEAMID)"
#   DEVELOPER_ID_INSTALLER="Developer ID Installer: Your Company (TEAMID)"
#   NOTARY_PROFILE="the notarytool keychain profile name"
#
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${VERSION:-1.0.0}"
APP="dist/DelphicSecureConnector.app"
PKG_ROOT="build/pkgroot"
PKG_OUT="dist/DelphicSecureConnector-${VERSION}.pkg"

echo "▶ Installing build deps"
python3 -m pip install -q -r requirements-build.txt

echo "▶ Building app bundle with PyInstaller"
pyinstaller --noconfirm aavishield-connector.spec

if [[ -n "${DEVELOPER_ID_APP:-}" ]]; then
  echo "▶ Code-signing the .app (hardened runtime)"
  codesign --deep --force --options runtime --timestamp \
    --sign "$DEVELOPER_ID_APP" "$APP"
else
  echo "⚠ DEVELOPER_ID_APP not set — producing an UNSIGNED build (Gatekeeper will warn)."
fi

echo "▶ Staging pkg payload"
rm -rf "$PKG_ROOT"
mkdir -p "$PKG_ROOT/Applications"
cp -R "$APP" "$PKG_ROOT/Applications/"

# postinstall script registers the agent as a launchd service + trusts the CA
# (see scripts/postinstall). It's the same steps the old shell installer did.
echo "▶ Building component pkg"
pkgbuild --root "$PKG_ROOT" \
  --identifier com.aavishield.connector \
  --version "$VERSION" \
  --scripts scripts \
  --install-location / \
  build/component.pkg

echo "▶ Building product archive"
if [[ -n "${DEVELOPER_ID_INSTALLER:-}" ]]; then
  productbuild --package build/component.pkg --sign "$DEVELOPER_ID_INSTALLER" "$PKG_OUT"
else
  productbuild --package build/component.pkg "$PKG_OUT"
fi

if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  echo "▶ Notarizing"
  xcrun notarytool submit "$PKG_OUT" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$PKG_OUT"
fi

echo "✅ Built $PKG_OUT"

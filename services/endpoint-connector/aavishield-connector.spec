# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec — bundles the headless agent AND the tray UI into a single
# distributable binary. Build with:  pyinstaller aavishield-connector.spec
#
# The agent script is copied in from the admin-api assets dir at build time (it
# is the single source of truth for the enforcement daemon).

import os

block_cipher = None

AGENT_SRC = os.path.join(
    "..", "admin-api", "internal", "handlers", "assets", "aavishield-agent.py"
)

a = Analysis(
    ["tray.py"],
    pathex=["."],
    binaries=[],
    # Ship the agent daemon alongside the tray so the installer can register it
    # as a service; the tray supervises it.
    datas=[(AGENT_SRC, ".")],
    hiddenimports=["PIL._tkinter_finder"],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    name="DelphicSecureConnector",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,          # windowed / menu-bar app, no terminal
    disable_windowed_traceback=False,
    target_arch=None,       # set to "universal2" on macOS for Intel+ARM
    codesign_identity=None, # set via build script env for signed builds
    entitlements_file=None,
    icon="assets/icon.icns",
)

# macOS app bundle (menu-bar app). On Windows/Linux the EXE above is the artifact.
app = BUNDLE(
    exe,
    name="DelphicSecureConnector.app",
    icon="assets/icon.icns",
    bundle_identifier="com.aavishield.connector",
    info_plist={
        "LSUIElement": True,          # menu-bar only, no Dock icon
        "CFBundleDisplayName": "Delphic Secure Client Connector",
        "CFBundleShortVersionString": "1.0.0",
        "NSHighResolutionCapable": True,
    },
)

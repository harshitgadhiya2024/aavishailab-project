# PyInstaller spec — bundles the CPython runtime with the agent so a target
# machine no longer needs Python preinstalled. Build with:
#
#   pyinstaller --clean --noconfirm packaging/aavishield-agent.spec
#
# Produces dist/aavishield-agent (a single self-contained executable).

import os
import sys

block_cipher = None

# pystray/Pillow drive the tray UI. They are optional at runtime — the agent
# degrades to headless when they are absent — so a build box without them still
# produces a working (tray-less) binary rather than failing.
# certifi is NOT optional. A frozen build carries its own OpenSSL, whose
# compiled-in CA paths point at the build machine's layout (e.g. Homebrew's
# /opt/homebrew/etc/openssl@3) — absent on an employee's Mac, and unreachable
# from launchd's bare environment. Without a bundled bundle every HTTPS call
# fails CERTIFICATE_VERIFY_FAILED, so the agent cannot enrol or heartbeat and
# the device never shows up in the dashboard.
required_hiddenimports = ["certifi"]

optional_hiddenimports = []
for mod in (
    "pystray", "PIL.Image", "PIL.ImageDraw", "PIL.ImageFilter", "PIL.ImageGrab",
    "mss", "mss.darwin", "mss.windows", "mss.linux",
    "pynput", "pynput.keyboard", "pynput.mouse",
    "pynput.keyboard._darwin", "pynput.mouse._darwin",
    "pynput.keyboard._win32", "pynput.mouse._win32",
    "pynput.keyboard._xorg", "pynput.mouse._xorg",
    # Desktop UI. Each platform has exactly one usable backend and the others
    # legitimately fail to import here, which the probe below already handles;
    # naming them all keeps one spec working for all three builds.
    "webview",
    "webview.platforms.cocoa",          # macOS (PyObjC + WebKit)
    "webview.platforms.edgechromium",   # Windows (WebView2 via pythonnet)
    "webview.platforms.winforms",       # Windows fallback
    "webview.platforms.gtk",            # Linux (WebKitGTK)
):
    try:
        __import__(mod)
        optional_hiddenimports.append(mod)
    except Exception:
        # Broad on purpose: pystray/pynput's X11 backend raises
        # Xlib.error.DisplayNameError (not ImportError) when built on a
        # headless box with no DISPLAY — the normal case for a CI/build
        # server — and that must degrade the same as a missing package.
        pass

# The platform build scripts stamp the deployment's admin/portal URLs into a
# scratch copy of the agent and point this at it, so a build never has to edit
# — and risk leaving edits in — the tracked source.
agent_source = os.environ.get("AAVISHIELD_AGENT_SRC") or "../scripts/agent/aavishield-agent.py"

# The desktop UI's HTML, resolved from the repo rather than from the stamped
# scratch copy the build scripts point AAVISHIELD_AGENT_SRC at — those live in
# build/, which has no ui/ directory. Bundled under "ui/" so _ui_asset() finds
# it at sys._MEIPASS/ui/. Absent assets are not fatal: the agent falls back to
# the tray, exactly as it does when pywebview itself is missing.
_repo_root = os.path.dirname(SPECPATH)
_ui_dir = os.path.join(_repo_root, "scripts", "agent", "ui")
ui_datas = [(_ui_dir, "ui")] if os.path.isdir(_ui_dir) else []

a = Analysis(
    [agent_source],
    pathex=[],
    binaries=[],
    datas=ui_datas,
    hiddenimports=required_hiddenimports + optional_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Trim the heavyweight stdlib GUI/test packages the agent never touches;
    # keeps the binary small enough to ship as an auto-update payload.
    excludes=["tkinter", "unittest", "pydoc_data", "test", "distutils"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="aavishield-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX-packed binaries trip AV heuristics; not worth the size win
    runtime_tmpdir=None,
    # The agent is a background daemon. A console window would flash on every
    # Windows login; macOS/Linux ignore this flag.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=os.environ.get("AAVISHIELD_TARGET_ARCH") or None,
    codesign_identity=None,  # signing happens in the platform build scripts
    entitlements_file=None,
)

# A bare Mach-O binary has no bundle identity, and macOS's Window Server will
# not reliably create an NSStatusItem (the menu-bar icon pystray draws) for a
# process without one — it can silently fail to appear with no error anywhere
# the user would see. Wrapping the executable in a proper .app bundle is what
# macOS/AppKit actually expect for anything that shows UI, tray icon included.
# Windows and Linux builds use this same spec but don't hit this constraint,
# so BUNDLE only runs when freezing on macOS.
if sys.platform == "darwin":
    app = BUNDLE(
        exe,
        name="Aavishield.app",
        bundle_identifier="com.aavishield.agent",
        info_plist={
            "CFBundleName": "Aavishield",
            "CFBundleDisplayName": "Aavishield",
            "CFBundleShortVersionString": os.environ.get("AAVISHIELD_VERSION", "1.0.0"),
            # Menu-bar agent, not a Dock app: no Dock icon, no Cmd-Tab entry.
            "LSUIElement": True,
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
        },
    )

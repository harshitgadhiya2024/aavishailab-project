# Windows test checklist

Every bug we fix and every feature we change goes into this list, so all of
it can be tested together on a real Windows device. Until now, nothing in
the agent has been tested on real Windows hardware (see
[platform-verification.md](platform-verification.md)).

**How to use it:** test each entry on a real Windows 10/11 desktop with
Edge and Chrome, then tick it off and note the date, the Windows version
and what you saw. If an entry fails, keep it unticked and write what
happened under it.

**Adding to it:** every fix gets an entry here in the same PR. If a fix
doesn't touch Windows behaviour (for example, a macOS-only probe), say so
in one line so nobody spends time testing it.

---

## Versions right now

| Platform | Published | Notes |
|---|---|---|
| Windows | **2.9.5** | Not rebuilt on purpose (eSigner signatures are limited each month) |
| macOS | 2.9.6 | |
| Linux | 2.9.6 | |

Entries marked **Needs Windows ≥ 2.9.6** are agent changes, so they reach
Windows only after a Windows build is released: superadmin → Agent Versions
→ Trigger new build → Windows, or the "Agent — Windows" workflow. Server-side
entries already apply to Windows devices running 2.9.5.

---

## Fixes to test

### 1. Downloads looked like links that never opened
- [ ] Tested on Windows — date / Windows version / result:

**Needs Windows ≥ 2.9.6** · fixed 2026-10-28 · PR #13

**Problem:** the agent read every file into memory before the browser got
its first byte. A 250 MB installer showed nothing for minutes and often
timed out. Only the first 20 MB of any file was ever scanned for malware.

**Now:** a download starts immediately and streams. The whole file is
scanned, however big (up to 4 GB). The last chunk is held back until the
verdict arrives, so a malicious file never finishes downloading.

**Test on Windows:**
1. Download the installer from https://interviewsidekick.com/download
   (about 250 MB) in Edge, then in Chrome. **Expected:** progress starts
   within a few seconds and shows the total size; the file completes and
   opens.
2. Download https://secure.eicar.org/eicar.com (a harmless antivirus test
   file). **Expected:** the download fails in the browser, a Windows
   notification says "Download blocked", and the company dashboard shows a
   malware-blocked event for this device.
3. Download a ~10–50 MB zip that is unlikely to have been scanned before.
   **Expected:** it streams, pauses briefly at the very end, completes, and
   extracts without errors.
4. Download a VPN installer, for example the ProtonVPN or NordVPN `.exe`.
   **Expected:** blocked straight away with the block page, even though the
   file is large (large VPN installers used to slip through).
5. During and after the downloads, check `%TEMP%\aavishield-downloads`.
   **Expected:** files appear only while a download is being scanned and
   are deleted afterwards.

**Windows-specific risk:** the notification uses a PowerShell toast, which
has never run on real Windows. Check that a file name containing quotes or
`&` still shows a notification and doesn't throw an error.

### 1b. App traffic was treated as downloads (regression in 2.9.6)
- [ ] Tested on Windows — date / Windows version / result:

**Test it together with fix 1, on the first Windows build that includes
fix 1** · fixed 2026-10-28 · PR #16 · Windows 2.9.5 never had this bug

**Problem:** 2.9.6 scanned apps' background API calls as if they were
downloads: Cursor (`api2.cursor.sh`), Chrome Safe Browsing and
Optimization Guide. It held each response until a verdict came back, so
Cursor stalled and errored. The dashboard filled with "Download not
scanned" for traffic nobody downloaded.

**Now:** only real downloads are held and scanned. That means a response
with an `attachment` header, or a GET with a file extension or a file
content type. A bare binary response counts only when the browser
navigated to it, which is what happens when you click a download link.

**Test on Windows:**
1. Use Cursor (or VS Code with Copilot), Teams and Chrome normally for 30
   minutes. **Expected:** no stalls or errors in those apps, and no
   "Download not scanned" rows for their API hosts in Activity →
   Downloads.
2. Repeat fix 1, steps 1–2. **Expected:** real downloads are still
   scanned, and EICAR is still blocked.

### 2. Malware verdicts shared across devices (hash reputation)
- [ ] Tested on Windows — date / Windows version / result:

**Server-side, but the agent half needs Windows ≥ 2.9.6** · fixed 2026-10-28 · PR #13

**Now:** once any device has had a file scanned, every other device gets
the verdict instantly from the file's SHA-256 hash, without uploading the
file again.

**Test on Windows:** download the same file used in fix 1, step 3, again.
**Expected:** no pause at the end this time.

### 3. Each platform is released on its own
- [ ] Tested on Windows — date / Windows version / result:

**Server-side and CI** · fixed 2026-10-28 · PR #14

**Problem:** every release rebuilt and re-signed all three platforms. A
Windows release also changed the version that Macs saw.

**Now:**
- There are separate workflows: Agent — macOS, Agent — Windows, Agent — Linux.
- The server keeps a version per platform and offers each device only the
  release for its own OS.

**Test on Windows:**
1. In the employee portal on the Windows device, the download page offers
   the Windows `.msi` with **Windows'** version (2.9.5 today), not the
   macOS one.
2. With a Windows device enrolled on 2.9.5, the portal and dashboard must
   **not** say "update available" while Windows is still on 2.9.5, even
   though macOS and Linux are on 2.9.6.
3. After the next Windows release, the same device **does** show "update
   available".

### 4. Installer renamed: `aavishield-agent-<version>.msi`
- [ ] Tested on Windows — date / Windows version / result:

**Needs the next Windows build** · changed 2026-10-28 · PR #14

**Now:** the next Windows build is named `aavishield-agent-<version>.msi`,
without "rust". The MSI identity (UpgradeCode) is unchanged.

**Test on Windows:** with 2.9.5 (`aavishield-agent-rust-2.9.5.msi`)
installed, run the new `.msi`. **Expected:**
- it upgrades in place;
- Settings → Apps shows a single "Aavishield" entry with the new version;
- the device stays enrolled;
- the tray icon comes back.

### 5. "Could not determine" in Device security check (macOS)
- [x] Nothing to test on Windows. These were macOS-only probes (fixed
  2026-10-28, PR #12, verified on macOS 26). Windows has its own gap; see
  gap A below.

### 6. Mac auto-update
- [x] Nothing to test on Windows. This is macOS-only (PR #12, verified
  2.9.4 → 2.9.5 → 2.9.6 on a real Mac). Windows has no auto-update; see
  gap B below.

### Earlier fixes (2026-09-29 → 09-30)
- [ ] Run the full Windows checklist in [platform-verification.md](platform-verification.md#windows--not-yet-tested):
  - Web Gateway;
  - DLP with Teams, Gmail and Outlook (desktop and web);
  - Application Control;
  - VPN Control;
  - a browser that was already open before install.

  The 16 fixes behind it are listed in [bug-fixes.md](bug-fixes.md). All
  were verified on macOS only.

---

## Known Windows gaps (not built yet)

These are missing on Windows and are not bugs in a fix, so testing them
will just confirm the gap. Each needs its own change and a Windows release.

- **A. Device posture is mostly unknown.** On Windows, only the firewall
  check is implemented. Disk encryption (BitLocker), OS up to date, screen
  lock and antivirus (Defender) are always reported as "could not
  determine", which costs the device about half the weight of those
  checks.
- **B. No auto-update.** Windows devices stay on the version that was
  installed until someone installs a new `.msi` manually. Self-update on
  Windows would need an msiexec step that runs elevated.
- **C. The `.msi` has never been click-tested** on a real Windows desktop:
  install, enrollment from the portal, tray, and uninstall.

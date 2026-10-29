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
| Windows | **2.9.5** | 2.9.8 is the first build with fix 7 below |
| macOS | 2.9.7 | |
| Linux | 2.9.7 | |

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

### 7. Windows end-to-end pass: nothing worked without manual steps
**Needs Windows ≥ 2.9.8**, plus admin-api and employee-portal deployed · found and fixed 2026-10-29 on a Windows 11 25H2 ARM64 VM (x64 build under emulation)

Tested 2.9.5 on Windows for the first time. Before these fixes, an employee
could not protect a Windows PC alone:

| # | What was broken | What changed | Tested in the VM (unsigned local 2.9.7) |
|---|---|---|---|
| a | The agent needed `VCRUNTIME140.dll`. On a PC without the Visual C++ runtime it exited before `main()` (0xC0000135): no window, no error. | The C runtime is linked statically (`services/endpoint-agent/.cargo/config.toml`). | The exe no longer imports VCRUNTIME (llvm-objdump) |
| b | Connect opened the browser through `cmd /C start`, which cut the URL at `&`. The portal never got the callback, so enrollment could never finish. | The URL opens through ShellExecute. | Full URL opened ✅ |
| c | The installer never started the agent. It ran only at the next sign-in, and never again after a crash or Disconnect. | A new **Aavishield service** (LocalSystem) starts the agent in every signed-in session within seconds and restarts it if it stops. It replaces the Run key. | ✅ |
| d | The org's SSL-inspection CA was never trusted on Windows. HTTPS was a blind tunnel: no DLP, no download scanning, no block page. | The service fetches the org CA itself from the built-in admin API (with the device's credentials) and adds it to LocalMachine\Root. Uninstall or a change of org removes it. | CA trusted about 1s after start; DLP, malware block and HTTPS block page all work ✅ |
| e | A black console window opened beside the agent, and closing it killed protection. | The agent is a windowed app and logs to `%USERPROFILE%\.aavishield\agent.log`. | ✅ |
| f | First launch showed "Not connected" until someone clicked Connect, although the portal says the browser opens on its own. | First launch after install goes straight into Connect. | ✅ |
| g | Chrome asked "employee.aavishield.com wants to access other apps and services on this device". | The portal submits the token as a form, a top-level navigation, instead of `fetch()` (needs the portal deploy). Older agents keep the old path. | Prompt gone once portal deployed |
| h | No auto-update on Windows. | The service checks hourly. A new release must match the SHA-256, carry the same Authenticode publisher as the installed build, and contain the advertised version. It then installs with `msiexec /qn`. A failed package is never retried. | Needs two signed releases |
| i | The installer was a 32-bit package: `Program Files (x86)`, a WOW6432Node Run key, and the folder writable by all Users. | x64 package in `Program Files`, writable only by administrators (the service runs it as SYSTEM). `ProgramData\Aavishield` is SYSTEM/Administrators-only, readable by Users. | Upgrade 2.9.5 → 2.9.7 left one entry, removed the x86 folder and Run key ✅ |
| j | Uninstall left the proxy pointing at the dead agent, so the PC had no internet. | Uninstall resets the proxy for every user (signed in or not), removes the CA, deletes per-user state and reports the removal. | All verified, and a `device_disconnect` event arrived ✅ |
| k | "Uninstall the connector", after an admin authorised it, only opened the download page. | It runs `msiexec /x` with a UAC prompt. | — |
| l | App control listed processes with PowerShell every 5s, and blocked apps took 8–9s to close. | Native process list plus the 300 ms launch guard that macOS and Linux already had. | Blocked app closed in 0.24–0.32s ✅ |
| m | Toast notifications never appeared: the app id was not registered. File names were pasted into PowerShell code, so a crafted download name could inject commands. | A registered `Aavishield.Agent` id; the text passes through environment variables. | "Download blocked" toast with the Aavishield name and icon ✅ |
| n | Posture: only the firewall was checked. | BitLocker, Windows Update (≤30 days), screen lock (≤15 min), antivirus (Security Center) and firewall (all profiles), all as a standard user and cached for 10 min. | — |
| o | `os_version` was empty for every device, Macs included. | Heartbeats now store it (admin-api). Windows reports e.g. "Windows 11 Pro 25H2 (26300.7019)". | — |
| p | A zip containing EICAR got through. Windows Security quarantined the agent's temp copy, the read failed, and the agent allowed the file as "not scanned". | "Virus infected" (225/226) from Windows is treated as a block and reported (`&detected=`, logged per device, not cached as hash reputation). | — |

| q | **All platforms:** after 4 scanned downloads in 30 minutes, every further download went through unscanned. The per-device cap counted finished and abandoned scan jobs, which linger for 30 minutes (720 "Download not scanned" rows on Macs). | admin-api counts only jobs in flight (stalled uploads stop counting after 2 min). The agent waits and retries on 429 instead of allowing, and checks its local copy before asking the server. | 2.9.9 |
| r | A browser retrying a download Windows Security had removed got it on the third try. | A vanished temp copy counts as removed by antivirus, and a hash flagged once on the device is blocked at once afterwards. | 2.9.9 |
| s | `Stop-Service` reported that stopping the service failed (it stopped about 2s later). | StopPending is reported immediately. | 2.9.9 |

- [ ] Clean Windows 10/11 PC **without** the Visual C++ runtime: install the
  `.msi` from the portal. **Expected:** the agent window and a browser tab
  open on their own, and the device enrolls without any prompt from Chrome
  or Edge.
- [ ] Right after enrolling, open https://tinder.com (or any blocked site).
  **Expected:** the "Blocked by <company>" page. Upload a file with a card
  number to a webmail. **Expected:** a DLP incident.
- [ ] Download https://secure.eicar.org/eicar.com and eicar_com.zip.
  **Expected:** both blocked, plus a "Download blocked" notification.
- [ ] Kill `aavishield-agent.exe` in Task Manager. **Expected:** it is back
  within about 5 seconds.
- [ ] Publish a newer Windows version. **Expected:** within about an hour
  the device updates itself and stays enrolled, with no prompt.
- [ ] Uninstall from Settings → Apps. **Expected:** the internet still works,
  and certmgr.msc → Trusted Root has no "Aavishield SSL Inspection CA".

**Known limitation:** `curl.exe` (schannel) refuses inspected HTTPS unless
given `--ssl-no-revoke`. Our leaf certificates have no CRL distribution
point, and schannel's revocation check fails hard without one. Browsers,
Teams and .NET apps are not affected. The fix is a CRL endpoint in admin-api
plus a CDP in `mitm.IssueLeafCert`. That changes the certificates every Mac
receives too, so it is left for a separate, Mac-tested change.

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

## Known Windows gaps

Gaps A (posture), B (auto-update) and C (the `.msi` never tested) are
closed by fix 7 above. What is left:

- **Fast user switching / Remote Desktop with several people signed in at
  once:** each session's agent wants port 6118, so only the first one
  protects its user.
- **The `.msi` is x64.** On Windows on ARM it runs under emulation, which
  works (this is how it was tested). A native ARM64 build would be lighter.

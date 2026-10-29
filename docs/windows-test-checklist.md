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
| Windows | **2.9.9** | 2.9.8 is the first build with fix 7; 2.9.9 adds rows q–s |
| macOS | 2.9.9 | 2.9.8: fix 8 (verified on this Mac) · 2.9.9: fix 9 + OS roots |
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
- [x] Tested on Windows — 2026-10-29 / Windows 11 Pro 26H2 ARM64 (VM): the portal offered the Windows .msi with the Windows version (2.9.5, then 2.9.8) while macOS was 2.9.7; a 2.9.5 device was not offered an update.

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
- [x] Tested on Windows — 2026-10-29 / Windows 11 Pro 26H2 ARM64 (VM): 2.9.5 (`-rust-` name) upgraded in place to 2.9.7/2.9.8. One "Aavishield Agent" entry, still enrolled, agent restarted by the service.

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

- [ ] (Partly, 2026-10-29 / Windows 11 Pro 26H2 ARM64 (VM): install → browser → enrolled with no prompt, in 24s. The VM has the VC++ runtime from the first test; the exe was shown not to import VCRUNTIME. Still worth one run on a truly clean PC.) Clean Windows 10/11 PC **without** the Visual C++ runtime: install the
  `.msi` from the portal. **Expected:** the agent window and a browser tab
  open on their own, and the device enrolls without any prompt from Chrome
  or Edge.
- [x] 2026-10-29 / Windows 11 Pro 26H2 ARM64 (VM): tinder.com, bumble.com and hinge.co showed "Blocked by Aavishailab"; a card/PAN CSV uploaded through Chrome was flagged as DLP within seconds. Right after enrolling, open https://tinder.com (or any blocked site).
  **Expected:** the "Blocked by <company>" page. Upload a file with a card
  number to a webmail. **Expected:** a DLP incident.
- [x] 2026-10-29 / Windows 11 Pro 26H2 ARM64 (VM): eicar.com was blocked (0 bytes, known-bad-hash) with a toast; eicar_com.zip was blocked as "Blocked by Windows Security" from 2.9.9. Download https://secure.eicar.org/eicar.com and eicar_com.zip.
  **Expected:** both blocked, plus a "Download blocked" notification.
- [x] 2026-10-29 / Windows 11 Pro 26H2 ARM64 (VM): back in 2s; after a reboot the service started it at sign-in. Kill `aavishield-agent.exe` in Task Manager. **Expected:** it is back
  within about 5 seconds.
- [x] 2026-10-29 / Windows 11 Pro 26H2 ARM64 (VM): 2.9.8 → 2.9.9 and 2.9.9 → 2.9.10 installed themselves (download, signature and version check, msiexec) and stayed enrolled. Publish a newer Windows version. **Expected:** within about an hour
  the device updates itself and stays enrolled, with no prompt.
- [x] 2026-10-29 / Windows 11 Pro 26H2 ARM64 (VM): proxy reset, CA, service, files and per-user state removed, device_disconnect reported. Uninstall from Settings → Apps. **Expected:** the internet still works,
  and certmgr.msc → Trusted Root has no "Aavishield SSL Inspection CA".

**Known limitation:** `curl.exe` (schannel) refuses inspected HTTPS unless
given `--ssl-no-revoke`. Our leaf certificates have no CRL distribution
point, and schannel's revocation check fails hard without one. Browsers,
Teams and .NET apps are not affected. The fix is a CRL endpoint in admin-api
plus a CDP in `mitm.IssueLeafCert`. That changes the certificates every Mac
receives too, so it is left for a separate, Mac-tested change.

### 8. SSL inspection broke sign-ins and apps (all platforms)
**Server part applies now; agent part needs Windows ≥ 2.9.10 (and the next macOS release)** · fixed 2026-10-29

**Problem:** with the agent connected, logins in apps failed (Outlook for Mac
with a Microsoft 365 account, the Parallels account setup) until the agent
was disconnected. SSL inspection itself got in the way:
- apps that pin certificates or use their own CA list rejected ours, every time;
- WebSockets were never relayed through an inspected connection;
- servers needing a client certificate (mTLS device sign-in), or an HTTP/2-only client, could not be reached;
- the bypass list covered only two Microsoft sign-in hosts.

**Now (the same principle as Zscaler/Cisco: inspection must never break traffic, DLP only logs):**
- **Universal auto-bypass (agent):** if a client refuses our certificate (TLS
  alert or no common protocol), closes inspected connections without using
  them twice in 2 minutes, or the real server cannot be reached through
  inspection (mTLS, private CA, HTTP/2 only), that host is passed through
  untouched for 24 hours. The app's next attempt works. This uses no app
  list; browsers trust the CA, so their traffic stays inspected.
- **WebSockets** are relayed through inspected connections.
- **Bypass list (admin-api)** now includes Microsoft/Apple/Google/Okta/Duo/
  Auth0/OneLogin/Ping sign-in and device-identity hosts, Office licensing,
  Windows SmartScreen/Defender, Parallels and Zoom. Content hosts (Outlook
  web, OneDrive, SharePoint, Gmail, Drive) stay inspected for DLP.
- **QUIC (UDP 443) is blocked on Windows** by the service's firewall rule,
  so HTTP/3 falls back to TCP. Measured: with the proxy set, Chrome already
  sent 31 connections through the agent, none direct to :443, and opened no
  QUIC socket.

Verified in the VM: a certificate-pinning client (`curl --pinnedpubkey`)
failed 3 times, then the agent passed the host through and it got 200 (the
limit is now 2). A WebSocket echo worked through an inspected host.
login.microsoftonline.com and login.live.com showed their real certificates.

- [ ] Mac, agent connected: sign in to Outlook for Mac with a Microsoft 365
  work account. **Expected:** it works.
- [ ] Parallels Desktop: sign in to the Parallels account. **Expected:** it works.
- [ ] Teams/Slack desktop chat stays live (WebSocket) with the agent on. (A WebSocket echo through an inspected host was verified on Windows 2.9.10 and macOS 2.9.8; 2.9.7 failed it.)

### 9. SSL inspection learns which platforms to leave alone
**Server: on deploy. Agent reporting: Windows ≥ 2.9.11, macOS ≥ 2.9.9** · added 2026-10-29

When an app refuses inspection, the device passes that host through for a
day (fix 8) and now also reports it (`POST /internal/agent/mitm-refusal`).
admin-api then decides for the whole company:

- **A platform where data can leave** (mail, file sharing, cloud storage,
  chat/collaboration, AI tools, code and paste hosting, social media): never
  bypassed automatically. Admins get an "DLP blind spot" activity event; the
  device itself still works.
- **Anything else:** the whole platform (the registrable domain, e.g.
  `parallels.com`) joins every device's bypass list. That happens right away
  for a categorised platform; an uncategorised one needs reports from two
  devices (or two organisations), so one device can never switch
  inspection off for an unknown domain. An "SSL inspection bypassed
  automatically" event is logged. Entries expire 30 days after the last
  report.

Also in the same agent release: upstream verification trusts the
operating system's roots as well as Mozilla's. Before, servers behind a root
only the OS trusts could not be inspected: Windows Update delivery
optimisation (`*.do.dsp.mp.microsoft.com`), telemetry, and any company
intranet on a private CA. In the VM, fix 8's auto-bypass had to step in for
six such hosts in 40 minutes. They are now inspected and answer 200.

- [ ] Use a pinned app on two devices. **Expected:** the second device's
  next start never sees the failure, and the dashboard shows the event.
- [ ] A Slack/Teams/Drive host reported. **Expected:** not bypassed for
  everyone, and a "DLP blind spot" event appears.

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

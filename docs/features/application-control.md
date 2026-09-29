# Application Control

Blocks named desktop applications outright — the agent watches running
processes and kills a blocked app the moment it launches (or within one
sweep if it was already running), on macOS, Windows and Linux.

## How matching works

admin-api sends the agent a flat list of matchers per app: process names,
bundle IDs (macOS), and install-path patterns. The agent lists processes
(`ps` on macOS/Linux, `Get-CimInstance Win32_Process` on Windows), matches
each against the list, and if it's a block, freezes the process
(`SIGSTOP`), finds every other process in the same app bundle and its
descendants, and kills the whole family — not just the one matched
process — so helper/renderer processes don't survive.

Two layers run this: a periodic sweep (catches anything already running),
and a launch-guard thread that watches for new processes appearing in
near-real-time, so a blocked app that was already open when the rule
was created gets closed within the sweep interval, and one launched
afterward is caught almost immediately.

## Apps added from the installed-software inventory

An app doesn't have to be in the built-in catalog to be blocked: if it's
seen running on a device, it's auto-added to the org's application list
(source `inventory`) from its install path/bundle ID alone — it has no
process-name matcher, only a bundle ID and path pattern, because that's all
that's known about it.

## Bugs fixed this cycle

See [../bug-fixes.md](../bug-fixes.md). Summary:

1. **One inventory app froze every later block.** An inventory-sourced app
   (no process names) had the server send `"process_names": null`. The
   agent read that field as a required list; a null failed the whole
   rules response, and the watcher silently kept whatever rules it last
   parsed — so every app blocked after that one was never enforced on the
   device, even ones with normal process-name matchers. Fixed on both
   sides: the server always sends `[]` instead of `null` (this alone fixes
   every already-installed agent, no update needed), and the agent now
   also reads a null list as empty and warns instead of staying silent if
   parsing ever fails again.
2. **One laptop re-enrolled for a new employee created a second device
   row.** The agent sends no stable hardware identity at enrollment before
   this fix, so re-enrolling matched on hostname + employee, missed, and
   created a duplicate device. The original device kept all its installed-
   app history; every app showed twice in the list, and a control toggled
   on the new (empty) device row targeted an employee who no longer used
   the machine — the block set in the UI never reached the actual agent.
   Fixed by sending a hashed hardware identity (macOS IOPlatformUUID,
   Windows MachineGuid, Linux `/etc/machine-id`) at enrollment; the server
   matches on it first, so a reinstall reuses the same device and its
   software moves to the new employee. The app list also now only shows
   software from devices that still exist and belong to a current
   employee, so a genuinely stale device (pre-dating this fix) doesn't
   show duplicate rows either.

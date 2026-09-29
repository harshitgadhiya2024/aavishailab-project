//! Application control — blocking software, not just its websites.
//!
//! Blocking a domain stops the browser, but an app that is already installed
//! keeps launching and keeps talking to whichever backend host nobody thought
//! to add to a policy. The network half of that is solved by shipping each
//! controlled app's whole domain bundle in the normal rule feed; this is the
//! other half — a process matching a controlled application is stopped on
//! sight, together with everything else that belongs to the same
//! application, reported, and **the person is told why**.
//!
//! That last part matters: an app that simply vanishes is indistinguishable
//! from a crash. A desktop notification naming the app and the reason is the
//! difference between "IT blocked this, ask them" and "my laptop is broken".
//! It names only the application that was actually stopped, and fires once
//! per launch attempt — not once per helper process that application happens
//! to run.
//!
//! Nothing here is specific to any one application. Whatever the org's rules
//! name — a built-in catalog entry, an app the company defined itself, or one
//! blocked straight from the installed-software inventory — reaches this
//! module as the same `Matcher` (process names, bundle ids, install paths),
//! and every path below treats every matcher identically.
//!
//! Three things find a blocked process, fastest first:
//!
//! 1. **The launch guard** (macOS and Linux): a dedicated thread that asks the
//!    kernel for the PID list every `GUARD_INTERVAL` and looks only at PIDs
//!    it has not seen before. That is a syscall and a set difference, no
//!    subprocess, so it can run this often at no measurable cost — and a
//!    GUI application typically takes longer than that to put its first
//!    window on screen, so a blocked app is normally stopped before the
//!    person ever sees it open.
//! 2. **The sweep**: every `interval` (5s), every running process is checked.
//!    This is what catches an app that was *already running* when an admin
//!    blocked it — no new PID, so the guard never sees it — and it re-reads
//!    the rules on the same tick, so a rule change reaches a running app
//!    within one interval.
//! 3. On Windows, the sweep is the only path; see `list_processes`.
//!
//! Stopping is `SIGSTOP` first, then `SIGKILL`: the matched process is frozen
//! the instant it is found, so it can do nothing further — draw a window,
//! send a message, spawn a child — while the rest of the application is
//! identified (everything inside the same `.app` bundle, plus every
//! descendant process) and killed with it.
//!
//! Honest scope, so nobody mistakes this for more than it is: userland,
//! identified by the executable's path. The process does exist, briefly,
//! before it is frozen; renaming the executable defeats the name match (the
//! bundle-id and path matchers are harder to dodge, not impossible); and an
//! app launched through an interpreter is invisible here, because the OS
//! reports the interpreter as the executable. Refusing the exec itself needs
//! OS-level enforcement — macOS Endpoint Security, Windows WDAC/AppLocker —
//! which requires signed system extensions and MDM. What is here is what can
//! be done on an unmanaged laptop, and the network block behind it is what
//! makes the app pointless even in the moments it does exist.

use crate::enforcement::EnforcementGate;
use crate::http_client::AgentClient;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Floor on the server-supplied sweep interval, and the value used until the
/// server first answers. Every sweep also re-reads the rules — the endpoint
/// has no cache in front of it, so a rule an admin just added reaches an app
/// that is already running within one of these.
const MIN_INTERVAL: Duration = Duration::from_secs(5);
const DEFAULT_INTERVAL: Duration = Duration::from_secs(5);

/// How often the launch guard looks for new PIDs. Short enough to beat a
/// typical application's first window; each pass is one syscall.
#[cfg(any(target_os = "macos", target_os = "linux"))]
const GUARD_INTERVAL: Duration = Duration::from_millis(300);

/// A PID the guard has just seen is looked at again for this many passes:
/// a process that forks and then execs keeps its PID but changes its
/// executable, so the path seen on the first pass may not be the final one.
#[cfg(any(target_os = "macos", target_os = "linux"))]
const GUARD_RECHECK_PASSES: u8 = 3;

/// One notification per application per this long. The guard and the sweep
/// can both see the same launch, and an application is often several
/// processes; the person needs to be told once, not once per detection.
const NOTIFY_COOLDOWN: Duration = Duration::from_secs(10);

/// One controlled application, flattened by the server into just what this
/// watcher needs to recognise and act on a process.
#[derive(Debug, Clone, Deserialize)]
pub struct Matcher {
    #[serde(default)]
    pub app_id: String,
    #[serde(default)]
    pub name: String,
    /// `block` terminates; `alert` only reports.
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub process_names: Vec<String>,
    #[serde(default)]
    pub bundle_ids: Vec<String>,
    #[serde(default)]
    pub path_patterns: Vec<String>,
}

impl Matcher {
    fn blocks(&self) -> bool {
        self.action != "alert"
    }
}

#[derive(Debug, Deserialize)]
struct AppControlResponse {
    #[serde(default)]
    applications: Vec<Matcher>,
    #[serde(default)]
    poll_interval_sec: u64,
}

#[derive(Serialize)]
struct BlockReport<'a> {
    app_id: &'a str,
    app_name: &'a str,
    process_name: &'a str,
    pid: i32,
    path: &'a str,
    action: &'a str,
    terminated: bool,
}

/// One running process.
#[derive(Debug, Clone, PartialEq)]
struct Proc {
    pid: i32,
    ppid: i32,
    path: String,
}

pub struct AppControlWatcher {
    client: AgentClient,
    gate: Arc<EnforcementGate>,
    /// Captured in `new()`, which only ever runs inside the background
    /// runtime. The launch guard is a plain OS thread, not a tokio one, and
    /// hands its reporting back to the runtime through this: the bare
    /// `tokio::spawn` looks for a runtime in the calling thread's context
    /// and panics when there isn't one.
    runtime: tokio::runtime::Handle,
    matchers: tokio::sync::RwLock<Vec<Matcher>>,
    interval: tokio::sync::RwLock<Duration>,
    /// PIDs already handled, so one process is reported once however many
    /// paths see it. Pruned to live PIDs every sweep, so the same app
    /// relaunching under a new PID is reported again — which is the signal
    /// we actually want. A std mutex: never held across an await, and the
    /// launch guard (not a tokio thread) needs it too.
    reported: Mutex<HashMap<i32, String>>,
    /// When each application last produced a notification.
    notified: Mutex<HashMap<String, Instant>>,
}

impl AppControlWatcher {
    pub fn new(client: AgentClient, gate: Arc<EnforcementGate>) -> Self {
        Self {
            client,
            gate,
            runtime: tokio::runtime::Handle::current(),
            matchers: tokio::sync::RwLock::new(Vec::new()),
            interval: tokio::sync::RwLock::new(DEFAULT_INTERVAL),
            reported: Mutex::new(HashMap::new()),
            notified: Mutex::new(HashMap::new()),
        }
    }

    pub async fn run(self: Arc<Self>) {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let guard = Arc::clone(&self);
            if let Err(e) = std::thread::Builder::new()
                .name("aavishield-app-guard".to_string())
                .spawn(move || guard.guard_new_processes())
            {
                tracing::warn!(error = %e, "application launch guard could not start — blocked apps are still caught by the regular sweep");
            }
        }

        loop {
            self.refresh().await;
            if !self.matchers.read().await.is_empty() {
                self.sweep().await;
            }
            let interval = *self.interval.read().await;
            tokio::time::sleep(interval).await;
        }
    }

    async fn refresh(&self) {
        let resp = match self.client.get("/internal/agent/app-control").await {
            Ok(r) if r.status().is_success() => r,
            Ok(_) | Err(_) => return,
        };
        let body: AppControlResponse = match resp.json().await {
            Ok(b) => b,
            Err(e) => {
                tracing::debug!(error = %e, "app-control refresh returned an unparseable body");
                return;
            }
        };

        *self.interval.write().await = Duration::from_secs(body.poll_interval_sec).max(MIN_INTERVAL);

        let mut matchers = self.matchers.write().await;
        let before: HashSet<&str> = matchers.iter().map(|m| m.app_id.as_str()).collect();
        let changed = before != body.applications.iter().map(|m| m.app_id.as_str()).collect();
        *matchers = body.applications;
        if changed {
            let names: Vec<&str> = matchers.iter().map(|m| m.name.as_str()).collect();
            tracing::info!(applications = matchers.len(), ?names, "application control rules updated");
        }
    }

    async fn sweep(&self) {
        // Terminating somebody's applications on their own laptop in their own
        // time is exactly what a working-hours schedule exists to prevent.
        if !self.gate.enforces_app_control() {
            return;
        }
        let matchers = self.matchers.read().await.clone();
        if matchers.is_empty() {
            return;
        }

        // Listing and matching both block (a subprocess; a bundle-id read on
        // a cache miss), so neither runs on a runtime worker.
        let (alive, hits) = tokio::task::spawn_blocking(move || {
            let own_pid = std::process::id() as i32;
            let processes = list_processes();
            let alive: HashSet<i32> = processes.iter().map(|p| p.pid).collect();
            let hits: Vec<(Matcher, Proc)> = processes
                .into_iter()
                .filter(|p| p.pid != own_pid)
                .filter_map(|p| matchers.iter().find(|m| matches(m, &p.path)).map(|m| (m.clone(), p)))
                .collect();
            (alive, hits)
        })
        .await
        .unwrap_or_default();

        for (matcher, proc) in hits {
            // A sibling or child the first hit already took down with it.
            if !is_alive(proc.pid) || !self.claim(proc.pid, &matcher.app_id) {
                continue;
            }
            let stopped = if matcher.blocks() {
                let path = proc.path.clone();
                tokio::task::spawn_blocking(move || stop_application(proc.pid, &path))
                    .await
                    .unwrap_or_default()
            } else {
                Stopped::default()
            };
            self.claim_all(&stopped.related, &matcher.app_id);
            self.finish(&matcher, proc.pid, &proc.path, &stopped).await;
        }

        // Forget PIDs that are gone, so a relaunch is reported.
        self.reported.lock().unwrap().retain(|pid, _| alive.contains(pid));
    }

    /// The launch guard's loop. Runs on its own OS thread for the life of
    /// the process: everything in the pass is synchronous, and the kill in
    /// particular happens right here rather than after a hop through the
    /// runtime, so nothing stands between noticing a blocked process and
    /// freezing it. Only reporting and notifying — which talk to the server
    /// and the desktop and can wait — are handed back to the runtime.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn guard_new_processes(self: Arc<Self>) {
        let own_pid = std::process::id() as i32;
        let mut known: HashSet<i32> = HashSet::new();
        // PID -> (path last seen, passes left to look again).
        let mut recent: HashMap<i32, (String, u8)> = HashMap::new();

        loop {
            std::thread::sleep(GUARD_INTERVAL);

            let current: HashSet<i32> = native::all_pids().into_iter().collect();
            if current.is_empty() {
                continue;
            }
            // The first pass only learns what was already running; the
            // sweep, which runs as the watcher starts, is what deals with
            // those.
            let first_pass = known.is_empty();
            let fresh: Vec<i32> = current.iter().copied().filter(|p| !known.contains(p)).collect();
            known = current;
            recent.retain(|pid, _| known.contains(pid));
            if first_pass {
                continue;
            }

            let mut candidates: Vec<(i32, String)> = Vec::new();
            for pid in fresh {
                if pid <= 1 || pid == own_pid {
                    continue;
                }
                if let Some(path) = native::pid_path(pid) {
                    recent.insert(pid, (path.clone(), GUARD_RECHECK_PASSES));
                    candidates.push((pid, path));
                }
            }
            for (pid, (seen, left)) in recent.iter_mut() {
                if *left == GUARD_RECHECK_PASSES {
                    *left -= 1; // just added above
                    continue;
                }
                *left = left.saturating_sub(1);
                if let Some(path) = native::pid_path(*pid) {
                    if &path != seen {
                        *seen = path.clone();
                        candidates.push((*pid, path));
                    }
                }
            }
            recent.retain(|_, (_, left)| *left > 0);

            if candidates.is_empty() || !self.gate.enforces_app_control() {
                continue;
            }
            let matchers = self.matchers.blocking_read().clone();
            if matchers.is_empty() {
                continue;
            }

            for (pid, path) in candidates {
                let Some(matcher) = matchers.iter().find(|m| matches(m, &path)) else {
                    continue;
                };
                if !self.claim(pid, &matcher.app_id) {
                    continue;
                }
                recent.remove(&pid);
                let stopped = if matcher.blocks() { stop_application(pid, &path) } else { Stopped::default() };
                self.claim_all(&stopped.related, &matcher.app_id);

                let watcher = Arc::clone(&self);
                let matcher = matcher.clone();
                self.runtime.spawn(async move {
                    watcher.finish(&matcher, pid, &path, &stopped).await;
                });
            }
        }
    }

    /// Marks `pid` as handled for `app_id`. False if something already did.
    fn claim(&self, pid: i32, app_id: &str) -> bool {
        let mut reported = self.reported.lock().unwrap();
        if reported.get(&pid).map(String::as_str) == Some(app_id) {
            return false;
        }
        reported.insert(pid, app_id.to_string());
        true
    }

    /// Marks the rest of an application's processes as handled, so the
    /// sweep that listed them a moment before they died doesn't report each
    /// of them as a separate detection.
    fn claim_all(&self, pids: &[i32], app_id: &str) {
        let mut reported = self.reported.lock().unwrap();
        for pid in pids {
            reported.insert(*pid, app_id.to_string());
        }
    }

    /// Reports one stopped (or, for an `alert` rule, observed) application
    /// and tells the person, when that is warranted.
    async fn finish(&self, matcher: &Matcher, pid: i32, exe_path: &str, stopped: &Stopped) {
        let exe_name = exe_path.rsplit(['/', '\\']).next().unwrap_or("").to_string();
        self.report(matcher, pid, &exe_name, exe_path, stopped.terminated).await;

        // Told, not just stopped — see the module docs. Only when what was
        // stopped included the application's own main executable, whichever
        // of its processes happened to be matched first: a background helper
        // or extension the OS restarts on its own, with the app itself not
        // running, is not something the person tried to open, and a
        // notification for it would name an app they aren't using.
        if stopped.stopped_main && self.should_notify(&matcher.app_id) {
            notify_blocked(&matcher.name).await;
        }
        tracing::info!(
            app = %matcher.name, pid, related = stopped.related.len(), main = stopped.stopped_main,
            outcome = if stopped.terminated { "blocked" } else { "detected" },
            "application control"
        );
    }

    fn should_notify(&self, app_id: &str) -> bool {
        let mut notified = self.notified.lock().unwrap();
        let now = Instant::now();
        match notified.get(app_id) {
            Some(last) if now.duration_since(*last) < NOTIFY_COOLDOWN => false,
            _ => {
                notified.insert(app_id.to_string(), now);
                true
            }
        }
    }

    async fn report(&self, matcher: &Matcher, pid: i32, exe_name: &str, path: &str, terminated: bool) {
        let truncated: String = path.chars().take(500).collect();
        let body = BlockReport {
            app_id: &matcher.app_id,
            app_name: &matcher.name,
            process_name: exe_name,
            pid,
            path: &truncated,
            action: if terminated { "blocked" } else { "alerted" },
            terminated,
        };
        if let Err(e) = self.client.post_json("/internal/agent/app-block", &body).await {
            tracing::debug!(error = %e, "app-block report failed");
        }
    }
}

/// Stops a whole application, starting from one of its processes.
///
/// The matched process is frozen first, so from this instant it does
/// nothing more — and, frozen rather than dead, it keeps its children
/// attached to it while they are found. Then everything that belongs to the
/// same application is killed with it: every process inside the same `.app`
/// bundle (helpers, renderers, extensions) and every descendant of any of
/// those, wherever its binary lives.
///
fn stop_application(pid: i32, exe_path: &str) -> Stopped {
    freeze(pid);
    let processes = list_processes();
    let family = app_family(pid, exe_path, &processes);

    let terminated = terminate(pid);
    let mut stopped_main = terminated && is_primary_executable(exe_path);
    let mut related = Vec::new();
    for member in family.into_iter().filter(|p| *p != pid) {
        if terminate(member) {
            related.push(member);
            if let Some(p) = processes.iter().find(|p| p.pid == member) {
                stopped_main |= is_primary_executable(&p.path);
            }
        }
    }
    Stopped { terminated, related, stopped_main }
}

/// What `stop_application` did.
#[derive(Debug, Default)]
struct Stopped {
    /// The matched process itself died.
    terminated: bool,
    /// The rest of the application that died with it.
    related: Vec<i32>,
    /// Whether any of what died was the application's own main executable
    /// — i.e. the app the person sees, not only a background helper.
    stopped_main: bool,
}

/// Every PID that is part of the same application as `pid`: the process
/// itself, every process whose executable is inside the same `.app` bundle,
/// and every descendant of any of those. Never this agent, never launchd or
/// init.
fn app_family(pid: i32, exe_path: &str, processes: &[Proc]) -> Vec<i32> {
    let own_pid = std::process::id() as i32;
    let mut family: HashSet<i32> = HashSet::from([pid]);

    if let Some(root) = bundle_root(exe_path) {
        let prefix = format!("{root}/");
        family.extend(processes.iter().filter(|p| p.path.starts_with(&prefix)).map(|p| p.pid));
    }

    let mut children: HashMap<i32, Vec<i32>> = HashMap::new();
    for p in processes {
        children.entry(p.ppid).or_default().push(p.pid);
    }
    let mut pending: Vec<i32> = family.iter().copied().collect();
    while let Some(parent) = pending.pop() {
        // launchd/init would make every process on the machine a
        // "descendant"; neither can be in the family to begin with, but
        // never walk from them regardless.
        if parent <= 1 {
            continue;
        }
        for &child in children.get(&parent).map(Vec::as_slice).unwrap_or(&[]) {
            if family.insert(child) {
                pending.push(child);
            }
        }
    }

    let mut out: Vec<i32> = family.into_iter().filter(|p| *p > 1 && *p != own_pid).collect();
    out.sort_unstable();
    out
}

/// The outermost `.app` bundle an executable lives in, if any —
/// `/Applications/Slack.app` for both Slack itself and
/// `…/Slack.app/Contents/Frameworks/Slack Helper.app/…/Slack Helper`, which
/// is what makes a helper part of its parent application.
fn bundle_root(exe_path: &str) -> Option<&str> {
    exe_path.find(".app/").map(|idx| &exe_path[..idx + 4])
}

/// Whether this executable is an application's own main binary, rather than
/// a helper, extension, or embedded tool inside it. Anything not inside a
/// bundle counts as primary: there, the process *is* the application.
fn is_primary_executable(exe_path: &str) -> bool {
    match exe_path.find(".app/") {
        None => true,
        Some(idx) => {
            let inside = &exe_path[idx + 5..];
            inside
                .strip_prefix("Contents/MacOS/")
                .is_some_and(|name| !name.is_empty() && !name.contains('/'))
        }
    }
}

/// Does this executable belong to a controlled application?
///
/// Only the executable's own path is matched, never the command line. A
/// process whose arguments merely mention an app (a grep, an editor, a build
/// script) is not that app, and terminating it because of a string in argv
/// would be indefensible.
fn matches(matcher: &Matcher, exe_path: &str) -> bool {
    let path_lower = exe_path.to_lowercase();
    let exe_name = path_lower.rsplit(['/', '\\']).next().unwrap_or("");

    if matcher.process_names.iter().any(|n| n.trim().to_lowercase() == exe_name) {
        return true;
    }
    if matcher.path_patterns.iter().any(|p| path_pattern_matches(&path_lower, p)) {
        return true;
    }
    if !matcher.bundle_ids.is_empty() {
        if let Some(id) = bundle_identifier(exe_path) {
            let id = id.to_lowercase();
            if matcher.bundle_ids.iter().any(|b| b.trim().to_lowercase() == id) {
                return true;
            }
        }
    }
    false
}

/// A substring match — except for a pattern that names a bundle
/// (`/applications/foo.app`, which is what an app blocked from the
/// installed-software inventory carries), which has to match on the bundle
/// boundary: otherwise `/applications/foo.app` would also catch
/// `/applications/foo.application/…`, an unrelated app.
fn path_pattern_matches(path_lower: &str, pattern: &str) -> bool {
    let pattern = pattern.trim().to_lowercase();
    if pattern.is_empty() {
        return false;
    }
    if pattern.ends_with(".app") {
        return path_lower == pattern || path_lower.contains(&format!("{pattern}/"));
    }
    path_lower.contains(&pattern)
}

/// CFBundleIdentifier of the outermost `.app` a macOS executable lives in.
///
/// Returns None off macOS, and for any path not inside a bundle. Cached per
/// bundle: the sweep now runs every few seconds and the launch guard on
/// every new process, and a bundle's identifier never changes while it is
/// installed, so reading Info.plist again each time would be a subprocess per
/// process for nothing.
#[cfg(target_os = "macos")]
fn bundle_identifier(exe_path: &str) -> Option<String> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

    let bundle = bundle_root(exe_path)?;
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache.lock().unwrap().get(bundle) {
        return hit.clone();
    }

    let info = format!("{bundle}/Contents/Info.plist");
    let id = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier", &info])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|id| !id.is_empty());

    let mut cache = cache.lock().unwrap();
    if cache.len() > 4096 {
        cache.clear(); // bounded; a machine has nowhere near this many bundles
    }
    cache.insert(bundle.to_string(), id.clone());
    id
}

#[cfg(not(target_os = "macos"))]
fn bundle_identifier(_exe_path: &str) -> Option<String> {
    None
}

/// Every process this user can see, with its parent — the parent is what
/// lets `app_family` find an application's children.
fn list_processes() -> Vec<Proc> {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.ExecutablePath)\" }",
            ])
            .output();
        let Ok(out) = out else { return Vec::new() };
        if !out.status.success() {
            return Vec::new();
        }
        return String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let mut parts = line.trim().splitn(3, '|');
                let pid: i32 = parts.next()?.parse().ok()?;
                let ppid: i32 = parts.next()?.parse().ok()?;
                let path = parts.next()?.trim();
                if path.is_empty() { None } else { Some(Proc { pid, ppid, path: path.to_string() }) }
            })
            .collect();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let out = std::process::Command::new("ps").args(["-axo", "pid=,ppid=,comm="]).output();
        let Ok(out) = out else { return Vec::new() };
        if !out.status.success() {
            return Vec::new();
        }
        String::from_utf8_lossy(&out.stdout).lines().filter_map(parse_ps_line).collect()
    }
}

/// One line of `ps -axo pid=,ppid=,comm=`. The executable is the last field
/// and can itself contain spaces ("/Applications/Google Chrome.app/…/Google
/// Chrome"), so only the first two fields are split off and everything after
/// them is the path.
#[cfg(not(target_os = "windows"))]
fn parse_ps_line(line: &str) -> Option<Proc> {
    let (pid, rest) = line.trim_start().split_once(char::is_whitespace)?;
    let (ppid, path) = rest.trim_start().split_once(char::is_whitespace)?;
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    Some(Proc { pid: pid.parse().ok()?, ppid: ppid.parse().ok()?, path: path.to_string() })
}

/// Kernel-level process listing for the launch guard: no subprocess, so it
/// can run every few hundred milliseconds.
#[cfg(target_os = "macos")]
mod native {
    pub fn all_pids() -> Vec<i32> {
        // SAFETY: a null buffer with size 0 only asks for the count.
        let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if count <= 0 {
            return Vec::new();
        }
        // Headroom for processes started between the two calls.
        let capacity = count as usize + 256;
        let mut pids: Vec<libc::pid_t> = vec![0; capacity];
        let bytes = (capacity * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
        // SAFETY: `pids` is `capacity` pid_t's long and `bytes` says exactly
        // that; the kernel writes at most that many.
        let got = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
        if got <= 0 {
            return Vec::new();
        }
        pids.truncate((got as usize).min(capacity));
        pids.retain(|p| *p > 0);
        pids
    }

    pub fn pid_path(pid: i32) -> Option<String> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        // SAFETY: `buf` is exactly the length passed.
        let len = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        if len <= 0 {
            return None;
        }
        buf.truncate(len as usize);
        String::from_utf8(buf).ok()
    }
}

#[cfg(target_os = "linux")]
mod native {
    pub fn all_pids() -> Vec<i32> {
        std::fs::read_dir("/proc")
            .map(|dir| dir.filter_map(|e| e.ok()?.file_name().to_str()?.parse().ok()).collect())
            .unwrap_or_default()
    }

    pub fn pid_path(pid: i32) -> Option<String> {
        std::fs::read_link(format!("/proc/{pid}/exe")).ok()?.to_str().map(str::to_string)
    }
}

/// Stops a process from doing anything further, without killing it yet.
fn freeze(pid: i32) {
    #[cfg(unix)]
    // SAFETY: kill(2) with a positive pid; failure (already gone, not ours)
    // is harmless and the kill that follows reports it.
    unsafe {
        libc::kill(pid, libc::SIGSTOP);
    }
    #[cfg(not(unix))]
    let _ = pid;
}

fn is_alive(pid: i32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: signal 0 only checks that the process exists.
        unsafe { libc::kill(pid, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

/// Kills a process. Returns whether it actually died.
///
/// A process owned by another user (or root) can't be killed from here. That
/// is still reported — the dashboard shows it was seen and that it survived,
/// which is more useful than silence.
fn terminate(pid: i32) -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // SAFETY: kill(2) with a validated positive pid. A pid that has
        // already exited returns ESRCH, which is reported as "not
        // terminated" rather than being treated as an error.
        unsafe { libc::kill(pid, libc::SIGKILL) == 0 }
    }
}

/// Tells the person why an application just closed.
///
/// Best-effort and fire-and-forget: a laptop with no notification daemon, or
/// a locked screen, must never hold up or fail a sweep. Every platform path
/// below uses a tool the OS already ships, for the same reason the rest of
/// this crate does.
async fn notify_blocked(app_name: &str) {
    let safe: String = app_name.chars().filter(|c| !matches!(c, '"' | '\\' | '\'' | '\n' | '\r')).take(80).collect();
    notify(
        "Blocked by your company",
        &format!("{safe} is not allowed on this device. Contact your IT administrator if you need access."),
    )
    .await;
}

/// Shows a desktop notification, best-effort and fire-and-forget — a laptop
/// with no notification daemon, or a locked screen, must never hold up or
/// fail the caller. Every platform path uses a tool the OS already ships.
///
/// `title`/`body` are interpolated into an AppleScript/PowerShell literal, so
/// the caller must pass text with quotes, backslashes and newlines already
/// stripped (see `notify_blocked`); nothing here escapes per-language.
pub(crate) async fn notify(title: &str, body: &str) {
    let (title, body) = (title.to_string(), body.to_string());
    let _ = tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            let script = format!("display notification \"{body}\" with title \"{title}\"");
            let _ = std::process::Command::new("osascript").args(["-e", &script]).output();
        }
        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("notify-send").args([title.as_str(), body.as_str()]).output();
        }
        #[cfg(target_os = "windows")]
        {
            let script = format!(
                "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; \
                 $t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(2); \
                 $x=$t.GetElementsByTagName('text'); $x[0].AppendChild($t.CreateTextNode('{title}')) > $null; \
                 $x[1].AppendChild($t.CreateTextNode('{body}')) > $null; \
                 [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aavishield').Show([Windows.UI.Notifications.ToastNotification]::new($t))"
            );
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .output();
        }
    })
    .await;
}


#[cfg(test)]
mod tests {
    use super::*;

    fn matcher(process_names: &[&str], path_patterns: &[&str], bundle_ids: &[&str]) -> Matcher {
        Matcher {
            app_id: "app-1".into(),
            name: "Test App".into(),
            action: "block".into(),
            process_names: process_names.iter().map(|s| s.to_string()).collect(),
            path_patterns: path_patterns.iter().map(|s| s.to_string()).collect(),
            bundle_ids: bundle_ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn test_matches_on_executable_name_case_insensitively() {
        let m = matcher(&["ChatGPT.exe"], &[], &[]);
        assert!(matches(&m, "C:\\Program Files\\OpenAI\\chatgpt.exe"));
    }

    /// The name match is on the *file name*, not a substring of the path —
    /// otherwise a directory that happens to contain the word would match
    /// every binary underneath it.
    #[test]
    fn test_name_match_does_not_fire_on_a_parent_directory() {
        let m = matcher(&["code"], &[], &[]);
        assert!(!matches(&m, "/opt/code/bin/helper"));
        assert!(matches(&m, "/usr/share/code/code"));
    }

    #[test]
    fn test_path_pattern_is_a_substring_match() {
        let m = matcher(&[], &["/applications/slack.app/"], &[]);
        assert!(matches(&m, "/Applications/Slack.app/Contents/MacOS/Slack"));
        assert!(!matches(&m, "/Applications/Notes.app/Contents/MacOS/Notes"));
    }

    /// An empty pattern would `contains("")` — true for every path — and
    /// silently terminate everything running on the machine.
    #[test]
    fn test_empty_path_pattern_never_matches() {
        let m = matcher(&[], &["", "   "], &[]);
        assert!(!matches(&m, "/usr/bin/anything"));
    }

    #[test]
    fn test_matcher_with_nothing_to_match_on_matches_nothing() {
        let m = matcher(&[], &[], &[]);
        assert!(!matches(&m, "/usr/bin/anything"));
    }

    /// An app blocked from the installed-software inventory carries its
    /// install path as the pattern; that must not also catch a different app
    /// whose name merely starts the same way.
    #[test]
    fn test_bundle_path_pattern_matches_only_on_the_bundle_boundary() {
        let m = matcher(&[], &["/Applications/Foo.app"], &[]);
        assert!(matches(&m, "/Applications/Foo.app/Contents/MacOS/Foo"));
        assert!(matches(&m, "/Applications/Foo.app/Contents/Frameworks/Foo Helper.app/Contents/MacOS/Foo Helper"));
        assert!(!matches(&m, "/Applications/Foo.application/Contents/MacOS/Foo"));
        assert!(!matches(&m, "/Applications/Foo.app2/Contents/MacOS/Foo"));
    }

    #[test]
    fn test_bundle_root_is_the_outermost_app() {
        assert_eq!(bundle_root("/Applications/WhatsApp.app/Contents/MacOS/WhatsApp"), Some("/Applications/WhatsApp.app"));
        assert_eq!(
            bundle_root("/Applications/WhatsApp.app/Contents/PlugIns/ServiceExtension.appex/Contents/MacOS/ServiceExtension"),
            Some("/Applications/WhatsApp.app")
        );
        assert_eq!(
            bundle_root("/Applications/Slack.app/Contents/Frameworks/Slack Helper.app/Contents/MacOS/Slack Helper"),
            Some("/Applications/Slack.app")
        );
        assert_eq!(bundle_root("/usr/bin/telegram-desktop"), None);
    }

    /// Only the app's own main binary produces a notification; its helpers
    /// and extensions are killed silently alongside it.
    #[test]
    fn test_primary_executable_is_only_the_bundles_own_binary() {
        assert!(is_primary_executable("/Applications/WhatsApp.app/Contents/MacOS/WhatsApp"));
        assert!(is_primary_executable("/usr/bin/telegram-desktop"));
        assert!(is_primary_executable("C:\\Program Files\\WhatsApp\\WhatsApp.exe"));
        assert!(!is_primary_executable(
            "/Applications/WhatsApp.app/Contents/PlugIns/ServiceExtension.appex/Contents/MacOS/ServiceExtension"
        ));
        assert!(!is_primary_executable(
            "/Applications/Slack.app/Contents/Frameworks/Slack Helper.app/Contents/MacOS/Slack Helper"
        ));
        assert!(!is_primary_executable("/Applications/Foo.app/Contents/Resources/bin/tool"));
    }

    fn proc(pid: i32, ppid: i32, path: &str) -> Proc {
        Proc { pid, ppid, path: path.to_string() }
    }

    /// The whole application goes: the matched process, everything else in
    /// its bundle (even when launchd, not the app, started it), and every
    /// descendant of any of those wherever its binary lives — and nothing
    /// that merely shares a parent with it.
    #[test]
    fn test_app_family_covers_bundle_and_descendants_but_not_bystanders() {
        let processes = vec![
            proc(100, 1, "/Applications/Foo.app/Contents/MacOS/Foo"),
            proc(101, 100, "/Applications/Foo.app/Contents/Frameworks/Foo Helper.app/Contents/MacOS/Foo Helper"),
            proc(102, 1, "/Applications/Foo.app/Contents/PlugIns/Ext.appex/Contents/MacOS/Ext"),
            proc(103, 100, "/bin/sh"),
            proc(104, 103, "/usr/bin/curl"),
            proc(200, 1, "/Applications/Notes.app/Contents/MacOS/Notes"),
            proc(201, 1, "/bin/zsh"),
        ];
        assert_eq!(
            app_family(100, "/Applications/Foo.app/Contents/MacOS/Foo", &processes),
            vec![100, 101, 102, 103, 104]
        );
    }

    #[test]
    fn test_app_family_never_includes_init_or_this_agent() {
        let own = std::process::id() as i32;
        let processes = vec![proc(50, 1, "/opt/foo/foo"), proc(own, 50, "/opt/agent/agent"), proc(1, 0, "/sbin/launchd")];
        assert_eq!(app_family(50, "/opt/foo/foo", &processes), vec![50]);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn test_parse_ps_line_keeps_spaces_in_the_executable_path() {
        assert_eq!(
            parse_ps_line("  812   1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Some(proc(812, 1, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))
        );
        assert_eq!(parse_ps_line("   12     1 "), None);
        assert_eq!(parse_ps_line("garbage"), None);
    }

    #[test]
    fn test_notifications_are_per_application_and_rate_limited() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let _guard = rt.enter();
        let client = AgentClient::new(crate::config::test_config(), Default::default());
        let watcher = AppControlWatcher::new(client, Arc::new(EnforcementGate::default()));
        assert!(watcher.should_notify("whatsapp"));
        assert!(!watcher.should_notify("whatsapp"), "a second process of the same app must not notify again");
        assert!(watcher.should_notify("telegram"), "a different app gets its own notification");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn test_native_listing_sees_this_process_and_its_path() {
        let own = std::process::id() as i32;
        assert!(native::all_pids().contains(&own));
        let path = native::pid_path(own).expect("own executable path");
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        assert!(path.ends_with(name), "{path} should end with {name}");
    }

    /// Real processes, not a fixture: a shell with two children of its own.
    /// Stopping the shell has to take its children down too — the case where
    /// only the one matched process died and what it had started kept
    /// running.
    #[cfg(unix)]
    #[test]
    fn test_stop_application_kills_the_process_and_everything_it_started() {
        let mut shell = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 60 & sleep 60 & wait"])
            .spawn()
            .unwrap();
        let shell_pid = shell.id() as i32;

        let mut children = Vec::new();
        for _ in 0..50 {
            children = list_processes().into_iter().filter(|p| p.ppid == shell_pid).map(|p| p.pid).collect();
            if children.len() >= 2 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(children.len(), 2, "the shell should have started two children");

        let stopped = stop_application(shell_pid, "/bin/sh");
        assert!(stopped.terminated);
        assert!(stopped.stopped_main, "a process outside any bundle is the application itself");
        let mut related = stopped.related;
        related.sort_unstable();
        children.sort_unstable();
        assert_eq!(related, children, "every child should have been killed with the shell");

        let _ = shell.wait();
        for child in children {
            let mut gone = false;
            for _ in 0..40 {
                if !is_alive(child) || is_zombie(child) {
                    gone = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            assert!(gone, "child {child} is still running");
        }
    }

    /// A killed grandchild whose new parent never reaps it (pid 1 in some
    /// containers) stays a zombie: dead, but still answering signal 0.
    #[cfg(unix)]
    fn is_zombie(pid: i32) -> bool {
        std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().starts_with('Z'))
            .unwrap_or(false)
    }
}

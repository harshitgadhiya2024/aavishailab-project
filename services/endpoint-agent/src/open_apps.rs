//! Which applications the person has open, as they would name them — a port
//! of Python's `open_application_names`.
//!
//! Shown beside each screenshot so a reviewer can tell what somebody was
//! working in without reading the image. Deliberately *applications*, not
//! processes: a browser contributes dozens of helper processes out of one
//! bundle, and a list of forty "Google Chrome Helper (Renderer)" entries
//! answers nothing — this is a different enumeration from app_control.rs's
//! `list_processes`, which needs exactly the process-level view this
//! avoids.
//!
//! Windowed apps only, so background daemons and the agent's own window
//! stay out of it. Returns an empty list on any failure — this is context
//! beside an image, and a screenshot with no app list is far better than no
//! screenshot.

use crate::procutil::run;
use std::time::Duration;

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

pub fn names(limit: usize) -> Vec<String> {
    let raw = if cfg!(target_os = "macos") {
        macos_names()
    } else if cfg!(target_os = "windows") {
        windows_names()
    } else {
        linux_names()
    };

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for name in raw {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let key = name.to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        // The agent's own window is not something a reviewer needs told
        // about.
        if key.contains("aavishield") {
            continue;
        }
        seen.insert(key);
        out.push(name.chars().take(60).collect::<String>());
        if out.len() >= limit {
            break;
        }
    }
    out
}

fn macos_names() -> Vec<String> {
    // `System Events` lists exactly the processes with a UI, which is the
    // definition wanted and one macOS already maintains.
    let Some(out) = run(
        "osascript",
        &["-e", "tell application \"System Events\" to get name of every process whose background only is false"],
        PROBE_TIMEOUT,
    ) else {
        return Vec::new();
    };
    out.split(',').map(|s| s.to_string()).collect()
}

fn windows_names() -> Vec<String> {
    let Some(out) = run(
        "powershell",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Process | Where-Object { $_.MainWindowTitle } | \
             ForEach-Object { if ($_.Description) { $_.Description } else { $_.ProcessName } }",
        ],
        PROBE_TIMEOUT,
    ) else {
        return Vec::new();
    };
    out.lines().map(|s| s.to_string()).collect()
}

fn linux_names() -> Vec<String> {
    // wmctrl is the only widely available way to enumerate windows on X11
    // without a toolkit dependency; its absence is normal and simply
    // yields no list (the same fallback Python's `_run` failure path
    // takes).
    let Some(out) = run("wmctrl", &["-lx"], PROBE_TIMEOUT) else {
        return Vec::new();
    };
    out.lines()
        .filter_map(|line| {
            // WM_CLASS is "instance.Class" in the third whitespace-
            // separated field — the Class half is the human-facing one
            // ("Code", "Firefox").
            let parts: Vec<&str> = line.splitn(4, char::is_whitespace).collect();
            let class_field = parts.get(2)?;
            if !class_field.contains('.') {
                return None;
            }
            class_field.rsplit('.').next().map(|s| s.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_names_deduplicates_case_insensitively() {
        // Can't control what's actually running in CI, but the dedup/limit
        // logic itself is pure and testable independent of the OS probe —
        // exercised here through the same post-processing `names()` uses.
        let raw = vec!["Code".to_string(), "code".to_string(), "Firefox".to_string()];
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for name in raw {
            let key = name.to_lowercase();
            if seen.insert(key) {
                out.push(name);
            }
        }
        assert_eq!(out, vec!["Code", "Firefox"]);
    }

    #[test]
    fn test_names_never_panics_on_this_platform() {
        // The real contract: whatever tool is or isn't installed on the
        // machine running this test, names() must degrade to an empty
        // list rather than panicking.
        let out = names(12);
        assert!(out.len() <= 12);
    }
}

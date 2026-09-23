//! Shared subprocess helper.
//!
//! Extracted from inventory.rs, which is also where the deadlock this
//! guards against was actually found: a pipe holds ~64KB before its writer
//! blocks, and `dpkg-query` on an ordinary Ubuntu box emits ~68KB for ~790
//! packages. Polling `try_wait()` without draining stdout first deadlocks —
//! the child blocks writing, so it never exits, so the poll never
//! completes — and the caller only sees a silent, total failure once the
//! timeout below kills it. Every module that shells out to a real OS tool
//! whose output size isn't bounded in advance (inventory, posture) goes
//! through this rather than `std::process::Command::output()` directly, so
//! that failure mode has exactly one fix instead of one per call site.
//!
//! `app_control.rs`'s process-list and notification commands do not need
//! this: `ps -axo pid=,comm=` and friends are small and bounded by the
//! number of running processes, not by a package database.

use std::time::Duration;

/// A per-command ceiling. Callers pick this: inventory's package-manager
/// walks and a heartbeat-cycle posture probe have very different budgets —
/// the latter must stay well inside the heartbeat interval, since a probe
/// that hangs would otherwise stall the enforcement verdict that rides the
/// same beat.
///
/// Runs `cmd` and returns its stdout as a lossily-decoded string, or `None`
/// if the command is missing, exits non-zero, or exceeds `timeout`.
///
/// A collector for a tool this machine does not have (e.g. `ufw` on a box
/// that uses firewalld instead) exits non-zero or fails to spawn at all;
/// both are normal and silent here, exactly as they are in inventory.rs.
pub fn run(cmd: &str, args: &[&str], timeout: Duration) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let mut child = Command::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .ok()?;

    // stdout MUST be drained on its own thread while we wait for the exit —
    // see the module doc for why.
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });

    // std::process has no built-in timeout; poll, then kill. Killing closes
    // the pipe, which is also what releases the reader thread.
    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    tracing::debug!(command = cmd, "subprocess timed out");
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                let _ = reader.join();
                return None;
            }
        }
    };

    let buf = reader.join().ok()?;
    if !status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_run_captures_stdout() {
        let out = run("echo", &["hello"], Duration::from_secs(5));
        assert_eq!(out.as_deref(), Some("hello\n"));
    }

    #[test]
    fn test_run_returns_none_for_missing_command() {
        assert_eq!(run("definitely-not-a-real-command-xyz", &[], Duration::from_secs(5)), None);
    }

    #[test]
    fn test_run_returns_none_on_nonzero_exit() {
        assert_eq!(run("sh", &["-c", "exit 1"], Duration::from_secs(5)), None);
    }

    #[test]
    fn test_run_handles_output_larger_than_pipe_buffer() {
        // Regression test for the exact deadlock this module exists to
        // prevent: >64KB of stdout with nothing draining it until the
        // process exits would previously hang until the timeout.
        let out = run("sh", &["-c", "head -c 200000 /dev/zero | tr '\\0' 'a'"], Duration::from_secs(5));
        assert_eq!(out.map(|s| s.len()), Some(200000));
    }

    #[test]
    fn test_run_kills_and_returns_none_on_timeout() {
        let start = std::time::Instant::now();
        let out = run("sleep", &["5"], Duration::from_millis(200));
        assert_eq!(out, None);
        assert!(start.elapsed() < Duration::from_secs(2), "should have been killed near the timeout, not run to completion");
    }
}

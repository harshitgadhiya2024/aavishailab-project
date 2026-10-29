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
    let (success, out) = capture(cmd, args, timeout, false)?;
    success.then_some(out)
}

/// Like `run`, but returns stdout followed by stderr, and returns it
/// whatever the exit status — the bool says whether it was zero.
///
/// For the macOS tools that answer on stderr rather than stdout:
/// `sysadminctl -screenLock status` logs its whole answer there, and
/// `codesign -dv` prints the signing details there too. Through `run`
/// those read as an empty string, which is exactly how screen lock came to
/// be reported as "could not determine" on every Mac. `spctl --status`
/// needs the exit status too: it exits non-zero when Gatekeeper is off,
/// which is an answer, not a failed probe.
pub fn run_combined(cmd: &str, args: &[&str], timeout: Duration) -> Option<(bool, String)> {
    capture(cmd, args, timeout, true)
}

/// `Command::new`, except that on Windows the child gets no console window.
/// The agent is a windowed app there, so without CREATE_NO_WINDOW every
/// netsh/powershell/taskkill it runs flashes a black console on screen.
/// Every subprocess that can run on Windows is built through this.
pub fn command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    cmd
}

fn capture(cmd: &str, args: &[&str], timeout: Duration, with_stderr: bool) -> Option<(bool, String)> {
    use std::io::Read;
    use std::process::Stdio;

    let mut child = command(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(if with_stderr { Stdio::piped() } else { Stdio::null() })
        .stdin(Stdio::null())
        .spawn()
        .ok()?;

    // stdout MUST be drained on its own thread while we wait for the exit —
    // see the module doc for why. stderr is a second pipe with the same
    // ~64KB limit, so it gets its own thread for the same reason.
    let drain = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        })
    };
    let reader = drain(Box::new(child.stdout.take()?));
    let err_reader = child.stderr.take().map(|e| drain(Box::new(e)));

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
                    if let Some(r) = err_reader {
                        let _ = r.join();
                    }
                    tracing::debug!(command = cmd, "subprocess timed out");
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                let _ = reader.join();
                if let Some(r) = err_reader {
                    let _ = r.join();
                }
                return None;
            }
        }
    };

    let mut buf = reader.join().ok()?;
    if let Some(r) = err_reader {
        buf.extend(r.join().ok()?);
    }
    Some((status.success(), String::from_utf8_lossy(&buf).into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Uses Unix tools (echo, sh, sleep).
    #[cfg(unix)]
    #[test]
    fn test_run_captures_stdout() {
        let out = run("echo", &["hello"], Duration::from_secs(5));
        assert_eq!(out.as_deref(), Some("hello\n"));
    }

    #[test]
    fn test_run_returns_none_for_missing_command() {
        assert_eq!(run("definitely-not-a-real-command-xyz", &[], Duration::from_secs(5)), None);
    }

    // Uses Unix tools (echo, sh, sleep).
    #[cfg(unix)]
    #[test]
    fn test_run_returns_none_on_nonzero_exit() {
        assert_eq!(run("sh", &["-c", "exit 1"], Duration::from_secs(5)), None);
    }

    // Uses Unix tools (echo, sh, sleep).
    #[cfg(unix)]
    #[test]
    fn test_run_handles_output_larger_than_pipe_buffer() {
        // Regression test for the exact deadlock this module exists to
        // prevent: >64KB of stdout with nothing draining it until the
        // process exits would previously hang until the timeout.
        let out = run("sh", &["-c", "head -c 200000 /dev/zero | tr '\\0' 'a'"], Duration::from_secs(5));
        assert_eq!(out.map(|s| s.len()), Some(200000));
    }

    // Uses Unix tools (echo, sh, sleep).
    #[cfg(unix)]
    #[test]
    fn test_run_combined_captures_stderr_and_nonzero_exit() {
        let out = run_combined("sh", &["-c", "echo out; echo err >&2; exit 3"], Duration::from_secs(5));
        assert_eq!(out, Some((false, "out\nerr\n".to_string())));
    }

    // Uses Unix tools (echo, sh, sleep).
    #[cfg(unix)]
    #[test]
    fn test_run_kills_and_returns_none_on_timeout() {
        let start = std::time::Instant::now();
        let out = run("sleep", &["5"], Duration::from_millis(200));
        assert_eq!(out, None);
        assert!(start.elapsed() < Duration::from_secs(2), "should have been killed near the timeout, not run to completion");
    }
}

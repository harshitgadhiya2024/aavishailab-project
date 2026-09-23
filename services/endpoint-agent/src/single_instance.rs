//! Single-instance lock — a port of Python's `acquire_single_instance_lock`
//! / `_signal_running_instance_to_show`.
//!
//! Verified on a real Mac (per the Python original's own comment, kept
//! accurate here): launchd can end up starting the LaunchAgent twice
//! within the same second — the postinstall script's explicit `launchctl
//! bootstrap` racing launchd's own `RunAtLoad` pickup of a plist that just
//! appeared on disk — producing two fully live agent processes at once,
//! both fighting over the same ports forever (neither ever wins, since
//! neither exits). That is an expected startup race, not a real failure,
//! and the loser should exit quietly rather than spam the same "can't
//! bind" error every few seconds for good.
//!
//! The lock is advisory/OS-native rather than a PID file checked by hand:
//! a stale PID file surviving a crash would otherwise need its own
//! staleness heuristic (is that PID even still running? was it reused by
//! an unrelated process?) that the OS's own exclusivity primitive makes
//! unnecessary — the lock is released automatically the instant the
//! holding process exits or dies, by definition.
//!
//! The two platforms' idiomatic mechanisms differ enough that this isn't
//! one function with a `#[cfg]`'d call inside it: Unix opens the file
//! normally and then explicitly `flock`s it; Windows gets exclusivity as
//! a side effect of *how* the file is opened (`share_mode(0)` — no other
//! process may open it at all while this handle is held), no separate
//! lock call needed. Both are expressed through `open_exclusive` below so
//! `acquire` itself stays platform-agnostic.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};

fn lock_path() -> std::path::PathBuf {
    crate::config::state_dir().join("agent.lock")
}

/// True if this process now holds the lock; false if another instance
/// already does. The winner's PID is written into the lock file so a
/// losing instance can find it and ask it to show its window.
///
/// The file handle is deliberately leaked (`std::mem::forget`) rather than
/// returned or dropped: dropping it would close the fd/HANDLE and release
/// the OS-level lock immediately, defeating the entire point. The lock
/// must live exactly as long as the process does, which "leak it to
/// `'static`" is the simplest correct way to express — the OS reclaims it
/// at exit regardless, the same guarantee closing it explicitly would
/// provide.
pub fn acquire() -> bool {
    let path = lock_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }

    let Some(mut file) = open_exclusive(&path) else { return false };

    // Only the winner truncates, and only after it already owns the lock
    // — a losing instance must never be able to reach this line, so the
    // winner's PID (written here) can never be wiped by a loser racing to
    // fail. `signal_running_instance_to_show` depends on that ordering.
    let _ = file.seek(SeekFrom::Start(0));
    let _ = file.set_len(0);
    let _ = write!(file, "{}", std::process::id());
    let _ = file.flush();

    std::mem::forget(file);
    true
}

#[cfg(unix)]
fn open_exclusive(path: &std::path::Path) -> Option<File> {
    use std::os::unix::io::AsRawFd;
    // truncate(false) is the point, not an omission: truncating before the
    // lock is even attempted would let a losing instance wipe the
    // winner's PID out of the file on its way to failing below.
    let file = OpenOptions::new().create(true).read(true).write(true).truncate(false).open(path).ok()?;
    // SAFETY: flock on a valid fd this process just opened and owns
    // exclusively for the duration of the call — the standard
    // advisory-lock idiom, and the same call Python's `fcntl.flock` wraps.
    let locked = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) == 0 };
    if locked {
        Some(file)
    } else {
        None
    }
}

#[cfg(windows)]
fn open_exclusive(path: &std::path::Path) -> Option<File> {
    use std::os::windows::fs::OpenOptionsExt;
    // share_mode(0): no other process may open this path at all — for
    // read, write, or delete — while this handle is held. Exclusivity is
    // a side effect of the open call itself, not a separate locking step,
    // and needs no FFI: `OpenOptionsExt` is stable `std`. Written from the
    // Python original's `msvcrt.locking`-based approach but, like every
    // other Windows-specific path in this crate, NOT verified on real
    // Windows hardware (see the top-level README's verification status).
    // truncate(false): exclusivity here comes from share_mode(0) at open
    // time, but the PID this file may already hold (this process's own
    // previous run, if it crashed and is starting again) is still worth
    // preserving until the write below actually replaces it.
    OpenOptions::new().create(true).read(true).write(true).truncate(false).share_mode(0).open(path).ok()
}

/// Asks the process holding the lock to bring its window up. Used by a
/// losing instance right before it exits — the equivalent of someone
/// clicking the Dock/Spotlight icon while the agent is already running.
///
/// A no-op on Windows: there is no SIGUSR1 there, and the taskbar/tray is
/// how someone gets the window back — matching the Python original's own
/// no-op on that platform exactly.
pub fn signal_running_instance_to_show() {
    #[cfg(unix)]
    {
        let Ok(mut file) = File::open(lock_path()) else { return };
        let mut buf = String::new();
        if file.read_to_string(&mut buf).is_err() {
            return;
        }
        let Ok(pid) = buf.trim().parse::<i32>() else { return };
        if pid <= 0 || pid == std::process::id() as i32 {
            return;
        }
        // SAFETY: `kill` with a signal number and no side effects beyond
        // delivering it. Sending SIGUSR1 to a PID that has since exited
        // and been reused by an unrelated process is the one real risk;
        // SIGUSR1's default disposition is to terminate, but PID reuse
        // within the tiny window between a crashed agent exiting and this
        // call is rare enough that Python accepts the identical risk
        // without further guarding against it.
        unsafe {
            libc::kill(pid, libc::SIGUSR1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lock_path_is_under_state_dir() {
        let p = lock_path();
        assert_eq!(p.file_name().unwrap(), "agent.lock");
        assert_eq!(p.parent().unwrap(), crate::config::state_dir());
    }

    #[test]
    fn test_acquire_creates_the_lock_file() {
        // Exercises the real path end to end (create_dir_all, open,
        // platform-specific exclusive-open, write the PID) rather than
        // only the pure `lock_path` helper. Cross-process exclusivity
        // itself needs a second real OS process to prove — see
        // `test_a_second_process_cannot_acquire_a_held_lock` below, which
        // is `#[ignore]`d because it spawns `cargo test` recursively and
        // is meant to be run deliberately, not on every `cargo test`.
        assert!(acquire(), "acquire() should succeed when nothing else holds this test run's lock file");
        let contents = std::fs::read_to_string(lock_path()).unwrap();
        assert_eq!(contents.trim(), std::process::id().to_string());
    }

    /// Spawns a real second process holding the lock and confirms this
    /// process's own `acquire()` then fails — the one property that
    /// cannot be proven from inside a single process, since flock/
    /// share_mode(0) exclusivity is specifically a *cross-process*
    /// guarantee. `#[ignore]`d: it shells out to `cargo test` again
    /// (recursion cargo test's own harness doesn't expect by default) and
    /// takes real wall-clock time, so it runs on request
    /// (`cargo test -- --ignored single_instance`) rather than on every
    /// `cargo test`.
    #[test]
    #[ignore]
    fn test_a_second_process_cannot_acquire_a_held_lock() {
        use std::process::{Command, Stdio};
        // Hold the lock in a child process for long enough for this test
        // to observe it, via a tiny inline Rust program run through
        // `cargo run --example`-equivalent — simplest here is a `sh -c`
        // helper that just holds an flock on Unix; Windows has no
        // equivalent one-liner, so this test is Unix-only.
        if cfg!(not(unix)) {
            return;
        }
        let path = lock_path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).unwrap();
        }
        let mut holder = Command::new("sh")
            .arg("-c")
            .arg(format!("exec flock -x {:?} sleep 2", path))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("flock(1) must be available to run this test");
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(!acquire(), "a second instance must not acquire the lock while the first holds it");
        let _ = holder.wait();
    }
}

//! Windows-only native calls.
//!
//! Everything here replaces a subprocess that misbehaved on real Windows:
//! `cmd /C start` cut every URL at its first `&` (so the enrollment page
//! never received its callback), and app control ran PowerShell's
//! `Get-CimInstance Win32_Process` every five seconds, a second of CPU each
//! time. The rest is what `service.rs` needs to act on behalf of the people
//! logged in to this PC.

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};

/// NUL-terminated UTF-16, for every `*W` call.
pub fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Closes the handle when dropped, so no early return leaks one.
struct Owned(HANDLE);

impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            // SAFETY: a handle this module opened and owns exclusively.
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// Opens `url` in the person's default browser. ShellExecute takes the URL
/// as one string, so nothing in it is ever parsed as a command.
pub fn open_url(url: &str) -> bool {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let (verb, file) = (wide("open"), wide(url));
    // SAFETY: valid NUL-terminated strings; null for the optional ones.
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    // ShellExecute reports success as any value above 32.
    result as usize > 32
}

/// Runs `file` elevated (the UAC prompt), detached. Used only after a
/// company administrator has authorised removal on the server.
pub fn run_elevated(file: &str, params: &str) -> bool {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let (verb, file, params) = (wide("runas"), wide(file), wide(params));
    // SAFETY: valid NUL-terminated strings; null for the optional ones.
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), params.as_ptr(), std::ptr::null(), SW_SHOWNORMAL) };
    result as usize > 32
}

pub struct Process {
    pub pid: u32,
    pub ppid: u32,
    /// Full image path, or empty when this process may not open the other
    /// one (an elevated or another user's process, seen from a standard
    /// user) — the same gap `Win32_Process.ExecutablePath` had.
    pub path: String,
    /// The bare file name from the snapshot, always present.
    pub name: String,
}

/// Every running process. One snapshot plus one open per process; no
/// subprocess.
pub fn processes() -> Vec<Process> {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};

    // SAFETY: plain snapshot call; the handle is owned by `snap`.
    let snap = Owned(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) });
    if snap.0 == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    // SAFETY: PROCESSENTRY32W is plain data; dwSize must be set before use.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

    let mut out = Vec::new();
    // SAFETY: a valid snapshot handle and a correctly sized entry.
    let mut ok = unsafe { Process32FirstW(snap.0, &mut entry) } != 0;
    while ok {
        let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
        let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
        out.push(Process { pid: entry.th32ProcessID, ppid: entry.th32ParentProcessID, path: image_path(entry.th32ProcessID).unwrap_or_default(), name });
        // SAFETY: as above.
        ok = unsafe { Process32NextW(snap.0, &mut entry) } != 0;
    }
    out
}

pub fn image_path(pid: u32) -> Option<String> {
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    if pid == 0 || pid == 4 {
        return None; // System Idle Process and System have no image
    }
    // SAFETY: OpenProcess returns null on failure, which Owned tolerates.
    let process = Owned(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) });
    if process.0.is_null() {
        return None;
    }
    let mut buf = vec![0u16; 1024];
    let mut size = buf.len() as u32;
    // SAFETY: `buf` holds `size` u16s; the call writes at most that many.
    if unsafe { QueryFullProcessImageNameW(process.0, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut size) } == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..size as usize]))
}

/// Every running PID, without opening any of them: the launch guard runs
/// this several times a second.
pub fn pids() -> Vec<u32> {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    // SAFETY: as in `processes`.
    let snap = Owned(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) });
    if snap.0 == INVALID_HANDLE_VALUE {
        return Vec::new();
    }
    // SAFETY: as in `processes`.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut out = Vec::new();
    // SAFETY: as in `processes`.
    let mut ok = unsafe { Process32FirstW(snap.0, &mut entry) } != 0;
    while ok {
        out.push(entry.th32ProcessID);
        // SAFETY: as in `processes`.
        ok = unsafe { Process32NextW(snap.0, &mut entry) } != 0;
    }
    out
}

/// Whether `pid` is still running.
pub fn is_alive(pid: u32) -> bool {
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    const STILL_ACTIVE: u32 = 259;
    // SAFETY: OpenProcess returns null on failure, which Owned tolerates.
    let process = Owned(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) });
    if process.0.is_null() {
        return false;
    }
    let mut code = 0u32;
    // SAFETY: writes one u32.
    unsafe { GetExitCodeProcess(process.0, &mut code) != 0 && code == STILL_ACTIVE }
}

/// The Remote Desktop / console session a process belongs to.
pub fn session_of(pid: u32) -> Option<u32> {
    use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    let mut session = 0u32;
    // SAFETY: writes one u32.
    (unsafe { ProcessIdToSessionId(pid, &mut session) } != 0).then_some(session)
}

/// Tells WinINet-based apps (Edge, Chrome, Teams, Office) that the proxy in
/// the registry changed, so already-running ones pick it up now rather than
/// on their next restart.
pub fn notify_proxy_changed() {
    use windows_sys::Win32::Networking::WinInet::{InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED};
    // SAFETY: both options take no buffer.
    unsafe {
        InternetSetOptionW(std::ptr::null(), INTERNET_OPTION_SETTINGS_CHANGED, std::ptr::null(), 0);
        InternetSetOptionW(std::ptr::null(), INTERNET_OPTION_REFRESH, std::ptr::null(), 0);
    }
}

/// True while Windows Installer is installing or removing anything. The
/// service must not restart the agent in the middle of its own upgrade.
pub fn installer_running() -> bool {
    use windows_sys::Win32::System::Threading::OpenMutexW;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    let name = wide("Global\\_MSIExecute");
    // SAFETY: a valid name; the handle (if any) is owned and closed.
    let mutex = Owned(unsafe { OpenMutexW(SYNCHRONIZE, 0, name.as_ptr()) });
    !mutex.0.is_null()
}

/// Sessions someone is actively signed in to (console or Remote Desktop).
pub fn active_sessions() -> Vec<u32> {
    use windows_sys::Win32::System::RemoteDesktop::{WTSActive, WTSEnumerateSessionsW, WTSFreeMemory, WTS_CURRENT_SERVER_HANDLE, WTS_SESSION_INFOW};
    let mut info: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
    let mut count = 0u32;
    // SAFETY: on success the API allocates `count` entries at `info`,
    // released with WTSFreeMemory below.
    if unsafe { WTSEnumerateSessionsW(WTS_CURRENT_SERVER_HANDLE, 0, 1, &mut info, &mut count) } == 0 {
        return Vec::new();
    }
    // SAFETY: `info` points at `count` initialised entries.
    let sessions = unsafe { std::slice::from_raw_parts(info, count as usize) };
    let active = sessions.iter().filter(|s| s.State == WTSActive && s.SessionId != 0).map(|s| s.SessionId).collect();
    // SAFETY: the buffer WTSEnumerateSessionsW allocated.
    unsafe { WTSFreeMemory(info as *mut c_void) };
    active
}

/// Starts `exe args` as the user signed in to `session`, on their desktop,
/// with their environment — the way a logon would have started it. Only
/// works from SYSTEM (WTSQueryUserToken needs SeTcbPrivilege).
///
/// The token is that session's own, so for an administrator it is the
/// filtered, non-elevated one: the agent always runs with the person's
/// ordinary rights, as it does on macOS.
pub fn launch_in_session(session: u32, exe: &str, args: &str) -> Result<u32, String> {
    use windows_sys::Win32::Security::{DuplicateTokenEx, SecurityImpersonation, TokenPrimary, TOKEN_ALL_ACCESS};
    use windows_sys::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
    use windows_sys::Win32::System::RemoteDesktop::WTSQueryUserToken;
    use windows_sys::Win32::System::Threading::{CreateProcessAsUserW, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW};

    let mut token: HANDLE = std::ptr::null_mut();
    // SAFETY: writes one handle on success.
    if unsafe { WTSQueryUserToken(session, &mut token) } == 0 {
        return Err(format!("WTSQueryUserToken: {}", std::io::Error::last_os_error()));
    }
    let token = Owned(token);
    let mut primary: HANDLE = std::ptr::null_mut();
    // SAFETY: duplicates a token we own into a new primary token.
    if unsafe { DuplicateTokenEx(token.0, TOKEN_ALL_ACCESS, std::ptr::null(), SecurityImpersonation, TokenPrimary, &mut primary) } == 0 {
        return Err(format!("DuplicateTokenEx: {}", std::io::Error::last_os_error()));
    }
    let primary = Owned(primary);

    let mut env: *mut c_void = std::ptr::null_mut();
    // SAFETY: builds the user's environment block; freed below.
    let have_env = unsafe { CreateEnvironmentBlock(&mut env, primary.0, 0) } != 0;

    let mut desktop = wide("winsta0\\default");
    // SAFETY: STARTUPINFOW is plain data.
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    startup.lpDesktop = desktop.as_mut_ptr();
    // SAFETY: as above.
    let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let app = wide(exe);
    let mut cmdline = wide(&format!("\"{exe}\" {args}"));
    let dir = std::path::Path::new(exe).parent().map(|p| wide(&p.to_string_lossy()));
    // SAFETY: every pointer is valid for the call; cmdline is mutable as
    // CreateProcessW requires.
    let ok = unsafe {
        CreateProcessAsUserW(
            primary.0,
            app.as_ptr(),
            cmdline.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            CREATE_UNICODE_ENVIRONMENT,
            if have_env { env } else { std::ptr::null() },
            dir.as_ref().map_or(std::ptr::null(), |d| d.as_ptr()),
            &startup,
            &mut info,
        )
    } != 0;
    let error = std::io::Error::last_os_error();
    if have_env {
        // SAFETY: the block CreateEnvironmentBlock allocated.
        unsafe { DestroyEnvironmentBlock(env) };
    }
    if !ok {
        return Err(format!("CreateProcessAsUserW: {error}"));
    }
    drop(Owned(info.hThread));
    drop(Owned(info.hProcess));
    Ok(info.dwProcessId)
}

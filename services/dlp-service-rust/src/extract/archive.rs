//! ZIP / TAR / GZIP / 7z. Every entry is budget-checked before it is read,
//! so nesting depth, entry count, decompressed total and expansion ratio are
//! enforced all the way down, not just at the top. Entries are read into
//! memory and dispatched — never written to disk by their own path.

use super::{dispatch, BudgetExceeded, Ctx, Item};
use std::io::{Cursor, Read};

fn recurse(payload: &[u8], part: &str, name: &str, ctx: &mut Ctx) {
    ctx.nested(part, |c| dispatch(payload, part, name, "", c));
}

pub fn extract_zip(data: &[u8], part: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    let Ok(mut zf) = zip::ZipArchive::new(Cursor::new(data)) else {
        ctx.emit(Item::unscannable(part, "corrupt", "not a valid zip"));
        return Ok(());
    };
    for i in 0..zf.len() {
        if ctx.stopped() {
            return Ok(());
        }
        // Metadata first: an encrypted entry can't be opened, but its name
        // and flags can be read without the password.
        let (name, size, is_dir, encrypted) = match zf.by_index_raw(i) {
            Ok(f) => (f.name().to_string(), f.size(), f.is_dir(), f.encrypted()),
            Err(e) => {
                ctx.emit(Item::unscannable(part, "corrupt", e.to_string()));
                continue;
            }
        };
        if is_dir {
            continue;
        }
        let entry_part = format!("{part}!{name}");
        ctx.check_budget(size)?;
        if encrypted {
            ctx.emit(Item::unscannable(&entry_part, "encrypted_archive", "password-protected zip entry"));
            continue;
        }
        let mut payload = Vec::with_capacity(size.min(64 << 20) as usize);
        match zf.by_index(i).map(|mut f| f.read_to_end(&mut payload)) {
            Ok(Ok(_)) => recurse(&payload, &entry_part, &name, ctx),
            Ok(Err(e)) => {
                ctx.emit(Item::unscannable(&entry_part, "corrupt", e.to_string()));
            }
            Err(e) => {
                ctx.emit(Item::unscannable(&entry_part, "corrupt", e.to_string()));
            }
        }
    }
    Ok(())
}

pub fn extract_gzip(data: &[u8], part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    let inner = if filename.to_ascii_lowercase().ends_with(".gz") {
        filename[..filename.len() - 3].to_string()
    } else if filename.is_empty() {
        "content".to_string()
    } else {
        filename.to_string()
    };
    let mut gz = flate2::read::GzDecoder::new(data);
    let mut payload = Vec::new();
    let mut chunk = vec![0u8; 1 << 20];
    loop {
        match gz.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                // Checked as it inflates, so a gzip bomb stops at the limit
                // instead of after filling memory.
                ctx.check_budget(n as u64)?;
                payload.extend_from_slice(&chunk[..n]);
            }
            Err(e) => {
                ctx.emit(Item::unscannable(part, "corrupt", e.to_string()));
                return Ok(());
            }
        }
    }
    recurse(&payload, &format!("{part}!{inner}"), &inner, ctx);
    Ok(())
}

pub fn extract_tar(data: &[u8], part: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    let mut archive = tar::Archive::new(Cursor::new(data));
    let entries = match archive.entries() {
        Ok(e) => e,
        Err(e) => {
            ctx.emit(Item::unscannable(part, "corrupt", e.to_string()));
            return Ok(());
        }
    };
    for entry in entries {
        if ctx.stopped() {
            return Ok(());
        }
        let mut entry = match entry {
            Ok(e) => e,
            Err(e) => {
                ctx.emit(Item::unscannable(part, "corrupt", e.to_string()));
                return Ok(());
            }
        };
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let name = entry.path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let size = entry.size();
        let entry_part = format!("{part}!{name}");
        ctx.check_budget(size)?;
        let mut payload = Vec::with_capacity(size.min(64 << 20) as usize);
        if let Err(e) = entry.read_to_end(&mut payload) {
            ctx.emit(Item::unscannable(&entry_part, "corrupt", e.to_string()));
            continue;
        }
        recurse(&payload, &entry_part, &name, ctx);
    }
    Ok(())
}

pub fn extract_7z(data: &[u8], part: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    use sevenz_rust2::{ArchiveReader, Password};

    let mut reader = match ArchiveReader::new(Cursor::new(data), Password::empty()) {
        Ok(r) => r,
        Err(e) => {
            let reason = if is_password_error(&e) { "encrypted_archive" } else { "corrupt" };
            ctx.emit(Item::unscannable(part, reason, e.to_string()));
            return Ok(());
        }
    };

    // Budget the whole listing first — entry count and declared sizes —
    // before decompressing anything.
    let entries: Vec<(String, u64, bool)> =
        reader.archive().files.iter().map(|f| (f.name().to_string(), f.size(), f.is_directory())).collect();
    for (_, size, is_dir) in &entries {
        if !is_dir {
            ctx.check_budget(*size)?;
        }
    }

    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let result = reader.for_each_entries(|entry, rd| {
        if entry.is_directory() {
            return Ok(true);
        }
        let mut buf = Vec::with_capacity(entry.size().min(64 << 20) as usize);
        rd.read_to_end(&mut buf)?;
        files.push((entry.name().to_string(), buf));
        Ok(true)
    });
    if let Err(e) = result {
        let reason = if is_password_error(&e) { "encrypted_archive" } else { "corrupt" };
        ctx.emit(Item::unscannable(part, reason, e.to_string()));
        return Ok(());
    }
    for (name, payload) in files {
        if ctx.stopped() {
            break;
        }
        recurse(&payload, &format!("{part}!{name}"), &name, ctx);
    }
    Ok(())
}

fn is_password_error(e: &sevenz_rust2::Error) -> bool {
    let s = e.to_string().to_ascii_lowercase();
    s.contains("password") || s.contains("encrypt")
}

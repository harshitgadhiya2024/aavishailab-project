//! Legacy OLE/CFB documents — .doc, .xls, .ppt, Outlook .msg — and
//! password-protected OOXML files, which are really OLE containers wrapping
//! an encrypted package (they sniff as "ole", never "zip").
//!
//! .msg bodies are read from their well-known property streams. .doc/.xls/
//! .ppt get best-effort extraction: every stream is scanned for runs of
//! printable ASCII and UTF-16LE text. Not document-model fidelity, but it
//! reliably surfaces the free text DLP cares about without a heavyweight or
//! copyleft parser.

use super::{BudgetExceeded, Ctx, Item};
use regex::bytes::Regex;
use std::io::{Cursor, Read};
use std::sync::LazyLock;

static ASCII_RUN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u)[\x20-\x7e]{4,}").unwrap());
static UTF16_RUN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u)(?:[\x20-\x7e]\x00){4,}").unwrap());

const MSG_UNICODE_BODY: &str = "__substg1.0_1000001F";
const MSG_ASCII_BODY: &str = "__substg1.0_1000001E";

pub fn extract(data: &[u8], part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    let mut cf = match cfb::CompoundFile::open(Cursor::new(data)) {
        Ok(cf) => cf,
        Err(e) => {
            ctx.emit(Item::unscannable(part, "corrupt", e.to_string()));
            return Ok(());
        }
    };
    let streams: Vec<String> = cf
        .walk()
        .filter(|e| e.is_stream())
        .map(|e| e.path().to_string_lossy().trim_start_matches('/').to_string())
        .collect();

    if streams.iter().any(|s| s == "EncryptionInfo" || s == "EncryptedPackage") {
        ctx.emit(Item::unscannable(part, "encrypted_document", "OLE-wrapped encrypted Office package"));
        return Ok(());
    }

    let mut read = |name: &str, ctx: &mut Ctx| -> Result<Option<Vec<u8>>, BudgetExceeded> {
        let Ok(mut s) = cf.open_stream(format!("/{name}")) else { return Ok(None) };
        let mut buf = Vec::new();
        if s.read_to_end(&mut buf).is_err() {
            return Ok(None);
        }
        ctx.check_budget(buf.len() as u64)?;
        Ok(Some(buf))
    };

    if streams.iter().any(|s| s.starts_with("__substg1.0_")) {
        let mut texts = Vec::new();
        // The Unicode body wins; the ASCII one is only a fallback.
        for name in [MSG_UNICODE_BODY, MSG_ASCII_BODY] {
            if streams.iter().any(|s| s == name) {
                if let Some(b) = read(name, ctx)? {
                    texts.push(decode_property(name, &b));
                }
                break;
            }
        }
        for name in streams.iter().filter(|s| s.starts_with("__substg1.0_0037")) {
            if let Some(b) = read(name, ctx)? {
                texts.push(decode_property(name, &b));
            }
        }
        let text = texts.into_iter().filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n");
        ctx.emit(Item::segment(part, filename, "application/vnd.ms-outlook", "msg", text));
        return Ok(());
    }

    let mut chunks = Vec::new();
    for name in &streams {
        let Some(b) = read(name, ctx)? else { continue };
        chunks.push(printable_runs(&b));
    }
    ctx.emit(Item::segment(part, filename, "application/x-ole-storage", "legacy_office", chunks.join("\n")));
    Ok(())
}

/// Every run of printable ASCII or UTF-16LE text of four or more characters.
pub fn printable_runs(b: &[u8]) -> String {
    let mut chunks: Vec<String> = ASCII_RUN.find_iter(b).map(|m| String::from_utf8_lossy(m.as_bytes()).into_owned()).collect();
    chunks.extend(UTF16_RUN.find_iter(b).map(|m| utf16le(m.as_bytes())));
    chunks.join("\n")
}

/// Property streams ending 001F are UTF-16LE; the rest are 8-bit.
fn decode_property(name: &str, data: &[u8]) -> String {
    if name.ends_with("001F") {
        utf16le(data)
    } else {
        String::from_utf8_lossy(data).into_owned()
    }
}

fn utf16le(b: &[u8]) -> String {
    let units: Vec<u16> = b.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
    String::from_utf16_lossy(&units).trim_end_matches('\0').to_string()
}

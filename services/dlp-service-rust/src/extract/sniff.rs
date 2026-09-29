//! Format sniffing by magic bytes. The declared Content-Type is never
//! trusted for dispatch — a renamed .exe served as "image/png" is exactly
//! what inspection exists to catch. The label (and then the extension) is
//! only consulted for formats with no magic at all: JSON, form bodies, CSV,
//! plain text.

const SIGNATURES: &[(&[u8], &str)] = &[
    (b"PK\x03\x04", "zip"),
    (b"PK\x05\x06", "zip"),
    (b"\x1f\x8b", "gzip"),
    (b"%PDF-", "pdf"),
    (b"Rar!\x1a\x07", "rar"),
    (b"7z\xbc\xaf\x27\x1c", "7z"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "ole"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpeg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"BM", "bmp"),
    (b"RIFF", "riff"),
    (b"II*\x00", "tiff"),
    (b"MM\x00*", "tiff"),
    (b"{\\rtf1", "rtf"),
    (b"From ", "eml_mbox"),
];

fn by_content_type(ct: &str) -> Option<&'static str> {
    Some(match ct {
        "application/json" | "text/json" | "application/x-ndjson" => "json",
        "application/x-www-form-urlencoded" => "urlencoded",
        "text/csv" | "text/tab-separated-values" => "csv",
        "application/xml" | "text/xml" => "xml",
        "text/html" => "html",
        "text/plain" => "text",
        "message/rfc822" => "eml",
        _ => return None,
    })
}

fn by_extension(filename: &str) -> Option<&'static str> {
    let ext = filename.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "txt" | "log" | "md" | "ini" | "conf" | "yaml" | "yml" => "text",
        "csv" | "tsv" => "csv",
        "json" | "ndjson" | "jsonl" => "json",
        "xml" => "xml",
        "html" | "htm" => "html",
        "eml" => "eml",
        "msg" | "doc" | "xls" | "ppt" => "ole",
        "docx" | "xlsx" | "pptx" | "zip" => "zip",
        "tar" => "tar",
        "gz" | "tgz" => "gzip",
        "rar" => "rar",
        "7z" => "7z",
        "rtf" => "rtf",
        "png" => "png",
        "jpg" | "jpeg" => "jpeg",
        "gif" => "gif",
        "bmp" => "bmp",
        "webp" => "webp",
        "tif" | "tiff" => "tiff",
        "pdf" => "pdf",
        _ => return None,
    })
}

/// A coarse family ("zip", "pdf", "ole", "text", …). Zip results are
/// refined into docx/xlsx/pptx by `zip_kind`, which needs the whole file.
pub fn sniff_family(head: &[u8], filename: &str, content_type: &str) -> &'static str {
    for (sig, family) in SIGNATURES {
        if head.starts_with(sig) {
            if *family == "riff" {
                return if head.len() >= 12 && &head[8..12] == b"WEBP" { "webp" } else { "riff" };
            }
            return family;
        }
    }
    // POSIX tar has its magic at offset 257, not 0.
    if head.len() > 262 && &head[257..262] == b"ustar" {
        return "tar";
    }

    let ct = crate::inspect::mime_of(content_type);
    if let Some(f) = by_content_type(&ct) {
        return f;
    }
    if let Some(f) = by_extension(filename) {
        return f;
    }

    let trimmed = &head[head.iter().take_while(|b| b.is_ascii_whitespace()).count()..];
    match trimmed.first() {
        Some(b'{') | Some(b'[') => return "json",
        Some(b'<') => return "xml",
        _ => {}
    }
    // No magic, no useful hint: text if it decodes cleanly with no NULs.
    // The head may end mid-character, so a truncated final sequence is fine.
    if !head.contains(&0) {
        match std::str::from_utf8(head) {
            Ok(_) => return "text",
            Err(e) if e.error_len().is_none() => return "text",
            Err(_) => {}
        }
    }
    "binary"
}

/// Tells a real OOXML document from a plain zip by the parts it contains.
pub fn zip_kind(data: &[u8]) -> Option<&'static str> {
    let archive = zip::ZipArchive::new(std::io::Cursor::new(data)).ok()?;
    let names: std::collections::HashSet<&str> = archive.file_names().collect();
    for (marker, kind) in [("word/document.xml", "docx"), ("xl/workbook.xml", "xlsx"), ("ppt/presentation.xml", "pptx")] {
        if names.contains(marker) {
            return Some(kind);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn magic_beats_the_declared_type() {
        assert_eq!(sniff_family(b"%PDF-1.7", "x.png", "image/png"), "pdf");
        assert_eq!(sniff_family(b"MZ\x90\x00\x03", "photo.png", "image/png"), "png");
        assert_eq!(sniff_family(b"PK\x03\x04", "", ""), "zip");
    }

    #[test]
    fn no_magic_falls_back_to_type_then_extension_then_shape() {
        assert_eq!(sniff_family(b"a,b\n1,2", "", "text/csv"), "csv");
        assert_eq!(sniff_family(b"a,b\n1,2", "x.csv", ""), "csv");
        assert_eq!(sniff_family(b"  {\"a\":1}", "", ""), "json");
        assert_eq!(sniff_family(b"<html>", "", ""), "xml");
        assert_eq!(sniff_family("hello \u{0928}".as_bytes(), "", ""), "text");
        assert_eq!(sniff_family(b"\x00\x01\x02", "", ""), "binary");
    }
}

//! Plain text, CSV/TSV, JSON, XML/HTML and form-encoded files — the
//! cheapest extractors: no recursion, no images, text segments only.

use super::{BudgetExceeded, Ctx, Item};
use quick_xml::events::Event;

/// Decodes bytes whose encoding isn't declared. Always returns a string:
/// UTF-8 when it is UTF-8, otherwise the most likely legacy encoding.
pub fn decode_best_effort(raw: &[u8]) -> String {
    if raw.is_empty() {
        return String::new();
    }
    if let Ok(s) = std::str::from_utf8(raw) {
        return s.to_string();
    }
    if raw.len() >= 2 && (raw[..2] == [0xFF, 0xFE] || raw[..2] == [0xFE, 0xFF]) {
        let enc = if raw[0] == 0xFF { encoding_rs::UTF_16LE } else { encoding_rs::UTF_16BE };
        return enc.decode(&raw[2..]).0.into_owned();
    }
    let mut det = chardetng::EncodingDetector::new();
    det.feed(&raw[..raw.len().min(64 * 1024)], true);
    det.guess(None, true).decode(raw).0.into_owned()
}

pub fn extract_text(data: &[u8], part: &str, filename: &str, mime: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    let mime = if mime.is_empty() { "text/plain" } else { mime };
    ctx.emit(Item::segment(part, filename, mime, "text", decode_best_effort(data)));
    Ok(())
}

pub fn extract_csv(data: &[u8], part: &str, filename: &str, mime: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    // Cells read fine as plain text for line/regex detectors; no reshaping.
    let mime = if mime.is_empty() { "text/csv" } else { mime };
    ctx.emit(Item::segment(part, filename, mime, "csv", decode_best_effort(data)));
    Ok(())
}

/// Every string (and key) in a JSON or NDJSON file, one per line. Raw JSON
/// bytes are escaped enough (\n, \", \uXXXX) that a value can hide from a
/// byte-level scan; the parsed string can't. Malformed JSON is still
/// scanned, as raw text.
pub fn extract_json(data: &[u8], part: &str, filename: &str, mime: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    let text = decode_best_effort(data);
    let mime = if mime.is_empty() { "application/json" } else { mime };

    let mut strings = Vec::new();
    let mut parsed_any = false;
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            walk_json(&v, &mut strings);
            parsed_any = true;
        }
    }
    if !parsed_any {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            walk_json(&v, &mut strings);
            parsed_any = true;
        }
    }
    if parsed_any && !strings.is_empty() {
        ctx.emit(Item::segment(part, filename, mime, "json", strings.join("\n")));
    } else {
        ctx.emit(Item::segment(part, filename, mime, "json_raw", text));
    }
    Ok(())
}

fn walk_json(v: &serde_json::Value, out: &mut Vec<String>) {
    use serde_json::Value;
    match v {
        Value::String(s) => out.push(s.clone()),
        Value::Object(map) => {
            for (k, child) in map {
                out.push(k.clone());
                walk_json(child, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|i| walk_json(i, out)),
        // A number in a data file is data — a card typed into a JSON export
        // is stored exactly like this.
        Value::Number(n) => out.push(n.to_string()),
        _ => {}
    }
}

pub fn extract_urlencoded(data: &[u8], part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    let pairs: Vec<String> = form_urlencoded::parse(data).map(|(k, v)| format!("{k}={v}")).collect();
    let text = if pairs.is_empty() { decode_best_effort(data) } else { pairs.join("\n") };
    ctx.emit(Item::segment(part, filename, "application/x-www-form-urlencoded", "urlencoded", text));
    Ok(())
}

pub fn extract_xml_or_html(data: &[u8], part: &str, filename: &str, mime: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    let mime = if mime.is_empty() { "text/html" } else { mime };
    let body = xml_text(data).unwrap_or_else(|| strip_tags(&decode_best_effort(data)));
    ctx.emit(Item::segment(part, filename, mime, "xml", body));
    Ok(())
}

/// Element text and attribute values of a well-formed XML document, or None
/// if it isn't well-formed (most real-world HTML). quick-xml never expands
/// external entities, so XXE is not possible here.
fn xml_text(data: &[u8]) -> Option<String> {
    let mut reader = quick_xml::Reader::from_reader(data);
    reader.config_mut().check_end_names = true;
    let mut out: Vec<String> = Vec::new();
    let mut buf = Vec::new();
    let mut depth = 0i64;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                depth += 1;
                push_attrs(&e, &mut out);
            }
            Ok(Event::Empty(e)) => push_attrs(&e, &mut out),
            Ok(Event::End(_)) => depth -= 1,
            Ok(Event::Text(t)) => {
                if let Ok(s) = t.unescape() {
                    let s = s.trim();
                    if !s.is_empty() {
                        out.push(s.to_string());
                    }
                }
            }
            Ok(Event::CData(t)) => {
                let s = String::from_utf8_lossy(&t).trim().to_string();
                if !s.is_empty() {
                    out.push(s);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return None,
        }
        buf.clear();
    }
    if depth != 0 || out.is_empty() {
        return None;
    }
    Some(out.join("\n"))
}

fn push_attrs(e: &quick_xml::events::BytesStart, out: &mut Vec<String>) {
    for a in e.attributes().flatten() {
        if let Ok(v) = a.unescape_value() {
            let v = v.trim();
            if !v.is_empty() {
                out.push(v.to_string());
            }
        }
    }
}

pub fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_latin1_and_utf16() {
        assert_eq!(decode_best_effort("naïve".as_bytes()), "naïve");
        let latin1 = [b'c', b'a', b'f', 0xE9];
        assert_eq!(decode_best_effort(&latin1), "café");
        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("hi".encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
        assert_eq!(decode_best_effort(&utf16), "hi");
    }

    #[test]
    fn xml_text_and_attributes() {
        let t = xml_text(br#"<a x="PAN ABCPD1234E"><b>card &amp; 4111</b></a>"#).unwrap();
        assert!(t.contains("PAN ABCPD1234E") && t.contains("card & 4111"));
        assert!(xml_text(b"<p>unclosed <b>html").is_none());
        assert_eq!(strip_tags("<p>hi <b>there</b></p>"), "hi there");
    }

    #[test]
    fn xml_does_not_expand_external_entities() {
        let xxe = br#"<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>"#;
        let out = xml_text(xxe).unwrap_or_default();
        assert!(!out.contains("root:"));
    }
}

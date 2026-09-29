//! RTF → plain text: control words and non-text destinations (font and
//! colour tables, embedded pictures, metadata, field instructions) are
//! dropped; \'hh escapes, \uN Unicode and paragraph breaks are kept.

use super::{text::decode_best_effort, BudgetExceeded, Ctx, Item};

/// Groups whose content is formatting data, not document text.
const IGNORED_DESTINATIONS: &[&str] = &[
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "themedata", "colorschememapping",
    "latentstyles", "datastore", "xmlnstbl", "listtable", "listoverridetable", "rsidtbl", "generator",
    "filetbl", "revtbl", "mmathpr", "pgdsctbl", "bkmkstart", "bkmkend", "fldinst", "docvar", "listtext",
    "pnseclvl", "wgrffmtfilter", "passwordhash", "blipuid", "shppict", "nonshppict",
];

pub fn extract(data: &[u8], part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    ctx.emit(Item::segment(part, filename, "application/rtf", "rtf", rtf_to_text(&decode_best_effort(data))));
    Ok(())
}

pub fn rtf_to_text(rtf: &str) -> String {
    #[derive(Clone, Copy)]
    struct Group {
        ignorable: bool,
        uc: usize,
    }
    let chars: Vec<char> = rtf.chars().collect();
    let mut out = String::with_capacity(rtf.len() / 2);
    let mut stack = vec![Group { ignorable: false, uc: 1 }];
    let mut skip_after_unicode = 0usize;
    let mut i = 0;
    let mut pending_bytes: Vec<u8> = Vec::new();

    let flush = |bytes: &mut Vec<u8>, out: &mut String| {
        if !bytes.is_empty() {
            out.push_str(&encoding_rs::WINDOWS_1252.decode(bytes).0);
            bytes.clear();
        }
    };

    while i < chars.len() {
        let c = chars[i];
        let cur = *stack.last().unwrap();
        match c {
            '{' => {
                flush(&mut pending_bytes, &mut out);
                stack.push(cur);
                i += 1;
            }
            '}' => {
                flush(&mut pending_bytes, &mut out);
                if stack.len() > 1 {
                    stack.pop();
                }
                i += 1;
            }
            '\\' => {
                i += 1;
                let Some(&n) = chars.get(i) else { break };
                if n == '\'' {
                    // \'hh — one byte in the document's code page.
                    let hex: String = chars.iter().skip(i + 1).take(2).collect();
                    i += 3;
                    if skip_after_unicode > 0 {
                        skip_after_unicode -= 1;
                        continue;
                    }
                    if let Ok(b) = u8::from_str_radix(&hex, 16) {
                        if !cur.ignorable {
                            pending_bytes.push(b);
                        }
                    }
                    continue;
                }
                flush(&mut pending_bytes, &mut out);
                if n.is_ascii_alphabetic() {
                    let start = i;
                    while i < chars.len() && chars[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word: String = chars[start..i].iter().collect::<String>().to_ascii_lowercase();
                    let num_start = i;
                    if i < chars.len() && chars[i] == '-' {
                        i += 1;
                    }
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                    let param: Option<i64> = chars[num_start..i].iter().collect::<String>().parse().ok();
                    if i < chars.len() && chars[i] == ' ' {
                        i += 1;
                    }
                    let top = stack.last_mut().unwrap();
                    if IGNORED_DESTINATIONS.contains(&word.as_str()) {
                        top.ignorable = true;
                        continue;
                    }
                    if top.ignorable {
                        continue;
                    }
                    match word.as_str() {
                        "par" | "line" | "sect" | "page" | "row" => out.push('\n'),
                        "tab" | "cell" => out.push('\t'),
                        "emdash" => out.push('—'),
                        "endash" => out.push('–'),
                        "bullet" => out.push('•'),
                        "lquote" => out.push('‘'),
                        "rquote" => out.push('’'),
                        "ldblquote" => out.push('“'),
                        "rdblquote" => out.push('”'),
                        "uc" => top.uc = param.unwrap_or(1).max(0) as usize,
                        "u" => {
                            if let Some(p) = param {
                                let code = if p < 0 { p + 65536 } else { p } as u32;
                                if let Some(ch) = char::from_u32(code) {
                                    out.push(ch);
                                }
                                skip_after_unicode = top.uc;
                            }
                        }
                        _ => {}
                    }
                } else {
                    i += 1;
                    let top = stack.last_mut().unwrap();
                    match n {
                        '*' => top.ignorable = true,
                        '\\' | '{' | '}' if !top.ignorable => out.push(n),
                        '~' if !top.ignorable => out.push('\u{a0}'),
                        '_' if !top.ignorable => out.push('-'),
                        '\n' | '\r' if !top.ignorable => out.push('\n'),
                        _ => {}
                    }
                }
            }
            '\r' | '\n' => i += 1,
            _ => {
                i += 1;
                if skip_after_unicode > 0 {
                    skip_after_unicode -= 1;
                    continue;
                }
                flush(&mut pending_bytes, &mut out);
                if !cur.ignorable {
                    out.push(c);
                }
            }
        }
    }
    flush(&mut pending_bytes, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_survives_and_tables_do_not() {
        let rtf = r"{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\colortbl;\red0;}\f0 Card 4111 1111 1111 1111\par PAN ABCPD1234E\par caf\'e9 \u9992? ok}";
        let t = rtf_to_text(rtf);
        assert!(t.contains("Card 4111 1111 1111 1111"));
        assert!(t.contains("PAN ABCPD1234E"));
        assert!(t.contains("café"));
        assert!(t.contains('✈'));
        assert!(!t.contains("Arial"));
        assert!(!t.contains('?'));
    }
}

//! DOCX / XLSX / PPTX, read as what they are — a zip of XML parts — rather
//! than through a document model. Only the parts that hold text are read,
//! so a 300 MB workbook never has to exist as objects in memory. Embedded
//! media is handed on as images.

use super::{images, BudgetExceeded, Ctx, Item};
use quick_xml::events::Event;
use std::io::{Cursor, Read};

type Archive<'d> = zip::ZipArchive<Cursor<&'d [u8]>>;

const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

pub fn extract(data: &[u8], part: &str, filename: &str, kind: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    let Ok(mut zf) = zip::ZipArchive::new(Cursor::new(data)) else {
        ctx.emit(Item::unscannable(part, "corrupt", "not a valid OOXML container"));
        return Ok(());
    };
    match kind {
        "docx" => docx(&mut zf, part, filename, ctx)?,
        "xlsx" => xlsx(&mut zf, part, filename, ctx)?,
        "pptx" => pptx(&mut zf, part, filename, ctx)?,
        _ => {}
    }
    media_images(&mut zf, part, ctx)
}

fn read_entry(zf: &mut Archive, name: &str, ctx: &mut Ctx) -> Result<Option<Vec<u8>>, BudgetExceeded> {
    let Ok(mut f) = zf.by_name(name) else { return Ok(None) };
    ctx.check_budget(f.size())?;
    let mut buf = Vec::with_capacity(f.size().min(64 << 20) as usize);
    if f.read_to_end(&mut buf).is_err() {
        return Ok(None);
    }
    Ok(Some(buf))
}

fn sorted_names(zf: &Archive, keep: impl Fn(&str) -> bool) -> Vec<String> {
    let mut names: Vec<String> = zf.file_names().filter(|n| keep(n)).map(str::to_string).collect();
    // sheet10 after sheet9, not after sheet1.
    names.sort_by_key(|n| {
        let digits: String = n.chars().filter(|c| c.is_ascii_digit()).collect();
        (digits.parse::<u64>().unwrap_or(0), n.clone())
    });
    names
}

fn local(name: &[u8]) -> &[u8] {
    match name.iter().rposition(|&b| b == b':') {
        Some(i) => &name[i + 1..],
        None => name,
    }
}

/// Text of every element whose local name is `tag` (w:t, a:t, t).
fn texts_of(xml: &[u8], tag: &[u8]) -> Vec<String> {
    let mut reader = quick_xml::Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut out = Vec::new();
    let mut inside = 0usize;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) if local(e.name().as_ref()) == tag => inside += 1,
            Ok(Event::End(e)) if local(e.name().as_ref()) == tag => inside = inside.saturating_sub(1),
            Ok(Event::Text(t)) if inside > 0 => {
                if let Ok(s) = t.unescape() {
                    out.push(s.into_owned());
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

fn docx(zf: &mut Archive, part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    let names = sorted_names(zf, |n| {
        ["word/document", "word/header", "word/footer", "word/footnotes", "word/endnotes"].iter().any(|p| n.starts_with(p))
            && n.ends_with(".xml")
    });
    let mut texts = Vec::new();
    for name in names {
        if let Some(xml) = read_entry(zf, &name, ctx)? {
            texts.extend(texts_of(&xml, b"t"));
        }
    }
    ctx.emit(Item::segment(part, filename, DOCX_MIME, "docx", texts.join("\n")));
    Ok(())
}

fn xlsx(zf: &mut Archive, part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    let shared = match read_entry(zf, "xl/sharedStrings.xml", ctx)? {
        Some(xml) => shared_strings(&xml),
        None => Vec::new(),
    };
    for sheet in sorted_names(zf, |n| n.starts_with("xl/worksheets/sheet") && n.ends_with(".xml")) {
        if ctx.stopped() {
            break;
        }
        let Some(xml) = read_entry(zf, &sheet, ctx)? else { continue };
        let label = sheet.rsplit('/').next().unwrap_or(&sheet).trim_end_matches(".xml");
        ctx.emit(Item::segment(&format!("{part}!{label}"), filename, XLSX_MIME, "xlsx", sheet_cells(&xml, &shared).join("\n")));
    }
    Ok(())
}

/// One entry per <si>, its runs concatenated — shared-string indexes point
/// at <si> items, not at individual <t> runs.
fn shared_strings(xml: &[u8]) -> Vec<String> {
    let mut reader = quick_xml::Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    let mut in_t = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match local(e.name().as_ref()) {
                b"si" => current = Some(String::new()),
                b"t" => in_t = true,
                _ => {}
            },
            Ok(Event::Empty(e)) if local(e.name().as_ref()) == b"si" => out.push(String::new()),
            Ok(Event::End(e)) => match local(e.name().as_ref()) {
                b"si" => out.push(current.take().unwrap_or_default()),
                b"t" => in_t = false,
                _ => {}
            },
            Ok(Event::Text(t)) if in_t => {
                if let (Some(cur), Ok(s)) = (current.as_mut(), t.unescape()) {
                    cur.push_str(&s);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

/// Every cell's value: shared strings resolved, inline strings read, and
/// numbers kept — a card number typed into a cell is stored as a number.
fn sheet_cells(xml: &[u8], shared: &[String]) -> Vec<String> {
    let mut reader = quick_xml::Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut out = Vec::new();
    let mut cell_type: Option<String> = None;
    let mut in_v = false;
    let mut in_inline_t = false;
    let mut in_is = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match local(e.name().as_ref()) {
                b"c" => {
                    cell_type = e
                        .attributes()
                        .flatten()
                        .find(|a| a.key.as_ref() == b"t")
                        .map(|a| String::from_utf8_lossy(&a.value).into_owned());
                }
                b"v" => in_v = true,
                b"is" => in_is = true,
                b"t" if in_is => in_inline_t = true,
                _ => {}
            },
            Ok(Event::End(e)) => match local(e.name().as_ref()) {
                b"v" => in_v = false,
                b"is" => in_is = false,
                b"t" => in_inline_t = false,
                b"c" => cell_type = None,
                _ => {}
            },
            Ok(Event::Text(t)) => {
                let s = t.unescape().unwrap_or_default();
                if in_v {
                    if cell_type.as_deref() == Some("s") {
                        if let Some(v) = s.trim().parse::<usize>().ok().and_then(|i| shared.get(i)) {
                            out.push(v.clone());
                        }
                    } else {
                        out.push(s.into_owned());
                    }
                } else if in_inline_t {
                    out.push(s.into_owned());
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

fn pptx(zf: &mut Archive, part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    for slide in sorted_names(zf, |n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml")) {
        if ctx.stopped() {
            break;
        }
        let Some(xml) = read_entry(zf, &slide, ctx)? else { continue };
        let label = slide.rsplit('/').next().unwrap_or(&slide).trim_end_matches(".xml");
        ctx.emit(Item::segment(&format!("{part}!{label}"), filename, PPTX_MIME, "pptx", texts_of(&xml, b"t").join("\n")));
    }
    Ok(())
}

const IMAGE_EXTS: &[&str] = &[".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp"];

fn media_images(zf: &mut Archive, part: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    let media = sorted_names(zf, |n| n.contains("/media/") && IMAGE_EXTS.iter().any(|e| n.to_ascii_lowercase().ends_with(e)));
    for name in media {
        if ctx.stopped() || !ctx.images_budget_remaining() {
            break;
        }
        let Some(data) = read_entry(zf, &name, ctx)? else { continue };
        let img_part = format!("{part}!{name}");
        if let Some(img) = images::to_image_item(&data, &img_part, ctx, images::OcrBudget::Image) {
            ctx.images_emitted += 1;
            let ocr = img.ocr_text.clone();
            ctx.emit(Item::Image(img));
            if !ocr.is_empty() {
                ctx.emit(Item::segment(&img_part, &name, "image", "ocr", ocr));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_strings_join_runs_per_item() {
        let xml = br#"<sst><si><t>plain</t></si><si><r><t>rich </t></r><r><t>text</t></r></si><si/></sst>"#;
        assert_eq!(shared_strings(xml), vec!["plain", "rich text", ""]);
    }

    #[test]
    fn sheet_cells_resolve_shared_inline_and_numbers() {
        let shared = vec!["Name".to_string(), "Card".to_string()];
        let xml = br#"<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
            <row><c r="A2" t="inlineStr"><is><t>Asha</t></is></c><c r="B2"><v>4111111111111111</v></c></row></sheetData></worksheet>"#;
        assert_eq!(sheet_cells(xml, &shared), vec!["Name", "Card", "Asha", "4111111111111111"]);
    }

    #[test]
    fn docx_text_runs() {
        let xml = br#"<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>PAN ABCPD1234E</w:t></w:r></w:p><w:tbl><w:t>x</w:t></w:tbl></w:body></w:document>"#;
        assert_eq!(texts_of(xml, b"t"), vec!["PAN ABCPD1234E", "x"]);
    }
}

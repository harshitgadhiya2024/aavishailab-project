//! Extraction against real files of every supported format, built here in
//! the test so nothing binary is checked in. PDF and OCR cases need the
//! pdfium library (PDFIUM_LIB_PATH) and the tesseract binary; they are
//! skipped with a note when either is missing.

use dlp_service::extract::{self, Item, Limits};
use std::io::{Cursor, Write};

const CARD: &str = "4111 1111 1111 1111";

fn run_with(data: &[u8], filename: &str, content_type: &str, limits: &Limits) -> Vec<Item> {
    let mut items = Vec::new();
    let mut emit = |i: Item| {
        items.push(i);
        true
    };
    {
        let mut ctx = extract::Ctx::new(limits, data.len() as u64, &mut emit);
        extract::extract(data, filename, content_type, &mut ctx);
    }
    items
}

fn run(data: &[u8], filename: &str) -> Vec<Item> {
    run_with(data, filename, "", &Limits::default())
}

fn all_text(items: &[Item]) -> String {
    items
        .iter()
        .filter_map(|i| match i {
            Item::Segment(s) => Some(s.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn unscannable(items: &[Item]) -> Vec<&'static str> {
    items
        .iter()
        .filter_map(|i| match i {
            Item::Unscannable(u) => Some(u.reason),
            _ => None,
        })
        .collect()
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in entries {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn docx(text: &str) -> Vec<u8> {
    let doc = format!(r#"<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"#);
    zip_of(&[("[Content_Types].xml", b"<Types/>"), ("word/document.xml", doc.as_bytes())])
}

#[test]
fn docx_text_is_found() {
    let items = run(&docx(&format!("Corporate card {CARD}")), "notes.docx");
    assert!(all_text(&items).contains(CARD), "{items:?}");
}

#[test]
fn xlsx_cells_shared_inline_and_numeric() {
    let sst = br#"<sst xmlns="x"><si><t>Employee</t></si><si><t>Salary</t></si></sst>"#;
    let sheet = br#"<worksheet xmlns="x"><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="inlineStr"><is><t>Asha</t></is></c><c><v>4111111111111111</v></c></row></sheetData></worksheet>"#;
    let x = zip_of(&[("xl/workbook.xml", b"<workbook/>"), ("xl/sharedStrings.xml", sst), ("xl/worksheets/sheet1.xml", sheet)]);
    let t = all_text(&run(&x, "payroll.xlsx"));
    for want in ["Employee", "Salary", "Asha", "4111111111111111"] {
        assert!(t.contains(want), "{want} missing from {t:?}");
    }
}

#[test]
fn pptx_slides() {
    let slide = br#"<p:sld xmlns:p="p" xmlns:a="a"><a:t>PAN ABCPD1234E</a:t></p:sld>"#;
    let x = zip_of(&[("ppt/presentation.xml", b"<p/>"), ("ppt/slides/slide1.xml", slide)]);
    assert!(all_text(&run(&x, "deck.pptx")).contains("ABCPD1234E"));
}

#[test]
fn nested_archives_reach_the_document() {
    let inner = zip_of(&[("hr/salaries.docx", &docx(&format!("card {CARD}")))]);
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&inner).unwrap();
    let gz = gz.finish().unwrap();
    let mut tar = tar::Builder::new(Vec::new());
    let mut h = tar::Header::new_gnu();
    h.set_size(gz.len() as u64);
    h.set_mode(0o644);
    h.set_cksum();
    tar.append_data(&mut h, "bundle.zip.gz", gz.as_slice()).unwrap();
    let tarball = tar.into_inner().unwrap();

    let items = run(&tarball, "export.tar");
    assert!(all_text(&items).contains(CARD), "{items:?}");
    let seg = items.iter().find_map(|i| match i {
        Item::Segment(s) if s.text.contains(CARD) => Some(s),
        _ => None,
    });
    assert_eq!(seg.unwrap().part, "export.tar!bundle.zip.gz!bundle.zip!hr/salaries.docx");
}

#[test]
fn seven_zip_plain_and_encrypted() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("secret.txt"), format!("card {CARD}")).unwrap();
    let plain = sevenz_rust2::compress(dir.path(), Cursor::new(Vec::new())).unwrap().into_inner();
    assert!(all_text(&run(&plain, "a.7z")).contains(CARD));

    let enc = sevenz_rust2::compress_encrypted(dir.path(), Cursor::new(Vec::new()), "pw".into()).unwrap().into_inner();
    let items = run(&enc, "b.7z");
    assert!(!all_text(&items).contains(CARD));
    assert!(unscannable(&items).contains(&"encrypted_archive"), "{items:?}");
}

#[test]
fn encrypted_zip_entry_is_reported() {
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().with_aes_encryption(zip::AesMode::Aes256, "pw");
    w.start_file("keys.txt", opts).unwrap();
    w.write_all(b"AKIAZ7XQ3W5R2TLKM4NB").unwrap();
    let z = w.finish().unwrap().into_inner();
    assert_eq!(unscannable(&run(&z, "vault.zip")), vec!["encrypted_archive"]);
}

#[test]
fn archive_bombs_and_deep_nesting_are_bounded() {
    let zeros = vec![0u8; 50 * 1024 * 1024];
    let bomb = zip_of(&[("zeros.bin", &zeros)]);
    let reasons = unscannable(&run(&bomb, "bomb.zip"));
    assert!(reasons.contains(&"expansion_ratio_exceeded") || reasons.contains(&"total_bytes_exceeded"), "{reasons:?}");

    let mut nested = docx("deep");
    for i in 0..7 {
        nested = zip_of(&[(&format!("level{i}.zip"), &nested)]);
    }
    let items = run(&nested, "deep.zip");
    assert!(unscannable(&items).contains(&"too_deep"), "{items:?}");
}

#[test]
fn rar_is_unsupported_not_ignored() {
    assert_eq!(unscannable(&run(b"Rar!\x1a\x07\x01\x00junk", "x.rar")), vec!["unsupported_archive"]);
}

#[test]
fn outlook_msg_body_and_subject() {
    let mut cf = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    let utf16 = |s: &str| s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect::<Vec<u8>>();
    cf.create_stream("/__substg1.0_1000001F").unwrap().write_all(&utf16(&format!("Please charge {CARD}"))).unwrap();
    cf.create_stream("/__substg1.0_0037001F").unwrap().write_all(&utf16("Payment details")).unwrap();
    let msg = cf.into_inner().into_inner();
    let t = all_text(&run(&msg, "mail.msg"));
    assert!(t.contains(CARD) && t.contains("Payment details"), "{t:?}");
}

#[test]
fn password_protected_office_file_is_reported() {
    let mut cf = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    cf.create_stream("/EncryptionInfo").unwrap().write_all(b"x").unwrap();
    cf.create_stream("/EncryptedPackage").unwrap().write_all(b"y").unwrap();
    let f = cf.into_inner().into_inner();
    assert_eq!(unscannable(&run(&f, "locked.docx")), vec!["encrypted_document"]);
}

#[test]
fn legacy_doc_text_runs() {
    let mut cf = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    let mut body = vec![0u8, 1, 2];
    body.extend_from_slice(b"Aadhaar 2341 2341 2346 on file");
    cf.create_stream("/WordDocument").unwrap().write_all(&body).unwrap();
    let f = cf.into_inner().into_inner();
    assert!(all_text(&run(&f, "old.doc")).contains("Aadhaar 2341 2341 2346"));
}

#[test]
fn email_body_and_attachment() {
    use base64::Engine;
    let att = base64::engine::general_purpose::STANDARD.encode(docx(&format!("card {CARD}")));
    let eml = format!(
        "From: a@x.com\r\nTo: b@y.com\r\nSubject: hi\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"B\"\r\n\r\n\
         --B\r\nContent-Type: text/plain\r\n\r\nPAN ABCPD1234E attached\r\n\
         --B\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name=\"cards.docx\"\r\n\
         Content-Disposition: attachment; filename=\"cards.docx\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{att}\r\n--B--\r\n"
    );
    let items = run(eml.as_bytes(), "thread.eml");
    let t = all_text(&items);
    assert!(t.contains("PAN ABCPD1234E"), "{t:?}");
    assert!(t.contains(CARD), "{items:?}");
}

#[test]
fn rtf_json_csv_html_text() {
    assert!(all_text(&run(br"{\rtf1\ansi card 4111 1111 1111 1111\par}", "a.rtf")).contains(CARD));
    let j = all_text(&run(br#"{"rows":[{"name":"A","card":"4111 1111 1111 1111"}]}"#, "a.json"));
    assert!(j.contains(CARD));
    assert!(all_text(&run(b"name,card\nA,4111 1111 1111 1111\n", "a.csv")).contains(CARD));
    assert!(all_text(&run(b"<html><body><p>card 4111 1111 1111 1111<br></body></html>", "a.html")).contains(CARD));
}

#[test]
fn multipart_file_parts_are_extracted_and_plumbing_fields_skipped() {
    let body = [
        b"--X\r\nContent-Disposition: form-data; name=\"csrf_token\"\r\n\r\nabcdefabcdefabcdefabcdef1234\r\n".to_vec(),
        b"--X\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nquarterly numbers\r\n".to_vec(),
        b"--X\r\nContent-Disposition: form-data; name=\"file\"; filename=\"c.docx\"\r\nContent-Type: application/octet-stream\r\n\r\n".to_vec(),
        docx(&format!("card {CARD}")),
        b"\r\n--X--\r\n".to_vec(),
    ]
    .concat();
    let items = run_with(&body, "", "multipart/form-data; boundary=X", &Limits::default());
    let t = all_text(&items);
    assert!(t.contains(CARD) && t.contains("quarterly numbers"), "{items:?}");
    assert!(!t.contains("abcdefabcdef"), "csrf token must not be scanned: {t:?}");
    let docx_seg = items.iter().find_map(|i| match i {
        Item::Segment(s) if s.text.contains(CARD) => Some(s.filename.clone()),
        _ => None,
    });
    assert_eq!(docx_seg.as_deref(), Some("c.docx"));
}

#[test]
fn a_false_emit_stops_the_walk() {
    let z = zip_of(&[("a.txt", b"one"), ("b.txt", b"two"), ("c.txt", b"three")]);
    let limits = Limits::default();
    let mut seen = 0;
    let mut emit = |_i: Item| {
        seen += 1;
        false
    };
    {
        let mut ctx = extract::Ctx::new(&limits, z.len() as u64, &mut emit);
        extract::extract(&z, "x.zip", "", &mut ctx);
    }
    assert_eq!(seen, 1);
}

// ─── PDF and OCR (need pdfium + tesseract) ──────────────────────────────────

fn tesseract_available() -> bool {
    std::process::Command::new("tesseract").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

/// A one-page PDF whose only content is `text` in Helvetica.
fn text_pdf(text: &str) -> Vec<u8> {
    let stream = format!("BT /F1 28 Tf 40 700 Td ({text}) Tj ET");
    let objs = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_string(),
        format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
    }
    let xref = out.len();
    out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for off in offsets {
        out.extend(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
    out
}

fn pdfium() -> Option<&'static pdfium_render::prelude::Pdfium> {
    dlp_service::extract::pdf::pdfium()
}

/// The text PDF rendered to a picture — what a phone photo or a scanner
/// produces: pixels only, no text layer.
fn picture_of(text: &str) -> Option<image::DynamicImage> {
    use pdfium_render::prelude::*;
    let pdfium = pdfium()?;
    let bytes = text_pdf(text);
    let doc = pdfium.load_pdf_from_byte_slice(&bytes, None).ok()?;
    let page = doc.pages().first().ok()?;
    let img = page.render_with_config(&PdfRenderConfig::new().scale_page_by_factor(200.0 / 72.0)).ok()?.as_image().ok()?;
    // Crop to the text band so the picture looks like a photographed card.
    Some(img.crop_imm(0, 150, img.width(), 250))
}

#[test]
fn pdf_text_layer() {
    if !dlp_service::extract::pdf::available() {
        eprintln!("skipped: PDFIUM_LIB_PATH not set");
        return;
    }
    let items = run(&text_pdf("Card 4111 1111 1111 1111"), "statement.pdf");
    assert!(all_text(&items).contains(CARD), "{items:?}");
}

#[test]
fn photographed_card_image_is_ocrd() {
    if !tesseract_available() {
        eprintln!("skipped: tesseract not installed");
        return;
    }
    let Some(pic) = picture_of("Card 4111 1111 1111 1111") else {
        eprintln!("skipped: PDFIUM_LIB_PATH not set");
        return;
    };
    let mut png = Vec::new();
    pic.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
    let items = run(&png, "photo.png");
    assert!(items.iter().any(|i| matches!(i, Item::Image(_))), "an image item for the vision classifier");
    let ocr: String = items
        .iter()
        .filter_map(|i| match i {
            Item::Segment(s) if s.source == "ocr" => Some(s.text.clone()),
            _ => None,
        })
        .collect();
    assert!(ocr.replace(' ', "").contains("4111111111111111"), "OCR text: {ocr:?}");
}

#[test]
fn scanned_pdf_page_is_ocrd() {
    use pdfium_render::prelude::*;
    if !tesseract_available() || !dlp_service::extract::pdf::available() {
        eprintln!("skipped: tesseract or pdfium missing");
        return;
    }
    let pic = picture_of("Aadhaar 2341 2341 2346").unwrap();
    let pdfium = pdfium().unwrap();
    let mut doc = pdfium.create_new_pdf().unwrap();
    let mut page = doc.pages_mut().create_page_at_end(PdfPagePaperSize::a4()).unwrap();
    let obj = PdfPageImageObject::new_with_width(&doc, &pic, PdfPoints::new(500.0)).unwrap();
    page.objects_mut().add_image_object(obj).unwrap();
    let scanned = doc.save_to_bytes().unwrap();

    let items = run(&scanned, "scan.pdf");
    let ocr: String = items
        .iter()
        .filter_map(|i| match i {
            Item::Segment(s) if s.source == "ocr" => Some(s.text.clone()),
            _ => None,
        })
        .collect();
    assert!(ocr.contains("2341 2341 2346"), "OCR text: {ocr:?} / items: {items:?}");
}

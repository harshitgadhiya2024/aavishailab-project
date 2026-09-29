//! RFC 822 email (.eml). Headers and inline text bodies are scanned as
//! text; every attachment (a PDF, a DOCX, another email…) goes back through
//! the dispatcher and gets exactly what a direct upload of it would.

use super::{dispatch, BudgetExceeded, Ctx, Item};
use mail_parser::{MessageParser, MimeHeaders, PartType};

pub fn extract(data: &[u8], part: &str, filename: &str, ctx: &mut Ctx) -> Result<(), BudgetExceeded> {
    ctx.check_budget(data.len() as u64)?;
    let Some(msg) = MessageParser::default().parse(data) else {
        ctx.emit(Item::unscannable(part, "corrupt", "not a parseable email"));
        return Ok(());
    };

    let header_end = find(data, b"\r\n\r\n").or_else(|| find(data, b"\n\n")).unwrap_or(data.len());
    let headers = String::from_utf8_lossy(&data[..header_end]).into_owned();
    if !ctx.emit(Item::segment(&format!("{part}!headers"), filename, "message/rfc822", "eml_headers", headers)) {
        return Ok(());
    }

    for (seq, p) in msg.parts.iter().enumerate() {
        if ctx.stopped() {
            break;
        }
        let name = p.attachment_name().map(str::to_string);
        let mime = p
            .content_type()
            .map(|ct| match ct.subtype() {
                Some(sub) => format!("{}/{}", ct.ctype(), sub),
                None => ct.ctype().to_string(),
            })
            .unwrap_or_default()
            .to_ascii_lowercase();
        let sub_name = name.clone().unwrap_or_else(|| format!("part{}", seq + 1));
        let sub_part = format!("{part}!{sub_name}");
        match &p.body {
            PartType::Multipart(_) => continue,
            // An inline body, not an attachment: text as-is.
            PartType::Text(t) | PartType::Html(t) if name.is_none() => {
                ctx.check_budget(t.len() as u64)?;
                ctx.emit(Item::segment(&sub_part, filename, &mime, "eml_body", t.to_string()));
            }
            _ => {
                let payload = p.contents();
                ctx.check_budget(payload.len() as u64)?;
                let mime = if matches!(p.body, PartType::Message(_)) { "message/rfc822".to_string() } else { mime };
                ctx.nested(&sub_part, |c| dispatch(payload, &sub_part, &sub_name, &mime, c));
            }
        }
    }
    Ok(())
}

fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    h.windows(n.len()).position(|w| w == n)
}

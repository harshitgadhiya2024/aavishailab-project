//! The page an employee actually sees when something is blocked.
//!
//! Two things this module exists for, both of which the previous inline
//! `format!` got wrong:
//!
//! 1. **It is the company's page, not ours.** The org's name, logo and its
//!    own message come from the server (`/internal/agent/branding`) and are
//!    cached here. A block page that says "Aavishield" to an employee who
//!    has never heard of Aavishield reads like malware; one that carries
//!    their employer's name reads like policy.
//!
//! 2. **Everything interpolated is escaped.** `domain` and `reason` reach
//!    this from the network and from server-supplied policy text. The
//!    previous version substituted both raw into HTML, so a host like
//!    `x.com/<script>…` rendered as live markup in a page served from the
//!    blocked origin's own security context. Escaping happens here, once,
//!    rather than at each of the four call sites.

use crate::http_client::AgentClient;
use serde::Deserialize;
use std::sync::Arc;
use std::sync::RwLock;
use std::time::Duration;

/// Branding changes about as often as a company rebrands. Re-read on the
/// same cadence as the MITM config so the two org-level fetches stay
/// together rather than adding another independent timer.
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Branding {
    /// The employer's name. Empty until the first successful fetch, which is
    /// why `render` falls back to neutral wording rather than a placeholder.
    #[serde(default)]
    pub company_name: String,
    #[serde(default)]
    pub logo_url: String,
    /// Optional message the company writes itself — "raise a ticket in
    /// ServiceNow", "ask #it-helpdesk". Replaces the generic closing line.
    #[serde(default)]
    pub message: String,
    /// Who to contact. Rendered as a mailto when it looks like an address.
    #[serde(default)]
    pub support_contact: String,
}

pub struct BrandingCache {
    client: AgentClient,
    current: RwLock<Branding>,
}

impl BrandingCache {
    pub fn new(client: AgentClient) -> Self {
        Self { client, current: RwLock::new(Branding::default()) }
    }

    pub fn get(&self) -> Branding {
        self.current.read().map(|b| b.clone()).unwrap_or_default()
    }

    pub async fn refresh(&self) {
        let Ok(resp) = self.client.get("/internal/agent/branding").await else { return };
        if !resp.status().is_success() {
            return;
        }
        match resp.json::<Branding>().await {
            Ok(branding) => {
                if let Ok(mut slot) = self.current.write() {
                    *slot = branding;
                }
            }
            Err(e) => tracing::debug!(error = %e, "branding response unparseable"),
        }
    }

    pub async fn loop_refresh(self: Arc<Self>, interval: Duration) {
        loop {
            tokio::time::sleep(interval).await;
            self.refresh().await;
        }
    }
}

/// Minimal HTML-text escaping.
///
/// Covers the five characters that can break out of either element text or a
/// double/single-quoted attribute value, which is every context this module
/// interpolates into. Deliberately hand-rolled rather than pulling a crate in
/// for five replacements in a file that is otherwise dependency-light.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Renders the block page.
///
/// `category` is the kind of block ("Data Loss Prevention", "Malware
/// Protection", a URL category) and is shown as supporting detail rather than
/// the headline — the employee's first question is "why can't I open this",
/// not "which subsystem stopped it".
pub fn render(branding: &Branding, domain: &str, reason: &str, category: &str) -> String {
    let company = escape(&branding.company_name);
    let domain = escape(domain);
    let reason = escape(reason);
    let category = escape(category);

    let heading = if company.is_empty() {
        "Access blocked".to_string()
    } else {
        format!("Blocked by {company}")
    };

    let logo = if branding.logo_url.is_empty() {
        String::new()
    } else {
        // Sized rather than free-floating so a large source image can't push
        // the card off-screen on a small display.
        format!(
            "<img src=\"{}\" alt=\"{}\" style=\"max-height:44px;max-width:180px;margin-bottom:20px\">",
            escape(&branding.logo_url),
            if company.is_empty() { "Company logo".to_string() } else { company.clone() }
        )
    };

    let closing = if branding.message.is_empty() {
        "If you believe this is a mistake, contact your IT administrator.".to_string()
    } else {
        escape(&branding.message)
    };

    let contact = if branding.support_contact.is_empty() {
        String::new()
    } else {
        let c = escape(&branding.support_contact);
        if branding.support_contact.contains('@') && !branding.support_contact.contains(' ') {
            format!("<p style=\"margin:12px 0 0\"><a href=\"mailto:{c}\" style=\"color:#0048A0\">{c}</a></p>")
        } else {
            format!("<p style=\"margin:12px 0 0;color:#555\">{c}</p>")
        }
    };

    let footer = if company.is_empty() {
        "Your organization's security policy".to_string()
    } else {
        format!("{company} security policy")
    };

    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{heading}</title></head>\
<body style=\"margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f0f4fa;\
display:flex;align-items:center;justify-content:center;min-height:100vh\">\
<main style=\"background:#fff;border-radius:12px;padding:48px 40px;max-width:480px;width:90%;\
box-shadow:0 4px 24px rgba(0,72,160,.12);text-align:center\">\
{logo}\
<h1 style=\"color:#0048A0;font-size:22px;margin:0 0 12px\">{heading}</h1>\
<p style=\"color:#555;line-height:1.6;margin:0 0 20px\">This site is not permitted on this device.</p>\
<div style=\"background:#f0f4fa;border-radius:8px;padding:14px 16px;margin:0 0 20px;\
font-size:14px;color:#333;text-align:left\">\
<div><strong>Site:</strong> {domain}</div>\
<div style=\"margin-top:6px\"><strong>Reason:</strong> {reason}</div>\
<div style=\"margin-top:6px\"><strong>Category:</strong> {category}</div>\
</div>\
<p style=\"color:#555;line-height:1.6;margin:0\">{closing}</p>{contact}\
<p style=\"margin-top:28px;font-size:12px;color:#999\">{footer}</p>\
</main></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn branded() -> Branding {
        Branding {
            company_name: "Acme Corp".into(),
            logo_url: "https://cdn.example.com/acme.png".into(),
            message: "Raise a ticket in ServiceNow.".into(),
            support_contact: "it@acme.com".into(),
        }
    }

    #[test]
    fn test_renders_the_company_name_not_the_vendor_name() {
        let html = render(&branded(), "chatgpt.com", "Not approved", "AI tools");
        assert!(html.contains("Blocked by Acme Corp"));
        assert!(html.contains("Acme Corp security policy"));
        assert!(!html.contains("Aavishield"));
    }

    #[test]
    fn test_falls_back_to_neutral_wording_before_branding_arrives() {
        let html = render(&Branding::default(), "chatgpt.com", "Not approved", "AI tools");
        assert!(html.contains("Access blocked"));
        // Our own static text, interpolated as-is — only untrusted values are escaped.
        assert!(html.contains("Your organization's security policy"));
        assert!(!html.contains("<img"));
    }

    /// The regression this module was written for: a hostile or merely odd
    /// host/reason must never reach the page as live markup.
    #[test]
    fn test_escapes_every_interpolated_field() {
        let html = render(
            &Branding::default(),
            "evil.com/<script>alert(1)</script>",
            "<img src=x onerror=alert(2)>",
            "a\"b",
        );
        assert!(!html.contains("<script>alert(1)"));
        assert!(!html.contains("<img src=x"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("a&quot;b"));
    }

    #[test]
    fn test_escapes_company_supplied_branding_too() {
        let branding = Branding {
            company_name: "Acme <b>Corp</b>".into(),
            logo_url: "https://x/\"onerror=\"alert(1)".into(),
            ..Default::default()
        };
        let html = render(&branding, "x.com", "r", "c");
        assert!(!html.contains("<b>Corp</b>"));
        assert!(!html.contains("\"onerror=\""));
    }

    #[test]
    fn test_support_contact_becomes_a_mailto_only_when_it_is_an_address() {
        let html = render(&branded(), "x.com", "r", "c");
        assert!(html.contains("mailto:it@acme.com"));

        let mut b = branded();
        b.support_contact = "Ask the IT desk on floor 3".into();
        let html = render(&b, "x.com", "r", "c");
        assert!(!html.contains("mailto:"));
        assert!(html.contains("Ask the IT desk on floor 3"));
    }

    #[test]
    fn test_custom_message_replaces_the_generic_closing_line() {
        let html = render(&branded(), "x.com", "r", "c");
        assert!(html.contains("Raise a ticket in ServiceNow."));
        assert!(!html.contains("contact your IT administrator"));
    }
}

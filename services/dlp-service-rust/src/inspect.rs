//! Decides whether an intercepted outbound request is something a *person*
//! sent — and if so, what they sent — before any detector runs.
//!
//! The endpoint agent hands over every POST/PUT/PATCH body its proxy sees.
//! Almost all of that is not a person sending anything: analytics beacons,
//! error reporters, anti-bot challenges, a Google Doc polling for changes, a
//! chat app refreshing presence. Scanning those bodies wholesale is what
//! filled the DLP log with "Credit Card Number" hits on 16-digit record ids
//! and "credentials" verdicts on session tokens (found in production: 126 of
//! 126 incidents on one org were background traffic, none a real upload).
//!
//! So nothing is scanned unless the request carries a positive sign of a
//! user action:
//!   - a real file (a multipart part with a filename, or a body that *is* a
//!     document/image/archive by content type or magic bytes);
//!   - a known "send" endpoint (email, chat message, AI prompt, comment,
//!     cloud-storage upload);
//!   - a form the person submitted by navigating (Sec-Fetch-Mode: navigate).
//!
//! For the text cases only the human-written values are scanned — JSON and
//! form fields named like ids, tokens, hashes or timestamps are dropped, and
//! JSON numbers never are text a person typed.

use serde::Serialize;

pub const OP_EMAIL_SENT: &str = "Email sent";
pub const OP_MESSAGE_SENT: &str = "Message sent";
pub const OP_FILE_UPLOAD: &str = "File upload";
pub const OP_FILE_SHARED: &str = "File shared";
pub const OP_FORM_SUBMIT: &str = "Form submitted";
pub const OP_COMMENT_POSTED: &str = "Comment posted";
pub const OP_AI_PROMPT: &str = "AI prompt sent";

/// Upper bound on the user text handed back for scanning. A person does not
/// type megabytes into a chat box; anything larger is a file and goes down
/// the file path instead.
const MAX_USER_TEXT: usize = 1024 * 1024;

#[derive(Debug, Default, Clone)]
pub struct RequestMeta {
    pub host: String,
    pub path: String,
    pub method: String,
    pub content_type: String,
    /// The agent's filename guess. Older agents fall back to the last URL
    /// path segment ("log", "Ping", "list"), so this is only trusted when it
    /// carries a real file extension.
    pub filename_hint: String,
    pub user_agent: String,
    /// "browser" / "app" when the agent knows; empty otherwise.
    pub source: String,
    pub sec_fetch_mode: String,
    pub sec_fetch_dest: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Text,
}

#[derive(Debug, Serialize, Clone)]
pub struct Inspection {
    /// false → not a user action; the caller records nothing.
    pub relevant: bool,
    /// Why it was skipped, for logs/metrics. Empty when relevant.
    pub skip_reason: String,
    pub kind: Option<Kind>,
    pub operation: String,
    /// The attached file's real name, when there is one.
    pub filename: String,
    /// Only for Kind::Text: the human-written text to scan. Never sent back
    /// to the caller — it is scanned here and goes no further.
    #[serde(skip)]
    pub user_text: String,
    /// "browser" or "app".
    pub request_source: String,
    /// The desktop app's name when request_source == "app".
    pub app_name: String,
    /// The site as a person would name it ("canva.com", "docs.google.com").
    pub site: String,
    /// What the dashboard shows as the destination: the site for a browser,
    /// the app's name for a desktop app — never a raw telemetry subdomain.
    pub destination: String,
}

pub fn inspect(meta: &RequestMeta, body: &[u8]) -> Inspection {
    let host = normalize_host(&meta.host);
    let request_source = request_source(&meta.user_agent, &meta.source).to_string();
    let site = site_label(&host);
    let app_name = if request_source == "app" { app_name(&meta.user_agent, &host) } else { String::new() };
    let destination = if request_source == "app" { app_name.clone() } else { site.clone() };

    let mut out = Inspection {
        relevant: false,
        skip_reason: String::new(),
        kind: None,
        operation: String::new(),
        filename: String::new(),
        user_text: String::new(),
        request_source,
        app_name,
        site,
        destination,
    };

    let skip = |mut o: Inspection, reason: &str| {
        o.skip_reason = reason.to_string();
        o
    };

    if body.is_empty() {
        return skip(out, "empty_body");
    }
    if !matches!(meta.method.to_ascii_uppercase().as_str(), "POST" | "PUT" | "PATCH") {
        return skip(out, "not_an_upload_method");
    }
    let path = meta.path.to_ascii_lowercase();
    if is_background(&host, &path) {
        return skip(out, "background_traffic");
    }

    let ct = mime_of(&meta.content_type);
    let file = find_file(&ct, &meta.content_type, &meta.filename_hint, body);
    let op = known_operation(&host, &path).or_else(|| outlook_send(&host, &path, body));

    if let Some(name) = file {
        out.relevant = true;
        out.kind = Some(Kind::File);
        out.filename = name;
        out.operation = match op {
            Some(label) if label != OP_AI_PROMPT && label != OP_COMMENT_POSTED => label.to_string(),
            _ => OP_FILE_UPLOAD.to_string(),
        };
        return out;
    }

    let operation = match op {
        Some(label) => label,
        None if is_navigation_form(meta, &ct, &path) => OP_FORM_SUBMIT,
        None => return skip(out, "no_user_action"),
    };

    let text = user_text(&ct, &meta.content_type, body);
    if text.trim().is_empty() {
        return skip(out, "no_user_text");
    }
    out.relevant = true;
    out.kind = Some(Kind::Text);
    out.operation = operation.to_string();
    out.user_text = text;
    out
}

// ─── Background traffic ─────────────────────────────────────────────────────

/// Hosts that only ever receive machine telemetry: error reporters, product
/// analytics, RUM, ad/measurement pixels, anti-bot sensors.
const BACKGROUND_HOST_PARTS: &[&str] = &[
    "sentry.io", "sentry-cdn", "datadoghq", "braze.com", "braze.eu", "px-cloud.net", "perimeterx",
    "google-analytics.com", "analytics.google.com", "googletagmanager.com", "doubleclick.net",
    "googlesyndication.com", "googleadservices.com", "app-measurement.com", "firebaselogging",
    "crashlytics", "segment.io", "segment.com", "mixpanel.com", "amplitude.com", "hotjar",
    "fullstory.com", "newrelic.com", "nr-data.net", "bugsnag", "rollbar.com", "logrocket",
    "clarity.ms", "launchdarkly", "optimizely", "statsig", "split.io", "honeycomb.io",
    "appcenter.ms", "events.data.microsoft.com", "events.data.msn.com", "scorecardresearch",
    "quantserve", "heapanalytics", "heap.io", "posthog", "plausible.io", "mouseflow",
    "smartlook", "branch.io", "adjust.com", "appsflyer", "onesignal", "bat.bing.com",
    "ads.linkedin.com", "analytics.tiktok.com", "clientservices.googleapis.com",
    "update.googleapis.com", "safebrowsing.googleapis.com", "content-autofill.googleapis.com",
    "optimizationguide-pa.googleapis.com", "hcaptcha.com", "recaptcha.net", "arkoselabs.com",
];

/// Google's internal per-product RPC front-ends (ogads-pa, waa-pa, people-pa,
/// accountcapabilities-pa …): account chrome, attestation pings, ads config.
/// Never a place a person sends content to.
const BACKGROUND_HOST_SUFFIXES: &[&str] = &["-pa.googleapis.com", "-pa.clients6.google.com"];

const BACKGROUND_HOST_PREFIXES: &[&str] = &[
    "telemetry.", "metrics.", "stats.", "log.", "logs.", "logging.", "collector", "collect.",
    "beacon", "rum.", "analytics.", "track.", "tracking.", "pixel.", "browser-intake",
    "error-reporting", "crash", "diagnostics.",
];

const BACKGROUND_PATH_PARTS: &[&str] = &[
    "/$rpc/", "/cdn-cgi/", "/_ajax/ae/", "figment-proxy", "/youtubei/v1/log_event", "/api/stats/",
    "/generate_204", "/ptracking", "/csp-report", "/_/jserror", "/offline/jserror",
];

/// Whole path segments that name telemetry endpoints. Matched as segments so
/// "/catalog" is not mistaken for "log".
const BACKGROUND_PATH_SEGMENTS: &[&str] = &[
    "log", "logs", "logging", "log_event", "collect", "collector", "beacon", "telemetry", "metrics",
    "analytics", "track", "tracking", "ping", "heartbeat", "presence", "getpresence", "monitor",
    "rum", "jserror", "error-report", "envelope", "store", "events-batch", "qoe", "stats",
    "impression", "impressions", "pageview", "clientlog", "clienttelemetry",
];

pub fn is_background(host: &str, path: &str) -> bool {
    if BACKGROUND_HOST_PARTS.iter().any(|p| host.contains(p))
        || BACKGROUND_HOST_SUFFIXES.iter().any(|s| host.ends_with(s))
        || BACKGROUND_HOST_PREFIXES.iter().any(|p| host.starts_with(p))
    {
        return true;
    }
    if host == "play.google.com" && path.starts_with("/log") {
        return true;
    }
    let path_only = path.split(['?', '#']).next().unwrap_or("");
    if BACKGROUND_PATH_PARTS.iter().any(|p| path_only.contains(p)) {
        return true;
    }
    path_only
        .split('/')
        .filter(|s| !s.is_empty())
        .any(|seg| BACKGROUND_PATH_SEGMENTS.contains(&seg))
}

// ─── Known "send" endpoints ─────────────────────────────────────────────────

struct OpRule {
    hosts: &'static [&'static str],
    /// Empty matches any path on the host.
    paths: &'static [&'static str],
    label: &'static str,
}

/// Ordered most specific first — the first match wins. Every rule names the
/// endpoint that performs the send, not the whole host: a chat app's host
/// also receives presence, read receipts and settings, and those are not a
/// person sending anything.
const OP_RULES: &[OpRule] = &[
    // Email
    OpRule { hosts: &["outlook.office.com", "outlook.office365.com", "outlook.live.com", "substrate.office.com", "outlook.cloud.microsoft"],
        paths: &["sendmail", "/messages/send", "createreply", "createforward", "sendmessage"], label: OP_EMAIL_SENT },
    OpRule { hosts: &["mail.google.com"], paths: &["act=sm", "act=send", "/sendmessage", "/i/s?", "/i/s/"], label: OP_EMAIL_SENT },
    OpRule { hosts: &["mail.yahoo.com", "mail.zoho.com", "mail.zoho.in", "mail.proton.me", "api.protonmail.ch"],
        paths: &["/send", "sendmessage", "send_message"], label: OP_EMAIL_SENT },
    OpRule { hosts: &["api.sendgrid.com", "api.mailgun.net", "api.postmarkapp.com"], paths: &["/send", "/messages", "/email"], label: OP_EMAIL_SENT },
    // Chat
    OpRule { hosts: &["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"], paths: &["/messages"], label: OP_MESSAGE_SENT },
    OpRule { hosts: &["slack.com"], paths: &["chat.postmessage", "chat.update", "/api/files.completeupload"], label: OP_MESSAGE_SENT },
    OpRule { hosts: &["discord.com", "discordapp.com"], paths: &["/messages"], label: OP_MESSAGE_SENT },
    OpRule { hosts: &["chat.google.com"], paths: &["createmessage", "/messages"], label: OP_MESSAGE_SENT },
    OpRule { hosts: &["web.telegram.org", "api.telegram.org"], paths: &["sendmessage", "senddocument", "sendphoto"], label: OP_MESSAGE_SENT },
    // File sharing / storage
    OpRule { hosts: &["googleapis.com", "drive.google.com", "docs.google.com"], paths: &["/upload/", "upload/drive"], label: OP_FILE_UPLOAD },
    OpRule { hosts: &["sharepoint.com", "onedrive.live.com", "graph.microsoft.com", "api.onedrive.com"],
        paths: &["/upload", "uploadsession", "/content"], label: OP_FILE_UPLOAD },
    OpRule { hosts: &["dropbox.com", "dropboxapi.com"], paths: &["upload", "/files/"], label: OP_FILE_UPLOAD },
    OpRule { hosts: &["box.com"], paths: &["upload", "/files/content"], label: OP_FILE_UPLOAD },
    OpRule { hosts: &["wetransfer.com", "mega.nz", "mega.co.nz"], paths: &["upload", "/transfers", "/ul/"], label: OP_FILE_UPLOAD },
    OpRule { hosts: &["drive.google.com", "docs.google.com"], paths: &["/share", "permissions"], label: OP_FILE_SHARED },
    // AI assistants — the prompt endpoint only, not their telemetry.
    OpRule { hosts: &["chatgpt.com", "chat.openai.com"], paths: &["/backend-api/conversation", "/backend-api/f/conversation", "/backend-anon/conversation"], label: OP_AI_PROMPT },
    OpRule { hosts: &["api.openai.com"], paths: &["/chat/completions", "/completions", "/responses", "/assistants", "/threads"], label: OP_AI_PROMPT },
    OpRule { hosts: &["claude.ai"], paths: &["/completion", "/chat_conversations"], label: OP_AI_PROMPT },
    OpRule { hosts: &["api.anthropic.com"], paths: &["/v1/messages", "/v1/complete"], label: OP_AI_PROMPT },
    OpRule { hosts: &["gemini.google.com", "bard.google.com"], paths: &["streamgenerate"], label: OP_AI_PROMPT },
    OpRule { hosts: &["perplexity.ai"], paths: &["perplexity_ask", "/rest/sse/"], label: OP_AI_PROMPT },
    OpRule { hosts: &["copilot.microsoft.com"], paths: &["/c/api/conversations", "/turing/conversation"], label: OP_AI_PROMPT },
    OpRule { hosts: &["chat.deepseek.com"], paths: &["/chat/completion"], label: OP_AI_PROMPT },
    // Dev / issue trackers
    OpRule { hosts: &["github.com", "gitlab.com", "bitbucket.org"], paths: &["/comments", "/issues", "/pulls", "/pull/", "/issue_comments"], label: OP_COMMENT_POSTED },
    OpRule { hosts: &["atlassian.net", "jira.com"], paths: &["/comment", "/issue"], label: OP_COMMENT_POSTED },
];

pub fn known_operation(host: &str, path: &str) -> Option<&'static str> {
    OP_RULES
        .iter()
        .find(|r| {
            r.hosts.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")))
                && (r.paths.is_empty() || r.paths.iter().any(|p| path.contains(p)))
        })
        .map(|r| r.label)
}

/// Outlook on the web sends mail with the same service.svc action it uses to
/// autosave a draft (CreateItem); only the message disposition in the body
/// tells a send from a save. A saved draft is not an email sent.
fn outlook_send(host: &str, path: &str, body: &[u8]) -> Option<&'static str> {
    let is_outlook = ["outlook.office.com", "outlook.office365.com", "outlook.live.com", "outlook.cloud.microsoft"]
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")));
    if !is_outlook || !path.contains("service.svc") {
        return None;
    }
    if !(path.contains("action=createitem") || path.contains("action=senditem") || path.contains("action=updateitem")) {
        return None;
    }
    let head = String::from_utf8_lossy(&body[..body.len().min(256 * 1024)]).to_ascii_lowercase();
    (head.contains("sendandsavecopy") || head.contains("\"sendonly\"")).then_some(OP_EMAIL_SENT)
}

// ─── Forms ──────────────────────────────────────────────────────────────────

const AUTH_PATH_WORDS: &[&str] = &[
    "login", "signin", "sign-in", "sign_in", "signup", "sign-up", "logout", "auth", "oauth", "token",
    "session", "password", "passwd", "verify", "otp", "2fa", "mfa", "captcha", "consent", "sso", "saml",
];

/// A form the person submitted with the browser's own navigation — a plain
/// HTML <form>, not a script's background POST. Sign-in forms are excluded:
/// someone typing their own password into a login page is not data leaving.
fn is_navigation_form(meta: &RequestMeta, ct: &str, path: &str) -> bool {
    if !meta.sec_fetch_mode.eq_ignore_ascii_case("navigate") {
        return false;
    }
    if ct != "application/x-www-form-urlencoded" && ct != "multipart/form-data" && ct != "text/plain" {
        return false;
    }
    !AUTH_PATH_WORDS.iter().any(|w| path.contains(w))
}

// ─── Files ──────────────────────────────────────────────────────────────────

pub fn mime_of(content_type: &str) -> String {
    content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase()
}

/// A content type that is a document/media/archive being uploaded, as
/// opposed to an API payload.
fn is_file_mime(ct: &str) -> bool {
    if ct.contains("json") || ct.contains("xml") || ct.contains("protobuf") || ct.contains("grpc") {
        return false;
    }
    ct.starts_with("image/") && ct != "image/svg+xml"
        || ct.starts_with("audio/")
        || ct.starts_with("video/")
        || matches!(
            ct,
            "application/pdf" | "application/msword" | "application/rtf" | "application/zip"
                | "application/x-zip-compressed" | "application/x-7z-compressed" | "application/x-rar-compressed"
                | "application/vnd.rar" | "application/x-tar" | "text/csv" | "text/tab-separated-values"
                | "application/vnd.ms-excel" | "application/vnd.ms-powerpoint" | "application/vnd.ms-outlook"
        )
        || ct.starts_with("application/vnd.openxmlformats-officedocument.")
        || ct.starts_with("application/vnd.oasis.opendocument.")
        || ct.starts_with("application/vnd.ms-")
        || ct.starts_with("application/vnd.apple.")
}

/// Recognises a file by its first bytes — what an upload of an actual
/// document, image or archive starts with regardless of the header sent.
/// gzip is deliberately absent: it is how telemetry SDKs compress beacons.
pub fn magic_file_type(head: &[u8]) -> Option<&'static str> {
    let starts = |sig: &[u8]| head.len() >= sig.len() && &head[..sig.len()] == sig;
    if starts(b"%PDF-") {
        return Some("pdf");
    }
    if starts(b"PK\x03\x04") {
        return Some("zip");
    }
    if starts(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        return Some("ole");
    }
    if starts(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if starts(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpeg");
    }
    if starts(b"GIF87a") || starts(b"GIF89a") {
        return Some("gif");
    }
    if starts(b"7z\xBC\xAF\x27\x1C") {
        return Some("7z");
    }
    if starts(b"Rar!\x1A\x07") {
        return Some("rar");
    }
    if starts(b"{\\rtf") {
        return Some("rtf");
    }
    if starts(b"RIFF") && head.len() >= 12 && (&head[8..12] == b"WEBP" || &head[8..12] == b"WAVE" || &head[8..12] == b"AVI ") {
        return Some("riff");
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        return Some("mp4/heic");
    }
    if starts(b"ID3") {
        return Some("mp3");
    }
    None
}

const FILE_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "docm", "xls", "xlsx", "xlsm", "csv", "tsv", "ppt", "pptx", "pptm", "odt", "ods",
    "odp", "rtf", "txt", "md", "json", "xml", "yaml", "yml", "zip", "rar", "7z", "tar", "gz", "tgz", "png",
    "jpg", "jpeg", "gif", "webp", "heic", "bmp", "tif", "tiff", "mp3", "m4a", "wav", "mp4", "mov", "webm",
    "eml", "msg", "pages", "numbers", "key", "sql", "py", "js", "ts", "go", "rs", "java", "c", "cpp", "h",
    "cs", "rb", "php", "swift", "kt", "sh", "env", "pem", "key", "p12", "pfx",
];

fn has_file_extension(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(stem, ext)| !stem.is_empty() && FILE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// The name of the file this request carries, if it carries one.
fn find_file(ct: &str, raw_ct: &str, hint: &str, body: &[u8]) -> Option<String> {
    if ct.starts_with("multipart/") {
        let boundary = multipart_boundary(raw_ct)?;
        return multipart_parts(body, &boundary).into_iter().find_map(|p| {
            let name = p.filename?;
            let part_ct = mime_of(&p.content_type);
            let named = !name.is_empty() && name != "blob" && has_file_extension(&name);
            if named || is_file_mime(&part_ct) || magic_file_type(p.data).is_some() {
                Some(if name.is_empty() { "blob".to_string() } else { name })
            } else {
                None
            }
        });
    }
    let name = hint.trim();
    if is_file_mime(ct) || magic_file_type(body).is_some() {
        return Some(if has_file_extension(name) { name.to_string() } else { String::new() });
    }
    // A plain-text document (CSV, .txt, .sql, .env …) has no magic bytes and
    // is often sent as a bare octet-stream to a presigned storage URL; its
    // name is then the only thing that says it is a file.
    if (ct.is_empty() || ct == "application/octet-stream" || ct == "binary/octet-stream") && is_document_name(name) {
        return Some(name.to_string());
    }
    None
}

/// Extensions of documents a person uploads, as opposed to the image/script
/// names beacons and pixels use ("pixel.gif", "collect.js").
const DOCUMENT_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "csv", "tsv", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt",
    "md", "sql", "env", "pem", "key", "zip", "7z", "rar", "tar", "tgz",
];

fn is_document_name(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(stem, ext)| !stem.is_empty() && DOCUMENT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub struct Part<'a> {
    pub name: String,
    pub filename: Option<String>,
    pub content_type: String,
    pub data: &'a [u8],
}

pub fn multipart_boundary(content_type: &str) -> Option<String> {
    content_type.split(';').skip(1).find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        if k.trim().eq_ignore_ascii_case("boundary") {
            Some(v.trim().trim_matches('"').to_string())
        } else {
            None
        }
    })
}

/// Minimal multipart splitter — headers and body per part, no copying of
/// the part data. Malformed input yields whatever parts parsed cleanly.
pub fn multipart_parts<'a>(body: &'a [u8], boundary: &str) -> Vec<Part<'a>> {
    let delim = format!("--{boundary}");
    let delim = delim.as_bytes();
    let mut parts = Vec::new();
    let mut positions = Vec::new();
    let mut i = 0;
    while let Some(off) = find(&body[i..], delim) {
        positions.push(i + off);
        i += off + delim.len();
    }
    for w in positions.windows(2) {
        let start = w[0] + delim.len();
        let end = w[1];
        if start >= end {
            continue;
        }
        let mut seg = &body[start..end];
        seg = seg.strip_prefix(b"\r\n").unwrap_or(seg);
        seg = seg.strip_suffix(b"\r\n").unwrap_or(seg);
        let Some(hdr_end) = find(seg, b"\r\n\r\n") else { continue };
        let headers = String::from_utf8_lossy(&seg[..hdr_end]);
        let data = &seg[hdr_end + 4..];
        let mut name = String::new();
        let mut filename = None;
        let mut content_type = String::new();
        for line in headers.lines() {
            let Some((k, v)) = line.split_once(':') else { continue };
            let k = k.trim().to_ascii_lowercase();
            if k == "content-disposition" {
                name = disposition_param(v, "name").unwrap_or_default();
                filename = disposition_param(v, "filename");
            } else if k == "content-type" {
                content_type = v.trim().to_string();
            }
        }
        parts.push(Part { name, filename, content_type, data });
    }
    parts
}

fn disposition_param(value: &str, key: &str) -> Option<String> {
    value.split(';').skip(1).find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        if k.trim().eq_ignore_ascii_case(key) {
            Some(v.trim().trim_matches('"').to_string())
        } else {
            None
        }
    })
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

// ─── User text ──────────────────────────────────────────────────────────────

/// Keys whose value is what a person wrote. Kept even when the value looks
/// like a token — a key pasted into a chat message is exactly the leak.
const CONTENT_KEYS: &[&str] = &[
    "content", "text", "message", "messages", "body", "prompt", "parts", "subject", "comment", "description",
    "title", "query", "input", "html", "plaintext", "caption", "note", "notes", "richtext", "markdown",
];

/// Keys that are request plumbing, never something a person typed.
const PLUMBING_KEYS: &[&str] = &[
    "id", "uuid", "guid", "token", "nonce", "csrf", "xsrf", "signature", "sig", "hash", "checksum", "etag",
    "cursor", "session", "timestamp", "ts", "time", "version", "v", "at", "ik", "key", "secret", "auth",
    "authorization", "state", "code", "challenge", "fingerprint", "cookie", "trace", "span", "sequence",
    "seq", "offset", "rev", "revision", "locale", "lang", "timezone", "tz", "platform", "useragent",
];

fn is_plumbing_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    let bare: String = lower.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if PLUMBING_KEYS.contains(&bare.as_str()) {
        return true;
    }
    // "clientMessageId", "thread_id", "clientmessageid", "userIds" — but not
    // the ordinary words that happen to end in "id".
    let stem = bare.strip_suffix("ids").or_else(|| bare.strip_suffix("id"));
    if let Some(stem) = stem {
        if !stem.is_empty() && !WORDS_ENDING_IN_ID.contains(&bare.as_str()) {
            return true;
        }
    }
    ["token", "hash", "nonce", "secret", "signature", "timestamp", "_at", "_ts", "uuid", "guid"]
        .iter()
        .any(|s| lower.ends_with(s))
}

const WORDS_ENDING_IN_ID: &[&str] = &[
    "android", "paid", "unpaid", "prepaid", "valid", "invalid", "void", "avoid", "liquid", "fluid", "rapid",
    "hybrid", "solid", "vivid", "acid", "grid", "said", "raid", "bid", "kid", "lid", "mid", "did", "squid",
    "humid", "cupid", "candid", "splendid", "timid", "lucid", "pyramid", "aid", "maid", "braid", "druid",
];

fn is_content_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    CONTENT_KEYS.contains(&lower.as_str())
}

/// A value with no spaces that is a long run of base64/hex/url-safe
/// characters: an encoded blob or opaque id, not prose.
fn looks_like_opaque_blob(s: &str) -> bool {
    let s = s.trim();
    s.len() >= 24
        && !s.contains(char::is_whitespace)
        && s.chars().all(|c| c.is_ascii_alphanumeric() || "+/=_-.:%".contains(c))
}

/// Extracts only what a person wrote from a request body.
pub fn user_text(ct: &str, raw_ct: &str, body: &[u8]) -> String {
    let mut out = String::new();
    let trimmed = trim_ascii_start(body);
    if ct.contains("json") || trimmed.starts_with(b"{") || trimmed.starts_with(b"[") {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(body) {
            collect_json(&v, None, false, &mut out);
            return cap(out);
        }
    }
    if ct == "application/x-www-form-urlencoded" {
        collect_form(body, &mut out);
        return cap(out);
    }
    if ct.starts_with("multipart/") {
        if let Some(b) = multipart_boundary(raw_ct) {
            for p in multipart_parts(body, &b) {
                if p.filename.is_some() {
                    continue;
                }
                let v = String::from_utf8_lossy(p.data);
                collect_value(&v, Some(&p.name), false, &mut out);
            }
        }
        return cap(out);
    }
    if ct.starts_with("text/") || ct.is_empty() {
        // Plain text body: scanned as-is, but only if it is text.
        let s = String::from_utf8_lossy(body);
        if s.chars().filter(|c| c.is_control() && !c.is_whitespace()).count() * 20 < s.len().max(1) {
            out.push_str(&s);
        }
    }
    cap(out)
}

/// What a person wrote in one form field of an uploaded multipart body —
/// nothing when the field is request plumbing (a csrf token, an id).
pub fn user_text_of_field(name: &str, value: &str) -> String {
    let mut out = String::new();
    collect_value(value, Some(name), false, &mut out);
    cap(out)
}

fn trim_ascii_start(b: &[u8]) -> &[u8] {
    let n = b.iter().take_while(|c| c.is_ascii_whitespace()).count();
    &b[n..]
}

fn cap(mut s: String) -> String {
    if s.len() > MAX_USER_TEXT {
        let mut end = MAX_USER_TEXT;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
    }
    s
}

fn collect_form(body: &[u8], out: &mut String) {
    for (k, v) in form_urlencoded::parse(body) {
        collect_value(&v, Some(&k), false, out);
    }
}

/// A form/multipart value: nested JSON (Gmail's `f.req`, many SPAs) is
/// walked like any JSON body; anything else is judged as one string.
fn collect_value(v: &str, key: Option<&str>, in_content: bool, out: &mut String) {
    if let Some(k) = key {
        if is_plumbing_key(k) {
            return;
        }
    }
    let t = v.trim_start();
    if t.starts_with('{') || t.starts_with('[') {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(v) {
            collect_json(&j, key, in_content, out);
            return;
        }
    }
    push_string(v, key, in_content, out);
}

fn push_string(s: &str, key: Option<&str>, in_content: bool, out: &mut String) {
    let content = in_content || key.map(is_content_key).unwrap_or(false);
    if s.trim().is_empty() || (!content && looks_like_opaque_blob(s)) {
        return;
    }
    out.push_str(s);
    out.push('\n');
}

fn collect_json(v: &serde_json::Value, key: Option<&str>, in_content: bool, out: &mut String) {
    use serde_json::Value;
    if out.len() > MAX_USER_TEXT {
        return;
    }
    match v {
        Value::String(s) => {
            // A string that is itself JSON (double-encoded payloads).
            let t = s.trim_start();
            if (t.starts_with('{') || t.starts_with('[')) && t.len() > 1 {
                if let Ok(inner) = serde_json::from_str::<Value>(s) {
                    collect_json(&inner, key, in_content, out);
                    return;
                }
            }
            push_string(s, key, in_content, out);
        }
        Value::Array(items) => {
            for item in items {
                collect_json(item, key, in_content, out);
            }
        }
        Value::Object(map) => {
            for (k, child) in map {
                if is_plumbing_key(k) {
                    continue;
                }
                let content = in_content || is_content_key(k);
                collect_json(child, Some(k), content, out);
            }
        }
        // Numbers, booleans and null are never text a person typed — and
        // numeric ids are exactly what used to pass the Luhn check.
        _ => {}
    }
}

// ─── Browser or app, and what to call the destination ──────────────────────

/// Product tokens every mainstream browser sends. "mozilla" is the widest
/// net and some Electron apps inherit it, so Electron is checked first.
const BROWSER_UA_MARKERS: &[&str] = &["chrome/", "safari/", "firefox/", "edg/", "edge/", "opr/", "gecko/", "mozilla/"];

/// Tokens present in a desktop app's User-Agent that identify it as an app
/// even though it also carries a browser engine's tokens.
const APP_UA_MARKERS: &[&str] = &["electron/", "teams/", "slack_ssb/", "slack/", "figma/", "canva/", "notion/", "discord/", "zoom/", "whatsapp/", "msteams", "webview"];

pub fn request_source(user_agent: &str, explicit: &str) -> &'static str {
    match explicit.trim().to_ascii_lowercase().as_str() {
        "browser" => return "browser",
        "app" => return "app",
        _ => {}
    }
    let ua = user_agent.trim().to_ascii_lowercase();
    if ua.is_empty() {
        return "app";
    }
    if APP_UA_MARKERS.iter().any(|m| ua.contains(m)) {
        return "app";
    }
    if BROWSER_UA_MARKERS.iter().any(|m| ua.contains(m)) {
        return "browser";
    }
    "app"
}

/// Engine, OS and HTTP-library tokens — never the name of the app itself.
const GENERIC_UA_TOKENS: &[&str] = &[
    "mozilla", "applewebkit", "khtml", "gecko", "chrome", "chromium", "safari", "version", "mobile",
    "electron", "edg", "edge", "firefox", "opr", "cfnetwork", "darwin", "headlesschrome", "crios",
    "fxios", "trident", "msie", "webview", "wv", "x11", "linux", "windows", "macintosh", "cpu", "like",
    "okhttp", "python-requests", "python-urllib", "python", "go-http-client", "axios", "node-fetch",
    "node", "undici", "curl", "wget", "java", "dalvik", "libcurl", "reqwest", "dart", "electron-fetch",
    "apache-httpclient", "httpclient", "aiohttp", "httpx", "ktor-client", "alamofire", "urlsession",
];

/// Well-known desktop apps by the host they talk to — the fallback when the
/// User-Agent names only an engine or an HTTP library.
const APP_BY_HOST: &[(&str, &str)] = &[
    ("figma.com", "Figma"), ("canva.com", "Canva"), ("slack.com", "Slack"), ("slack-edge.com", "Slack"),
    ("teams.microsoft.com", "Microsoft Teams"), ("teams.live.com", "Microsoft Teams"), ("skype.com", "Microsoft Teams"),
    ("outlook.office.com", "Microsoft Outlook"), ("outlook.office365.com", "Microsoft Outlook"),
    ("onedrive.live.com", "OneDrive"), ("sharepoint.com", "OneDrive"), ("notion.so", "Notion"),
    ("notion.com", "Notion"), ("discord.com", "Discord"), ("zoom.us", "Zoom"), ("whatsapp.net", "WhatsApp"),
    ("whatsapp.com", "WhatsApp"), ("telegram.org", "Telegram"), ("dropbox.com", "Dropbox"),
    ("dropboxapi.com", "Dropbox"), ("postman.com", "Postman"), ("getpostman.com", "Postman"),
    ("github.com", "GitHub"), ("githubusercontent.com", "GitHub"), ("chatgpt.com", "ChatGPT"),
    ("openai.com", "ChatGPT"), ("claude.ai", "Claude"), ("anthropic.com", "Claude"), ("webflow.com", "Webflow"),
    ("spotify.com", "Spotify"), ("atlassian.net", "Jira"), ("linear.app", "Linear"), ("miro.com", "Miro"),
    ("google.com", "Google"), ("googleapis.com", "Google"),
];

pub fn app_name(user_agent: &str, host: &str) -> String {
    if let Some(name) = app_name_from_ua(user_agent) {
        return name;
    }
    for (domain, name) in APP_BY_HOST {
        if host == *domain || host.ends_with(&format!(".{domain}")) {
            return (*name).to_string();
        }
    }
    let site = site_label(host);
    let first = site.split('.').next().unwrap_or("");
    if first.is_empty() {
        return "Desktop app".to_string();
    }
    let mut c = first.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => "Desktop app".to_string(),
    }
}

/// The first product token in the User-Agent that is not an engine, OS or
/// HTTP library: "Slack_SSB/4.35" → "Slack", "Figma/125.1" → "Figma",
/// "com.canva.desktop/1.2" → "Canva".
fn app_name_from_ua(user_agent: &str) -> Option<String> {
    for raw in user_agent.split(|c: char| c.is_whitespace() || c == '(' || c == ')' || c == ';') {
        let Some((product, version)) = raw.split_once('/') else { continue };
        if product.is_empty() || !version.starts_with(|c: char| c.is_ascii_digit()) {
            continue;
        }
        let lower = product.to_ascii_lowercase();
        if GENERIC_UA_TOKENS.contains(&lower.as_str()) {
            continue;
        }
        // Reverse-DNS bundle ids: "com.figma.Desktop" → "figma".
        let base = if lower.matches('.').count() >= 2 {
            product.split('.').nth(1).unwrap_or(product)
        } else {
            product
        };
        let base = base.split('_').next().unwrap_or(base);
        if base.is_empty() || base.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let mut c = base.chars();
        let first = c.next()?;
        return Some(first.to_uppercase().collect::<String>() + c.as_str());
    }
    None
}

/// Products that live on subdomains of one shared registrable domain, where
/// cutting to that domain would lose which product it was ("google.com" for
/// both Gmail and Docs).
const MULTI_PRODUCT_DOMAINS: &[&str] = &[
    "google.com", "microsoft.com", "office.com", "office365.com", "live.com", "cloud.microsoft", "apple.com",
    "amazon.com", "yahoo.com", "zoho.com", "zoho.in", "atlassian.net", "sharepoint.com", "googleapis.com",
];

pub fn normalize_host(raw: &str) -> String {
    let mut h = raw.trim().to_ascii_lowercase();
    if let Some(i) = h.find("://") {
        h = h[i + 3..].to_string();
    }
    if let Some(i) = h.find(['/', '?', '#']) {
        h.truncate(i);
    }
    if !h.contains(']') {
        if let Some(i) = h.rfind(':') {
            h.truncate(i);
        }
    }
    h.trim_end_matches('.').to_string()
}

/// The site a person would recognise: the registrable domain
/// ("collector-x.px-cloud.net" → "px-cloud.net", "www.canva.com" →
/// "canva.com"), except on multi-product domains, where the product host is
/// kept ("docs.google.com").
pub fn site_label(host: &str) -> String {
    let host = normalize_host(host);
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let Some(domain) = psl::domain_str(&host) else { return host };
    if MULTI_PRODUCT_DOMAINS.contains(&domain) {
        return host;
    }
    domain.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHROME_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
    const FIGMA_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Figma/125.8.8 Chrome/128.0.6613.36 Electron/32.0.1 Safari/537.36";

    fn meta(host: &str, path: &str, ct: &str) -> RequestMeta {
        RequestMeta {
            host: host.to_string(),
            path: path.to_string(),
            method: "POST".to_string(),
            content_type: ct.to_string(),
            filename_hint: path.rsplit('/').next().unwrap_or("").to_string(),
            user_agent: CHROME_UA.to_string(),
            ..Default::default()
        }
    }

    /// Every endpoint that produced a false incident in production, with a
    /// body shaped like what it really sends. None of them may be scanned.
    #[test]
    fn production_false_positives_are_not_user_actions() {
        let json = br#"{"id":"4111111111111111","ts":1727500012345,"events":[{"n":4242424242424242}]}"#;
        let cases = [
            ("play.google.com", "/log", "application/x-www-form-urlencoded"),
            ("waa-pa.clients6.google.com", "/$rpc/google.internal.waa.v1.Waa/Ping", "application/json+protobuf"),
            ("ogads-pa.clients6.google.com", "/$rpc/google.internal.onegoogle.asyncdata.v1.AsyncDataService/GetAsyncData", "application/json+protobuf"),
            ("people-pa.clients6.google.com", "/batch", "multipart/mixed; boundary=x"),
            ("accountcapabilities-pa.googleapis.com", "/v1/accountcapabilities:batchGet", "application/json"),
            ("oauthaccountmanager.googleapis.com", "/v1/issuetoken", "application/x-www-form-urlencoded"),
            ("webflow.com", "/external/designer/main-cdfis-website", "application/json"),
            ("collector-pxtg2vkiqj.px-cloud.net", "/api/v2/collector", "application/x-www-form-urlencoded"),
            ("collector-pxtg2vkiqj.px-cloud.net", "/api/v2/collector/beacon", "text/plain"),
            ("www.canva.com", "/_ajax/comments/list", "application/json"),
            ("www.canva.com", "/_ajax/comments/listsuggestions", "application/json"),
            ("www.canva.com", "/_ajax/ae/v2/createBatch", "application/json"),
            ("www.canva.com", "/cdn-cgi/challenge-platform/h/b/jsd/oneshot/d76008a69eab/0.088:1790:cK", "text/plain"),
            ("o13855.ingest.sentry.io", "/api/1766513/envelope/", "text/plain;charset=UTF-8"),
            ("sdk.iad-01.braze.com", "/api/v3/data/", "application/json"),
            ("edge.skype.com", "/registrar/prod/V2/registrations", "application/json"),
            ("teams.microsoft.com", "/ups/apac/v1/presence/getpresence/", "application/json"),
            ("teams.microsoft.com", "/api/chatsvc/in/v1/users/ME/conversations/19%3Ameeting_x/properties", "application/json"),
            ("www.figma.com", "/api/figment-proxy/user-support", "application/octet-stream"),
            ("www.figma.com", "/api/figment-proxy/monitor", "application/json"),
            ("docs.google.com", "/document/sync/get", "application/x-www-form-urlencoded"),
            ("docs.google.com", "/presentation/sync/get", "application/x-www-form-urlencoded"),
            ("docs.google.com", "/offline/jserror", "application/x-www-form-urlencoded"),
            ("browser-intake-us5-datadoghq.com", "/api/v2/rum", "text/plain"),
        ];
        for (host, path, ct) in cases {
            let r = inspect(&meta(host, path, ct), json);
            assert!(!r.relevant, "{host}{path} must not be treated as a user action ({:?})", r.kind);
        }
    }

    #[test]
    fn gzip_telemetry_is_not_a_file() {
        let r = inspect(&meta("api.vendor.io", "/v1/ingest", "application/octet-stream"), &[0x1f, 0x8b, 8, 0, 0, 0]);
        assert!(!r.relevant);
    }

    #[test]
    fn multipart_file_upload_is_a_file_with_its_real_name() {
        let body = b"--XyZ\r\nContent-Disposition: form-data; name=\"csrf\"\r\n\r\nabc\r\n--XyZ\r\nContent-Disposition: form-data; name=\"file\"; filename=\"salaries.xlsx\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\nPK\x03\x04data\r\n--XyZ--\r\n";
        let r = inspect(&meta("intranet.example.com", "/upload", "multipart/form-data; boundary=XyZ"), body);
        assert!(r.relevant);
        assert_eq!(r.kind, Some(Kind::File));
        assert_eq!(r.filename, "salaries.xlsx");
        assert_eq!(r.operation, OP_FILE_UPLOAD);
    }

    #[test]
    fn multipart_without_a_file_is_not_an_upload() {
        let body = b"--b\r\nContent-Disposition: form-data; name=\"q\"\r\n\r\nhello\r\n--b--\r\n";
        let r = inspect(&meta("api.vendor.io", "/v1/x", "multipart/form-data; boundary=b"), body);
        assert!(!r.relevant);
    }

    #[test]
    fn raw_document_upload_is_a_file() {
        let r = inspect(&meta("files.oaiusercontent.com", "/file-abc", "application/pdf"), b"%PDF-1.7 ...");
        assert_eq!(r.kind, Some(Kind::File));
        // "file-abc" is a URL segment, not a file name.
        assert_eq!(r.filename, "");
        let r = inspect(&meta("s3.amazonaws.com", "/bucket/report.pdf", "application/octet-stream"), b"%PDF-1.7");
        assert_eq!(r.filename, "report.pdf");
    }

    #[test]
    fn plain_text_document_as_octet_stream_is_a_file() {
        let r = inspect(&meta("uploads.example.com", "/b/payroll.csv", "application/octet-stream"), b"name,card\nA,4111111111111111\n");
        assert_eq!(r.kind, Some(Kind::File));
        assert_eq!(r.filename, "payroll.csv");
        // A beacon to "pixel.gif" / "collect.js" is not.
        assert!(!inspect(&meta("x.example.com", "/pixel.gif", "application/octet-stream"), b"a=1").relevant);
        assert!(!inspect(&meta("x.example.com", "/t/collect.js", "application/octet-stream"), b"a=1").relevant);
    }

    #[test]
    fn chat_message_scans_only_what_was_typed() {
        let body = br#"{"content":"card 4111 1111 1111 1111","clientmessageid":"17275000123456789","messagetype":"Text","imdisplayname":"Priya","properties":{"importance":""},"ts":1727500012345}"#;
        let r = inspect(&meta("teams.microsoft.com", "/api/chatsvc/in/v1/users/ME/conversations/19:x/messages", "application/json"), body);
        assert!(r.relevant);
        assert_eq!(r.kind, Some(Kind::Text));
        assert_eq!(r.operation, OP_MESSAGE_SENT);
        assert!(r.user_text.contains("4111 1111 1111 1111"));
        assert!(!r.user_text.contains("17275000123456789"));
        assert!(!r.user_text.contains("1727500012345"));
    }

    #[test]
    fn chatgpt_prompt_keeps_a_pasted_secret() {
        let body = br#"{"action":"next","messages":[{"id":"aaa-bbb","author":{"role":"user"},"content":{"content_type":"text","parts":["acme-deploy-secret-Zq81LmX0pT7wR4vN2kB9"]}}],"parent_message_id":"x","model":"auto"}"#;
        let r = inspect(&meta("chatgpt.com", "/backend-api/conversation", "application/json"), body);
        assert_eq!(r.operation, OP_AI_PROMPT);
        assert!(r.user_text.contains("acme-deploy-secret-Zq81LmX0pT7wR4vN2kB9"));
    }

    #[test]
    fn chatgpt_telemetry_is_not_a_prompt() {
        let r = inspect(&meta("chatgpt.com", "/ces/v1/t", "application/json"), br#"{"event":"x"}"#);
        assert!(!r.relevant);
    }

    #[test]
    fn navigated_form_is_scanned_but_background_form_and_login_are_not() {
        let body = b"name=Priya&notes=Aadhaar+2345+6789+0123&csrf_token=abcdefabcdefabcdefabcdef";
        let mut m = meta("intranet.example.com", "/contact", "application/x-www-form-urlencoded");
        assert!(!inspect(&m, body).relevant, "script POST without navigation is not a person submitting");
        m.sec_fetch_mode = "navigate".to_string();
        let r = inspect(&m, body);
        assert_eq!(r.operation, OP_FORM_SUBMIT);
        assert!(r.user_text.contains("Aadhaar 2345 6789 0123"));
        assert!(!r.user_text.contains("abcdefabcdef"));
        m.path = "/login".to_string();
        assert!(!inspect(&m, b"user=a&password=hunter2hunter2").relevant);
    }

    #[test]
    fn outlook_send_is_an_email_but_a_draft_save_is_not() {
        let path = "/owa/service.svc?action=CreateItem&app=Mail&n=42";
        let send = br#"{"__type":"CreateItemJsonRequest:#Exchange","Body":{"MessageDisposition":"SendAndSaveCopy","Items":[{"Subject":"Q3","Body":{"Value":"card 4111 1111 1111 1111"}}]}}"#;
        let r = inspect(&meta("outlook.cloud.microsoft", path, "application/json; charset=utf-8"), send);
        assert_eq!(r.operation, OP_EMAIL_SENT);
        assert!(r.user_text.contains("4111 1111 1111 1111"));
        let draft = br#"{"Body":{"MessageDisposition":"SaveOnly","Items":[{"Body":{"Value":"card 4111 1111 1111 1111"}}]}}"#;
        assert!(!inspect(&meta("outlook.cloud.microsoft", path, "application/json"), draft).relevant);
    }

    #[test]
    fn gmail_send_is_an_email() {
        let r = inspect(&meta("mail.google.com", "/mail/u/0/?ik=abc&act=sm", "application/x-www-form-urlencoded"), b"to=x%40y.com&subject=Q3&body=Salary+sheet+attached");
        assert_eq!(r.operation, OP_EMAIL_SENT);
        assert!(r.user_text.contains("Salary sheet attached"));
    }

    #[test]
    fn browser_shows_the_site_and_app_shows_its_name() {
        let r = inspect(&meta("www.canva.com", "/_ajax/upload", "image/png"), b"\x89PNG\r\n\x1a\n....");
        assert_eq!(r.request_source, "browser");
        assert_eq!(r.destination, "canva.com");
        assert_eq!(r.app_name, "");

        let mut m = meta("www.figma.com", "/api/upload", "image/png");
        m.user_agent = FIGMA_UA.to_string();
        let r = inspect(&m, b"\x89PNG\r\n\x1a\n....");
        assert_eq!(r.request_source, "app");
        assert_eq!(r.app_name, "Figma");
        assert_eq!(r.destination, "Figma");
    }

    #[test]
    fn app_names() {
        assert_eq!(app_name("Slack_SSB/4.35.131", "slack.com"), "Slack");
        assert_eq!(app_name("com.canva.desktop/1.93 CFNetwork/1498 Darwin/23.6.0", "www.canva.com"), "Canva");
        assert_eq!(app_name("okhttp/4.9.0", "api.notion.com"), "Notion");
        assert_eq!(app_name("", "sdk.iad-01.braze.com"), "Braze");
        assert_eq!(app_name("python-requests/2.31", "files.acme-internal.io"), "Acme-internal");
    }

    #[test]
    fn site_labels() {
        assert_eq!(site_label("www.canva.com"), "canva.com");
        assert_eq!(site_label("collector-pxtg2vkiqj.px-cloud.net"), "px-cloud.net");
        assert_eq!(site_label("docs.google.com"), "docs.google.com");
        assert_eq!(site_label("acme.sharepoint.com:443"), "acme.sharepoint.com");
        assert_eq!(site_label("files.example.co.uk"), "example.co.uk");
    }

    #[test]
    fn request_source_from_ua() {
        assert_eq!(request_source(CHROME_UA, ""), "browser");
        assert_eq!(request_source(FIGMA_UA, ""), "app");
        assert_eq!(request_source("", ""), "app");
        assert_eq!(request_source("Slack_SSB/4.35", ""), "app");
        assert_eq!(request_source(CHROME_UA, "app"), "app");
    }

    #[test]
    fn plumbing_keys() {
        for k in ["id", "clientMessageId", "thread_id", "csrf_token", "sessionToken", "created_at", "ts", "userIds"] {
            assert!(is_plumbing_key(k), "{k}");
        }
        for k in ["content", "message", "notes", "paid", "android", "subject"] {
            assert!(!is_plumbing_key(k), "{k}");
        }
    }
}

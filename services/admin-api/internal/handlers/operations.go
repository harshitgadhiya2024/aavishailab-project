package handlers

import (
	"strings"

	"github.com/aavishield/admin-api/internal/models"
)

// Human-readable operation labels. Kept as constants so the dashboard shows
// one consistent vocabulary rather than per-call-site wording.
const (
	OpEmailSent     = "Email sent"
	OpMessageSent   = "Message sent"
	OpFileUpload    = "File upload"
	OpFileShared    = "File shared"
	OpFileDownload  = "File download"
	OpFormSubmit    = "Form submitted"
	OpDataSubmit    = "Data submitted"
	OpCommentPosted = "Comment posted"
	OpAIPrompt      = "AI prompt sent"
	OpWebRequest    = "Web request"
	OpDNSQuery      = "DNS lookup"
	OpAppLaunch     = "App launched"
	OpFileOperation = "File operation"
	OpUSBInsert     = "USB device inserted"
	OpProcessStart  = "Process started"
	OpSignIn        = "Sign-in"
	OpSignOut       = "Sign-out"
)

// operationRule matches an intercepted upload to what the user was doing.
// hostContains + pathContains are matched case-insensitively; an empty
// pathContains matches any path on that host.
type operationRule struct {
	hostContains []string
	pathContains []string
	label        string
}

// Ordered most specific first — the first match wins, so a Teams *message*
// beats the generic "something was uploaded to Teams".
var operationRules = []operationRule{
	// ── Email ────────────────────────────────────────────────────────────────
	{hostContains: []string{"outlook.office.com", "outlook.office365.com", "outlook.live.com", "substrate.office.com"},
		pathContains: []string{"sendmail", "/messages/send", "createreply", "createforward"}, label: OpEmailSent},
	{hostContains: []string{"mail.google.com"}, pathContains: []string{"act=sm", "act=send", "/sendmessage"}, label: OpEmailSent},
	{hostContains: []string{"mail.yahoo.com", "mail.zoho.com", "mail.proton.me", "api.protonmail.ch"},
		pathContains: []string{"send", "message"}, label: OpEmailSent},
	{hostContains: []string{"api.sendgrid.com", "api.mailgun.net", "api.postmarkapp.com"}, label: OpEmailSent},

	// ── Chat / collaboration ─────────────────────────────────────────────────
	{hostContains: []string{"teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"},
		pathContains: []string{"/messages", "/chats/", "/conversations"}, label: OpMessageSent},
	{hostContains: []string{"slack.com"}, pathContains: []string{"chat.postmessage", "/api/chat.", "files.upload"}, label: OpMessageSent},
	{hostContains: []string{"discord.com", "discordapp.com"}, pathContains: []string{"/messages"}, label: OpMessageSent},
	{hostContains: []string{"web.whatsapp.com", "web.telegram.org", "api.telegram.org"}, label: OpMessageSent},
	{hostContains: []string{"chat.google.com"}, pathContains: []string{"message"}, label: OpMessageSent},

	// ── File sharing / storage ───────────────────────────────────────────────
	{hostContains: []string{"drive.google.com", "docs.google.com", "googleapis.com"},
		pathContains: []string{"/upload", "upload/drive"}, label: OpFileUpload},
	{hostContains: []string{"sharepoint.com", "onedrive.live.com", "1drv.ms", "graph.microsoft.com"},
		pathContains: []string{"/upload", "uploadsession", "/content"}, label: OpFileUpload},
	{hostContains: []string{"dropbox.com", "dropboxapi.com", "box.com", "wetransfer.com", "mega.nz"}, label: OpFileUpload},
	{hostContains: []string{"drive.google.com", "docs.google.com"}, pathContains: []string{"share", "permission"}, label: OpFileShared},

	// ── AI assistants ────────────────────────────────────────────────────────
	{hostContains: []string{"chatgpt.com", "chat.openai.com", "api.openai.com", "claude.ai", "api.anthropic.com",
		"gemini.google.com", "bard.google.com", "perplexity.ai", "copilot.microsoft.com"}, label: OpAIPrompt},

	// ── Dev / issue trackers ─────────────────────────────────────────────────
	{hostContains: []string{"github.com", "gitlab.com", "bitbucket.org"},
		pathContains: []string{"/comments", "/issues", "/pulls"}, label: OpCommentPosted},
	{hostContains: []string{"atlassian.net", "jira.com"}, pathContains: []string{"/comment", "/issue"}, label: OpCommentPosted},
}

// classifyOperation names what the user was doing on an intercepted outbound
// request. Falls back from "which app + which endpoint" to content-type shape
// so an unrecognised destination still gets something more useful than blank.
func classifyOperation(host, path, method, contentType, filename string) string {
	h := strings.ToLower(host)
	p := strings.ToLower(path)
	ct := strings.ToLower(contentType)

	if h != "" || p != "" {
		for _, rule := range operationRules {
			if !containsAny(h, rule.hostContains) {
				continue
			}
			if len(rule.pathContains) > 0 && !containsAny(p, rule.pathContains) {
				continue
			}
			return rule.label
		}
	}

	// Unknown destination: infer from the payload shape.
	switch {
	case filename != "" && !strings.HasSuffix(strings.ToLower(filename), ".json"):
		return OpFileUpload
	case strings.Contains(ct, "multipart/form-data"):
		return OpFileUpload
	case strings.Contains(ct, "application/x-www-form-urlencoded"):
		return OpFormSubmit
	case strings.Contains(ct, "json"), strings.Contains(ct, "text/"):
		return OpDataSubmit
	}

	if strings.EqualFold(method, "PUT") || strings.EqualFold(method, "PATCH") {
		return OpFileUpload
	}
	return OpDataSubmit
}

func containsAny(haystack string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(haystack, n) {
			return true
		}
	}
	return false
}

// operationForEventType is the fallback label for events captured before the
// operation column existed, and for event types that don't carry request
// context (a blocked page visit is just a web request).
func operationForEventType(t models.EventType) string {
	switch t {
	case models.EventTypeWebRequest:
		return OpWebRequest
	case models.EventTypeDNSQuery:
		return OpDNSQuery
	case models.EventTypeAppLaunch:
		return OpAppLaunch
	case models.EventTypeFileOp:
		return OpFileOperation
	case models.EventTypeUSBInsert:
		return OpUSBInsert
	case models.EventTypeProcessStart:
		return OpProcessStart
	case models.EventTypeLogin:
		return OpSignIn
	case models.EventTypeLogout:
		return OpSignOut
	default:
		return ""
	}
}

// fillOperations backfills a display label for events stored without one, so
// the dashboard column is never blank for historical rows.
func fillOperations(events []models.ActivityEvent) {
	for i := range events {
		if events[i].Operation != "" {
			continue
		}
		// Category is the stronger hint where it exists: every DLP event came
		// from an outbound upload, every malware event from a download, no
		// matter which event_type they were filed under.
		switch events[i].Category {
		case "dlp":
			if events[i].Target != "" {
				events[i].Operation = OpFileUpload
			} else {
				events[i].Operation = OpDataSubmit
			}
		case "malware_detection":
			events[i].Operation = OpFileDownload
		default:
			events[i].Operation = operationForEventType(events[i].EventType)
		}
	}
}

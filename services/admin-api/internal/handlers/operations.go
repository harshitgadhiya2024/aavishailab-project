package handlers

import (
	"github.com/aavishield/admin-api/internal/models"
)

// Human-readable operation labels. Kept as constants so the dashboard shows
// one consistent vocabulary rather than per-call-site wording.
const (
	OpEmailSent           = "Email sent"
	OpMessageSent         = "Message sent"
	OpFileUpload          = "File upload"
	OpFileShared          = "File shared"
	OpFileDownload        = "File download"
	OpFormSubmit          = "Form submitted"
	OpDataSubmit          = "Data submitted"
	OpCommentPosted       = "Comment posted"
	OpAIPrompt            = "AI prompt sent"
	OpWebRequest          = "Web request"
	OpDNSQuery            = "DNS lookup"
	OpAppLaunch           = "App launched"
	OpBrowserExtInstalled = "VPN browser extension installed"
	OpBrowserExtRemoved   = "VPN browser extension removed"
	OpFileOperation       = "File operation"
	OpUSBInsert           = "USB device inserted"
	OpProcessStart        = "Process started"
	OpSignIn              = "Sign-in"
	OpSignOut             = "Sign-out"
)

// Classifying a live intercepted request — which of these labels it gets,
// or whether it is a user action at all — is dlp-service's job (see its
// inspect.rs). What stays here is the display fallback for stored events.

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

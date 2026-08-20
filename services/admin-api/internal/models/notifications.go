package models

// NotificationPrefs is which emails an organization wants. It lives on the
// model rather than in a handler because both the API and the background
// notifier need to read it — and putting it in either of those would make them
// import each other.
type NotificationPrefs struct {
	SecurityAlerts   bool `json:"security_alerts"`
	IncidentDigest   bool `json:"incident_digest"`
	DigestThreshold  int  `json:"digest_threshold"`
	WeeklySummary    bool `json:"weekly_summary"`
	InactivityAlerts bool `json:"inactivity_alerts"`
	AccessRequests   bool `json:"access_requests"`
	DeviceEnrolment  bool `json:"device_enrolment"`
}

// DefaultNotificationPrefs is everything on. A security product that quietly
// stops telling you things is worse than one that emails too often, so silence
// is never the default.
func DefaultNotificationPrefs() NotificationPrefs {
	return NotificationPrefs{
		SecurityAlerts:   true,
		IncidentDigest:   true,
		DigestThreshold:  10,
		WeeklySummary:    true,
		InactivityAlerts: true,
		AccessRequests:   true,
		DeviceEnrolment:  true,
	}
}

// NotificationPrefsFor reads an org's stored preferences, filling anything
// unset from the defaults.
func NotificationPrefsFor(org *Organization) NotificationPrefs {
	prefs := DefaultNotificationPrefs()
	if org == nil || org.Settings == nil {
		return prefs
	}
	raw, ok := org.Settings["notification_prefs"].(map[string]any)
	if !ok {
		return prefs
	}
	boolOr := func(key string, fallback bool) bool {
		if v, exists := raw[key].(bool); exists {
			return v
		}
		return fallback
	}
	prefs.SecurityAlerts = boolOr("security_alerts", prefs.SecurityAlerts)
	prefs.IncidentDigest = boolOr("incident_digest", prefs.IncidentDigest)
	prefs.WeeklySummary = boolOr("weekly_summary", prefs.WeeklySummary)
	prefs.InactivityAlerts = boolOr("inactivity_alerts", prefs.InactivityAlerts)
	prefs.AccessRequests = boolOr("access_requests", prefs.AccessRequests)
	prefs.DeviceEnrolment = boolOr("device_enrolment", prefs.DeviceEnrolment)
	if v, exists := raw["digest_threshold"].(float64); exists && v >= 1 {
		prefs.DigestThreshold = int(v)
	}
	return prefs
}

// WantsNotification answers the question handlers actually ask before sending.
func (o *Organization) WantsNotification(kind string) bool {
	prefs := NotificationPrefsFor(o)
	switch kind {
	case "security_alerts":
		return prefs.SecurityAlerts
	case "access_requests":
		return prefs.AccessRequests
	case "device_enrolment":
		return prefs.DeviceEnrolment
	default:
		return true
	}
}

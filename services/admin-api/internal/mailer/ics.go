package mailer

import (
	"fmt"
	"strings"
	"time"
)

// DemoInvite describes one booked demo as a calendar event. UID stays the
// same for the life of a booking and Seq goes up with every change, so a
// reschedule or new meeting link updates the event already on the customer's
// calendar instead of adding a second one, and a cancellation removes it.
type DemoInvite struct {
	UID          string
	Seq          int
	Start        time.Time
	Minutes      int
	MeetingURL   string
	AttendeeName string
	Attendee     string
	Cancel       bool
}

// ICS renders the invite as an iTIP REQUEST (or CANCEL) iCalendar object.
func (d DemoInvite) ICS(now time.Time) (method, ics string) {
	method = "REQUEST"
	status := "CONFIRMED"
	if d.Cancel {
		method, status = "CANCEL", "CANCELLED"
	}
	minutes := d.Minutes
	if minutes <= 0 {
		minutes = 30
	}
	stamp := func(t time.Time) string { return t.UTC().Format("20060102T150405Z") }
	desc := "30-minute walkthrough of your Aavishield console with our team."
	if d.MeetingURL != "" {
		desc += "\n\nJoin: " + d.MeetingURL
	} else {
		desc += "\n\nWe'll email the meeting link before the call."
	}
	organizer := cfg.FromEmail
	if organizer == "" {
		organizer = "noreply@aavishield.com"
	}
	orgName := cfg.FromName
	if orgName == "" {
		orgName = "Aavishield"
	}

	lines := []string{
		"BEGIN:VCALENDAR",
		"PRODID:-//Aavishield//Demo booking//EN",
		"VERSION:2.0",
		"CALSCALE:GREGORIAN",
		"METHOD:" + method,
		"BEGIN:VEVENT",
		"UID:" + d.UID,
		"SEQUENCE:" + fmt.Sprint(d.Seq),
		"DTSTAMP:" + stamp(now),
		"DTSTART:" + stamp(d.Start),
		"DTEND:" + stamp(d.Start.Add(time.Duration(minutes)*time.Minute)),
		"SUMMARY:" + icsText("Aavishield demo"),
		"DESCRIPTION:" + icsText(desc),
		"STATUS:" + status,
		"TRANSP:OPAQUE",
		fmt.Sprintf("ORGANIZER;CN=%s:mailto:%s", icsParam(orgName), organizer),
		fmt.Sprintf("ATTENDEE;CN=%s;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:%s", icsParam(d.AttendeeName), d.Attendee),
	}
	if d.MeetingURL != "" {
		lines = append(lines, "LOCATION:"+icsText(d.MeetingURL), "URL:"+d.MeetingURL)
	}
	if !d.Cancel {
		lines = append(lines, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:"+icsText("Aavishield demo in 15 minutes"), "TRIGGER:-PT15M", "END:VALARM")
	}
	lines = append(lines, "END:VEVENT", "END:VCALENDAR")

	var b strings.Builder
	for _, l := range lines {
		b.WriteString(icsFold(l))
		b.WriteString("\r\n")
	}
	return method, b.String()
}

// icsText escapes a TEXT value (RFC 5545 §3.3.11).
func icsText(s string) string {
	return strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`).Replace(s)
}

// icsParam makes a parameter value safe: quoted, without quotes or line breaks.
func icsParam(s string) string {
	s = strings.NewReplacer(`"`, "", "\r", " ", "\n", " ", ":", " ", ";", " ", ",", " ").Replace(s)
	return `"` + strings.TrimSpace(s) + `"`
}

// icsFold splits a content line into 75-octet pieces joined by CRLF + space,
// never inside a UTF-8 character.
func icsFold(line string) string {
	if len(line) <= 75 {
		return line
	}
	var b strings.Builder
	limit := 75
	for len(line) > limit {
		cut := limit
		for cut > 0 && line[cut]&0xC0 == 0x80 { // don't split a multi-byte rune
			cut--
		}
		b.WriteString(line[:cut])
		b.WriteString("\r\n ")
		line = line[cut:]
		limit = 74 // continuation lines start with the space
	}
	b.WriteString(line)
	return b.String()
}

func (d DemoInvite) part() *CalendarPart {
	method, ics := d.ICS(time.Now())
	return &CalendarPart{Method: method, ICS: ics}
}

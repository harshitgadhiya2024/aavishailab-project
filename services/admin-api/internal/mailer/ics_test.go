package mailer

import (
	"strings"
	"testing"
	"time"
)

func TestDemoInviteRequest(t *testing.T) {
	start := time.Date(2026, 11, 17, 6, 0, 0, 0, time.UTC)
	inv := DemoInvite{UID: "abc@aavishield.com", Seq: 2, Start: start, AttendeeName: "Priya; Rao", Attendee: "p@acme.co",
		MeetingURL: "https://meet.example.com/x?a=1,b=2"}
	method, ics := inv.ICS(start.Add(-time.Hour))
	if method != "REQUEST" {
		t.Fatalf("method %s", method)
	}
	for _, want := range []string{
		"METHOD:REQUEST", "UID:abc@aavishield.com", "SEQUENCE:2", "DTSTART:20261117T060000Z", "DTEND:20261117T063000Z",
		"STATUS:CONFIRMED", "TRIGGER:-PT15M", `ATTENDEE;CN="Priya  Rao"`, "mailto:p@acme.co",
		`LOCATION:https://meet.example.com/x?a=1\,b=2`,
	} {
		if !strings.Contains(unfold(ics), want) {
			t.Errorf("missing %q in\n%s", want, ics)
		}
	}
	for _, line := range strings.Split(ics, "\r\n") {
		if len(line) > 75 {
			t.Errorf("line over 75 octets: %q", line)
		}
	}
}

func TestDemoInviteCancel(t *testing.T) {
	inv := DemoInvite{UID: "abc@aavishield.com", Seq: 3, Start: time.Now(), Attendee: "p@acme.co", Cancel: true}
	method, ics := inv.ICS(time.Now())
	if method != "CANCEL" || !strings.Contains(ics, "METHOD:CANCEL") || !strings.Contains(ics, "STATUS:CANCELLED") || !strings.Contains(ics, "SEQUENCE:3") {
		t.Fatalf("bad cancel:\n%s", ics)
	}
	if strings.Contains(ics, "VALARM") {
		t.Error("a cancellation shouldn't carry an alarm")
	}
}

func TestICSFoldKeepsRunesWhole(t *testing.T) {
	line := "DESCRIPTION:" + strings.Repeat("₹", 60)
	folded := icsFold(line)
	if unfold(folded) != line {
		t.Fatal("fold/unfold changed the text")
	}
	for _, part := range strings.Split(folded, "\r\n") {
		if len(part) > 75 || !strings.HasPrefix(strings.TrimPrefix(part, " "), strings.TrimPrefix(part, " ")) {
			t.Errorf("bad piece %q", part)
		}
	}
}

func TestBuildMIMEWithInvite(t *testing.T) {
	inv := DemoInvite{UID: "u@aavishield.com", Start: time.Now(), Attendee: "p@acme.co"}
	raw := string(buildMIME(Message{To: []string{"p@acme.co"}, Subject: "s", HTML: "<p>hi</p>", Calendar: inv.part()}))
	for _, want := range []string{"multipart/mixed", "multipart/alternative", "text/calendar; charset=UTF-8; method=REQUEST", `filename="invite.ics"`, "BEGIN:VCALENDAR"} {
		if !strings.Contains(raw, want) {
			t.Errorf("missing %q", want)
		}
	}
	plain := string(buildMIME(Message{To: []string{"p@acme.co"}, Subject: "s", HTML: "<p>hi</p>"}))
	if strings.Contains(plain, "multipart/mixed") || strings.Contains(plain, "text/calendar") {
		t.Error("an email without an invite changed shape")
	}
}

func unfold(s string) string { return strings.ReplaceAll(s, "\r\n ", "") }

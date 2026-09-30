package handlers

import (
	"strings"
	"testing"

	"github.com/aavishield/admin-api/internal/mailer"
)

func TestExtractReply(t *testing.T) {
	cases := map[string]struct{ in, want string }{
		"gmail wrapped wrote line": {
			"Turned it on, thanks!\n\nOn Wed, 30 Sep 2026 at 17:24, Delsecure Security <info@aavishailab.com>\nwrote:\n> Hi Utsavi,\n> Open System Settings",
			"Turned it on, thanks!",
		},
		"gmail one line":    {"Done.\nOn Wed, 30 Sep 2026, Delsecure wrote:\n> old", "Done."},
		"outlook separator": {"Still failing after reboot.\r\n\r\n________________________________\r\nFrom: Delsecure\r\nSent: Wednesday", "Still failing after reboot."},
		"outlook headers":   {"Works now\n\nFrom: Delsecure <info@aavishailab.com>\nSent: 30 September 2026 17:24\nTo: Utsavi", "Works now"},
		"our marker":        {"Here is the log\n\n" + mailer.ReplyMarker + " Reply to this email\nHarshit replied", "Here is the log"},
		"quoted tail":       {"Yes please\n> earlier text\n> more", "Yes please"},
		"only quote":        {"On Wed, X wrote:\n> hi", ""},
		"keeps inline":      {"Line one\nLine two with > inside", "Line one\nLine two with > inside"},
	}
	for name, c := range cases {
		if got := extractReply(c.in); got != c.want {
			t.Errorf("%s: got %q, want %q", name, got, c.want)
		}
	}
}

func TestThreadIDSignature(t *testing.T) {
	t.Setenv("TICKET_MAIL_SECRET", "s3cret")
	id := "0b8f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"
	root := mailer.ThreadMessageID(id, "customer")
	if got, side, ok := mailer.ParseThreadID("<abc@gmail.com> " + root); !ok || got != id || side != "customer" {
		t.Fatalf("valid id not parsed: %v %v %v", got, side, ok)
	}
	// A different ticket with the same signature, or another side, must fail.
	forged := strings.Replace(root, id, "11111111-2222-3333-4444-555555555555", 1)
	if _, _, ok := mailer.ParseThreadID(forged); ok {
		t.Fatal("forged ticket id accepted")
	}
	if _, _, ok := mailer.ParseThreadID(strings.Replace(root, ".customer.", ".team.", 1)); ok {
		t.Fatal("side swap accepted")
	}
	t.Setenv("TICKET_MAIL_SECRET", "other")
	if _, _, ok := mailer.ParseThreadID(root); ok {
		t.Fatal("id signed with another secret accepted")
	}
}

func TestParseMailMultipart(t *testing.T) {
	raw := strings.Join([]string{
		"From: Utsavi Narola <Utsavi@Delphic.in>",
		"To: info@aavishailab.com",
		"Subject: Re: [DS-1002] Firewall",
		"Message-ID: <reply-1@mail.gmail.com>",
		"In-Reply-To: <t.x.customer.y@aavishailab.com>",
		"MIME-Version: 1.0",
		`Content-Type: multipart/mixed; boundary="b1"`,
		"",
		"--b1",
		`Content-Type: text/plain; charset="iso-8859-1"`,
		"Content-Transfer-Encoding: quoted-printable",
		"",
		"Fix=E9 now, merci.",
		"",
		"On Wed, Delsecure wrote:",
		"> old",
		"--b1",
		"Content-Type: text/plain",
		`Content-Disposition: attachment; filename="agent.log"`,
		"",
		"2026-09-30 firewall=on",
		"--b1--",
		"",
	}, "\r\n")
	m, err := parseMail([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if m.From != "utsavi@delphic.in" || m.MessageID != "<reply-1@mail.gmail.com>" || m.AutoReply {
		t.Fatalf("headers: %+v", m)
	}
	if got := extractReply(m.Text); got != "Fixé now, merci." {
		t.Fatalf("body = %q", got)
	}
	if len(m.Files) != 1 || m.Files[0].Name != "agent.log" {
		t.Fatalf("attachments: %+v", m.Files)
	}
	ok, dropped := emailAttachments(append(m.Files, rawFile{Name: "run.exe", Data: []byte("MZ")}))
	if len(ok) != 1 || len(dropped) != 1 {
		t.Fatalf("attachment vetting: ok=%d dropped=%v", len(ok), dropped)
	}
}

func TestParseMailAutoReplyAndHTML(t *testing.T) {
	raw := "From: a@b.com\r\nAuto-Submitted: auto-replied\r\nContent-Type: text/html\r\n\r\n<p>I am <b>out</b>&nbsp;of office</p><style>p{}</style>"
	m, err := parseMail([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !m.AutoReply || !strings.Contains(m.Text, "I am out") {
		t.Fatalf("auto=%v text=%q", m.AutoReply, m.Text)
	}
}

package handlers

import "testing"

// The DLP log's "Request" column is the reason this exists: it has to say
// "App" or "Browser" for every incident, from nothing but the User-Agent the
// proxy happened to see.
func TestClassifyDLPRequestSource(t *testing.T) {
	cases := []struct {
		name      string
		userAgent string
		explicit  string
		want      string
	}{
		{"chrome", "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "", "browser"},
		{"firefox", "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "", "browser"},
		{"edge", "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0", "", "browser"},
		{"safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", "", "browser"},

		{"slack desktop", "Slack/4.35.126 Chrome/114.0 Electron/25.9.0", "", "app"},
		{"postman", "PostmanRuntime/7.36.0", "", "app"},
		{"curl", "curl/8.4.0", "", "app"},
		{"python", "python-requests/2.31.0", "", "app"},

		// The agent sometimes knows directly which local process owns the
		// connection; when it does, that outranks any UA guess.
		{"explicit app beats browser UA", "Mozilla/5.0 Chrome/120.0 Safari/537.36", "app", "app"},
		{"explicit browser beats app UA", "curl/8.4.0", "browser", "browser"},
		{"explicit garbage is ignored", "curl/8.4.0", "spaceship", "app"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyDLPRequestSource(tc.userAgent, tc.explicit); got != tc.want {
				t.Errorf("classifyDLPRequestSource(%q, %q) = %q, want %q", tc.userAgent, tc.explicit, got, tc.want)
			}
		})
	}
}

// An absent User-Agent must report "app", never "browser". Every real browser
// sends one, so silence means something that is not a browser — and guessing
// "browser" would mislabel exactly the native-app traffic this column exists
// to surface.
func TestClassifyDLPRequestSourceDefaultsToAppWhenUnknown(t *testing.T) {
	for _, ua := range []string{"", "   ", "SomeInternalTool/1.0"} {
		if got := classifyDLPRequestSource(ua, ""); got != "app" {
			t.Errorf("classifyDLPRequestSource(%q, \"\") = %q, want app", ua, got)
		}
	}
}

// Electron apps ship a full Chrome User-Agent. Matching the browser markers
// first would label every desktop Slack/Teams/Discord upload "Browser", which
// is the single most common way this column could be wrong.
func TestElectronAppsAreNotMistakenForBrowsers(t *testing.T) {
	ua := "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/114.0.5735.289 Electron/25.9.0 Safari/537.36"
	if got := classifyDLPRequestSource(ua, ""); got != "app" {
		t.Errorf("Electron UA classified as %q, want app", got)
	}
}

func TestDLPContentKind(t *testing.T) {
	cases := []struct {
		name        string
		filename    string
		contentType string
		want        string
	}{
		{"named file wins over content type", "salaries.xlsx", "application/json", "file-upload"},
		{"multipart is a file upload", "", "multipart/form-data; boundary=x", "file-upload"},
		{"json is text", "", "application/json", "text"},
		{"plain text is text", "", "text/plain; charset=utf-8", "text"},
		{"html is text", "", "text/html", "text"},
		{"form encoded is text", "", "application/x-www-form-urlencoded", "text"},
		{"no content type at all is text", "", "", "text"},
		// A body we can't name is a file, because that is what it is —
		// calling an opaque binary blob "text" would be plainly wrong.
		{"unknown binary is a file", "", "application/octet-stream", "file-upload"},
		{"image is a file", "", "image/png", "file-upload"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := dlpContentKind(tc.filename, tc.contentType); got != tc.want {
				t.Errorf("dlpContentKind(%q, %q) = %q, want %q", tc.filename, tc.contentType, got, tc.want)
			}
		})
	}
}

func TestDLPDestinationLabel(t *testing.T) {
	cases := map[string]string{
		"www.slack.com:443":        "slack.com",
		"https://drive.google.com": "drive.google.com",
		"UPLOADS.Example.COM":      "uploads.example.com",
		"":                         "",
	}
	for in, want := range cases {
		if got := dlpDestinationLabel(in); got != want {
			t.Errorf("dlpDestinationLabel(%q) = %q, want %q", in, got, want)
		}
	}
}

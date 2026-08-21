package handlers

import "testing"

// sniffIconType identifies uploads by their own magic numbers rather than
// trusting a browser-supplied Content-Type, which the multipart form
// header can set to anything (including a lie) — this is what actually
// gates what allowedIconTypes accepts.
func TestSniffIconType(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n" + "rest of file")
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}
	webp := append([]byte("RIFF\x00\x00\x00\x00"), []byte("WEBPVP8 ")...)
	ico := []byte{0x00, 0x00, 0x01, 0x00, 0x01, 0x00}
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>`)
	svgWithXMLProlog := []byte("<?xml version=\"1.0\"?>\n<svg></svg>")
	garbage := []byte("this is not an image")

	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"png", png, "image/png"},
		{"jpeg", jpeg, "image/jpeg"},
		{"webp", webp, "image/webp"},
		{"ico", ico, "image/x-icon"},
		{"svg", svg, "image/svg+xml"},
		{"svg with xml prolog", svgWithXMLProlog, "image/svg+xml"},
		{"garbage falls through to net/http sniffing, not a spoofable allowed type", garbage, "text/plain; charset=utf-8"},
	}
	for _, tc := range cases {
		if got := sniffIconType(tc.data); got != tc.want {
			t.Errorf("%s: sniffIconType() = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// The allow-list is what UploadIcon actually gates on — confirms garbage
// bytes sniffed as text/plain (or anything else not on the list) get
// rejected rather than silently accepted with a wrong extension.
func TestAllowedIconTypesRejectsUnlisted(t *testing.T) {
	if _, ok := allowedIconTypes["text/plain; charset=utf-8"]; ok {
		t.Fatal("text/plain must not be an allowed icon type")
	}
	for _, want := range []string{"image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/x-icon"} {
		if _, ok := allowedIconTypes[want]; !ok {
			t.Errorf("expected %q to be an allowed icon type", want)
		}
	}
}

package dlp

import "testing"

func TestDetectCreditCard(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantHit bool
	}{
		{"valid visa", "Card number: 4111111111111111", true},
		{"valid visa with spaces", "4111 1111 1111 1111", true},
		{"valid visa with dashes", "4111-1111-1111-1111", true},
		{"invalid luhn", "Order ID: 1234567890123456", false},
		{"too short", "1234567890", false},
		{"random 16 digit non-luhn", "9999999999999999", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := len(DetectCreditCard(c.input)) > 0
			if got != c.wantHit {
				t.Errorf("DetectCreditCard(%q) hit=%v, want %v", c.input, got, c.wantHit)
			}
		})
	}
}

func TestDetectPAN(t *testing.T) {
	if len(DetectPAN("PAN: ABCDE1234F")) == 0 {
		t.Error("expected PAN match for ABCDE1234F")
	}
	if len(DetectPAN("nothing sensitive here")) != 0 {
		t.Error("expected no PAN match for plain text")
	}
}

func TestDetectAadhaar(t *testing.T) {
	// 234123412346 is a known Verhoeff-valid Aadhaar test number.
	if len(DetectAadhaar("Aadhaar: 2341 2341 2346")) == 0 {
		t.Error("expected Aadhaar match for known-valid test number")
	}
	if len(DetectAadhaar("Phone: 9999999999999")) != 0 {
		t.Error("expected no Aadhaar match for arbitrary digit run")
	}
	if len(DetectAadhaar("some 12 digit number 123456789012 here")) != 0 {
		t.Error("expected checksum to reject a non-Aadhaar 12-digit number")
	}
}

func TestDetectAWSKey(t *testing.T) {
	if len(DetectAWSKey("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE")) == 0 {
		t.Error("expected AWS key match")
	}
	if len(DetectAWSKey("no keys here")) != 0 {
		t.Error("expected no AWS key match")
	}
}

func TestDetectGitHubToken(t *testing.T) {
	token := "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789ABCD"
	if len(DetectGitHubToken(token)) == 0 {
		t.Error("expected GitHub token match")
	}
}

func TestDetectGenericAPIKey(t *testing.T) {
	if len(DetectGenericAPIKey(`api_key: "sk_live_abcdefghijklmnop"`)) == 0 {
		t.Error("expected generic api key match")
	}
	if len(DetectGenericAPIKey("just some regular sentence")) != 0 {
		t.Error("expected no generic api key match")
	}
}

func TestDetectSourceCode(t *testing.T) {
	if len(DetectSourceCode("main.go")) == 0 {
		t.Error("expected source code match for .go file")
	}
	if len(DetectSourceCode("readme.txt")) != 0 {
		t.Error("expected no source code match for .txt file")
	}
}

func TestDetectKeywords(t *testing.T) {
	matches := DetectKeywords("This document is CONFIDENTIAL", []string{"confidential"})
	if len(matches) == 0 {
		t.Error("expected case-insensitive keyword match")
	}
}

func TestDetectCustomPatterns(t *testing.T) {
	patterns := []CustomPattern{{Name: "Project Codename", Regex: `PROJECT-X-\d+`}}
	if len(DetectCustomPatterns("see PROJECT-X-42 for details", patterns)) == 0 {
		t.Error("expected custom pattern match")
	}
	// Invalid regex must not panic or error the caller.
	bad := []CustomPattern{{Name: "bad", Regex: "("}}
	if len(DetectCustomPatterns("anything", bad)) != 0 {
		t.Error("expected invalid regex to be skipped, not matched")
	}
}

func TestLuhnValid(t *testing.T) {
	if !luhnValid("4111111111111111") {
		t.Error("expected valid Luhn for test Visa number")
	}
	if luhnValid("4111111111111112") {
		t.Error("expected invalid Luhn for tampered number")
	}
}

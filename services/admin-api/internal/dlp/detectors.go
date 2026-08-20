// Package dlp implements Data Loss Prevention content scanning: regex/keyword
// detectors for common sensitive-data types, run against file/request-body
// bytes an org's DLP policies ask to be checked for.
//
// Honest limitation: these are pattern/checksum detectors, not ML
// classifiers — they catch well-formed identifiers (a real-looking credit
// card number, a PAN/Aadhaar-shaped string, a recognizable cloud credential
// prefix) and configured keywords. They will miss data that doesn't match a
// known shape (e.g. a customer list pasted as unstructured prose) and can
// false-positive on coincidental digit strings; policies should be tuned
// per-org rather than treated as a compliance guarantee.
package dlp

import (
	"regexp"
	"strconv"
	"strings"
)

type Detector string

const (
	DetectorCreditCard    Detector = "credit_card"
	DetectorPAN           Detector = "pan_india"
	DetectorAadhaar       Detector = "aadhaar"
	DetectorAWSKey        Detector = "aws_key"
	DetectorGitHubToken   Detector = "github_token"
	DetectorGenericAPIKey Detector = "generic_api_key"
	DetectorSourceCode    Detector = "source_code"
	DetectorKeyword       Detector = "keyword"
	DetectorCustomRegex   Detector = "custom_regex"
)

// BuiltinDetectorLabels drives the dashboard's detector picker and the
// GetTypes-style discovery endpoints — keeping display strings out of the
// frontend so backend and UI can't drift.
var BuiltinDetectorLabels = map[Detector]string{
	DetectorCreditCard:    "Credit Card Number",
	DetectorPAN:           "PAN Card (India)",
	DetectorAadhaar:       "Aadhaar Number (India)",
	DetectorAWSKey:        "AWS Access Key",
	DetectorGitHubToken:   "GitHub Token",
	DetectorGenericAPIKey: "Generic API Key / Secret",
	DetectorSourceCode:    "Source Code File",
}

// Match is one detector hit against the scanned content.
type Match struct {
	Detector Detector `json:"detector"`
	Label    string   `json:"label"`
	// Preview is a redacted, safe-to-log excerpt — never the full matched
	// value (see redact.go).
	Preview string `json:"preview"`
}

var (
	// Candidate digit runs (with optional space/dash separators) long enough
	// to be a card number; Luhn-validated below to cut false positives from
	// arbitrary long numbers (invoice IDs, phone numbers, etc.).
	creditCardCandidate = regexp.MustCompile(`\b(?:\d[ -]?){13,19}\b`)

	// India PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).
	panRegex = regexp.MustCompile(`\b[A-Z]{5}[0-9]{4}[A-Z]\b`)

	// India Aadhaar: 12 digits, optionally space/dash grouped in 4s.
	aadhaarRegex = regexp.MustCompile(`\b\d{4}[ -]?\d{4}[ -]?\d{4}\b`)

	awsKeyRegex = regexp.MustCompile(`\b(AKIA|ASIA)[0-9A-Z]{16}\b`)

	githubTokenRegex = regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{36,255}\b`)

	// Generic "key/secret/token/password: <value>" assignment — deliberately
	// conservative (requires an adjacent keyword) to avoid matching every
	// long alphanumeric string in a file.
	genericAPIKeyRegex = regexp.MustCompile(`(?i)(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password)\s*[:=]\s*['"]?([A-Za-z0-9_\-/+]{12,})['"]?`)

	sourceCodeExtensions = []string{
		".go", ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
		".cs", ".rb", ".php", ".rs", ".swift", ".kt", ".scala", ".sql", ".sh", ".pl",
	}
)

// DetectCreditCard finds Luhn-valid card-shaped digit runs.
func DetectCreditCard(data string) []Match {
	var matches []Match
	for _, raw := range creditCardCandidate.FindAllString(data, -1) {
		digits := stripSeparators(raw)
		if len(digits) < 13 || len(digits) > 19 {
			continue
		}
		if !luhnValid(digits) {
			continue
		}
		matches = append(matches, Match{
			Detector: DetectorCreditCard,
			Label:    BuiltinDetectorLabels[DetectorCreditCard],
			Preview:  redactDigits(digits),
		})
	}
	return matches
}

// DetectPAN finds India PAN-shaped identifiers (format only — PAN has no
// public checksum to validate against).
func DetectPAN(data string) []Match {
	var matches []Match
	for _, raw := range panRegex.FindAllString(strings.ToUpper(data), -1) {
		matches = append(matches, Match{
			Detector: DetectorPAN,
			Label:    BuiltinDetectorLabels[DetectorPAN],
			Preview:  redactAlnum(raw),
		})
	}
	return matches
}

// DetectAadhaar finds 12-digit runs that pass the Aadhaar Verhoeff checksum,
// which real Aadhaar numbers must satisfy — this is what keeps an arbitrary
// 12-digit phone/order number from tripping the detector.
func DetectAadhaar(data string) []Match {
	var matches []Match
	for _, raw := range aadhaarRegex.FindAllString(data, -1) {
		digits := stripSeparators(raw)
		if len(digits) != 12 {
			continue
		}
		if !verhoeffValid(digits) {
			continue
		}
		matches = append(matches, Match{
			Detector: DetectorAadhaar,
			Label:    BuiltinDetectorLabels[DetectorAadhaar],
			Preview:  redactDigits(digits),
		})
	}
	return matches
}

func DetectAWSKey(data string) []Match {
	var matches []Match
	for _, raw := range awsKeyRegex.FindAllString(data, -1) {
		matches = append(matches, Match{
			Detector: DetectorAWSKey,
			Label:    BuiltinDetectorLabels[DetectorAWSKey],
			Preview:  redactAlnum(raw),
		})
	}
	return matches
}

func DetectGitHubToken(data string) []Match {
	var matches []Match
	for _, raw := range githubTokenRegex.FindAllString(data, -1) {
		matches = append(matches, Match{
			Detector: DetectorGitHubToken,
			Label:    BuiltinDetectorLabels[DetectorGitHubToken],
			Preview:  redactAlnum(raw),
		})
	}
	return matches
}

func DetectGenericAPIKey(data string) []Match {
	var matches []Match
	for _, groups := range genericAPIKeyRegex.FindAllStringSubmatch(data, -1) {
		if len(groups) < 3 {
			continue
		}
		matches = append(matches, Match{
			Detector: DetectorGenericAPIKey,
			Label:    BuiltinDetectorLabels[DetectorGenericAPIKey],
			Preview:  groups[1] + "=" + redactAlnum(groups[2]),
		})
	}
	return matches
}

// DetectSourceCode flags a file purely by its extension — reliable content
// classification (vs. e.g. a plaintext README) needs an ML model, which is
// out of scope here; extension matching is what "Block: Source Code" means
// in practice for an MVP.
func DetectSourceCode(filename string) []Match {
	lower := strings.ToLower(filename)
	for _, ext := range sourceCodeExtensions {
		if strings.HasSuffix(lower, ext) {
			return []Match{{
				Detector: DetectorSourceCode,
				Label:    BuiltinDetectorLabels[DetectorSourceCode],
				Preview:  filename,
			}}
		}
	}
	return nil
}

// DetectKeywords does a case-insensitive substring search for each
// configured keyword (e.g. "confidential", "customer database").
func DetectKeywords(data string, keywords []string) []Match {
	var matches []Match
	lower := strings.ToLower(data)
	for _, kw := range keywords {
		kw = strings.TrimSpace(kw)
		if kw == "" {
			continue
		}
		if strings.Contains(lower, strings.ToLower(kw)) {
			matches = append(matches, Match{
				Detector: DetectorKeyword,
				Label:    "Keyword: " + kw,
				Preview:  kw,
			})
		}
	}
	return matches
}

// CustomPattern is an org-defined named regex (e.g. an internal project
// codename or account-number format the built-in detectors don't cover).
type CustomPattern struct {
	Name  string `json:"name"`
	Regex string `json:"regex"`
}

// DetectCustomPatterns compiles and runs org-supplied regexes. An invalid
// regex is skipped rather than failing the whole scan — a typo'd custom
// pattern shouldn't take down DLP enforcement for every other detector.
func DetectCustomPatterns(data string, patterns []CustomPattern) []Match {
	var matches []Match
	for _, p := range patterns {
		re, err := regexp.Compile(p.Regex)
		if err != nil {
			continue
		}
		if re.MatchString(data) {
			matches = append(matches, Match{
				Detector: DetectorCustomRegex,
				Label:    "Custom: " + p.Name,
				Preview:  p.Name,
			})
		}
	}
	return matches
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func stripSeparators(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// luhnValid implements the standard Luhn mod-10 checksum used by every major
// card network (Visa/Mastercard/Amex/Discover/RuPay).
func luhnValid(digits string) bool {
	sum := 0
	alt := false
	for i := len(digits) - 1; i >= 0; i-- {
		d, err := strconv.Atoi(string(digits[i]))
		if err != nil {
			return false
		}
		if alt {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		alt = !alt
	}
	return sum%10 == 0
}

// Verhoeff multiplication/permutation tables — the checksum algorithm UIDAI
// specifies for Aadhaar numbers.
var verhoeffD = [10][10]int{
	{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
	{1, 2, 3, 4, 0, 6, 7, 8, 9, 5},
	{2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
	{3, 4, 0, 1, 2, 8, 9, 5, 6, 7},
	{4, 0, 1, 2, 3, 9, 5, 6, 7, 8},
	{5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
	{6, 5, 9, 8, 7, 1, 0, 4, 3, 2},
	{7, 6, 5, 9, 8, 2, 1, 0, 4, 3},
	{8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
	{9, 8, 7, 6, 5, 4, 3, 2, 1, 0},
}
var verhoeffP = [8][10]int{
	{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
	{1, 5, 7, 6, 2, 8, 3, 0, 9, 4},
	{5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
	{8, 9, 1, 6, 0, 4, 3, 5, 2, 7},
	{9, 4, 5, 3, 1, 2, 6, 8, 7, 0},
	{4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
	{2, 7, 9, 3, 8, 0, 6, 4, 1, 5},
	{7, 0, 4, 6, 9, 1, 3, 2, 5, 8},
}

func verhoeffValid(digits string) bool {
	c := 0
	// Verhoeff checks digits in reverse order, including the checksum digit
	// itself as position 0.
	for i, r := range reverseString(digits) {
		d := int(r - '0')
		if d < 0 || d > 9 {
			return false
		}
		c = verhoeffD[c][verhoeffP[i%8][d]]
	}
	return c == 0
}

func reverseString(s string) string {
	runes := []rune(s)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}

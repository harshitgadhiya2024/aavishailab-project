// Package catalog classifies a domain as a known cloud/SaaS application, with
// a category and a 0-100 risk score. The built-in seed covers common SaaS; a
// JSON override file can extend it toward a much larger app database.
//
// Risk reflects data-exfiltration / compliance exposure of the app category —
// personal file-sharing and AI tools score higher (a place company data can
// leak to), collaboration suites lower.
package catalog

import (
	"encoding/json"
	"os"
	"strings"
)

type App struct {
	App       string `json:"app"`
	Category  string `json:"category"`
	RiskScore int    `json:"risk_score"`
}

type Result struct {
	Domain  string `json:"domain"`
	Matched bool   `json:"matched"`
	App     string `json:"app"`
	// DisplayName is always populated, unlike App: the catalog's product name
	// when the domain is known, otherwise the registrable domain. Callers that
	// need a label for a UI ("Microsoft Teams" rather than the raw hostname
	// turing-writingassistance.edge.microsoft.com) should read this; callers
	// doing shadow-IT logic should keep gating on Matched/App.
	DisplayName string `json:"display_name"`
	Category    string `json:"category"`
	RiskScore   int    `json:"risk_score"`
}

// seed is the built-in catalog, keyed by registrable domain.
var seed = map[string]App{
	// Personal file sharing / transfer — highest exfil risk
	"dropbox.com":    {"Dropbox", "cloud_storage", 60},
	"wetransfer.com": {"WeTransfer", "file_transfer", 72},
	"mega.nz":        {"MEGA", "file_transfer", 78},
	"mediafire.com":  {"MediaFire", "file_transfer", 75},
	"sendspace.com":  {"SendSpace", "file_transfer", 74},
	"anonfiles.com":  {"AnonFiles", "file_transfer", 85},
	"box.com":        {"Box", "cloud_storage", 50},
	"icloud.com":     {"iCloud", "cloud_storage", 48},
	// AI tools — data-leakage risk
	"openai.com":        {"OpenAI / ChatGPT", "ai_tools", 65},
	"chatgpt.com":       {"ChatGPT", "ai_tools", 65},
	"claude.ai":         {"Claude", "ai_tools", 60},
	"gemini.google.com": {"Google Gemini", "ai_tools", 58},
	"perplexity.ai":     {"Perplexity", "ai_tools", 55},
	"huggingface.co":    {"Hugging Face", "ai_tools", 50},
	"midjourney.com":    {"Midjourney", "ai_tools", 45},
	// Cloud storage / productivity suites
	"drive.google.com":  {"Google Drive", "cloud_storage", 45},
	"docs.google.com":   {"Google Docs", "productivity", 40},
	"onedrive.live.com": {"OneDrive", "cloud_storage", 45},
	"sharepoint.com":    {"SharePoint", "cloud_storage", 40},
	// Microsoft 365 / Windows. Ordered specific -> generic; Classify walks
	// parent domains and takes the first hit, so teams.microsoft.com wins over
	// microsoft.com. `cloud.microsoft` is the M365 service gTLD (e.g.
	// editor.svc.cloud.microsoft = Microsoft Editor).
	"teams.microsoft.com": {"Microsoft Teams", "communication", 28},
	"edge.microsoft.com":  {"Microsoft Edge", "browser_services", 20},
	"office.com":          {"Microsoft 365", "productivity", 38},
	"office365.com":       {"Microsoft 365", "productivity", 38},
	"cloud.microsoft":     {"Microsoft 365", "productivity", 38},
	"outlook.com":         {"Outlook", "communication", 38},
	"outlook.office.com":  {"Outlook", "communication", 38},
	"microsoftonline.com": {"Microsoft Entra ID", "security", 20},
	"live.com":            {"Microsoft Account", "productivity", 30},
	"windowsupdate.com":   {"Windows Update", "os_services", 10},
	"msn.com":             {"MSN", "news_media", 25},
	"bing.com":            {"Bing", "search", 25},
	"microsoft.com":       {"Microsoft", "productivity", 25},
	// Google. drive/docs/gemini above are more specific and win the walk.
	"mail.google.com":     {"Gmail", "communication", 40},
	"gmail.com":           {"Gmail", "communication", 40},
	"meet.google.com":     {"Google Meet", "communication", 25},
	"calendar.google.com": {"Google Calendar", "productivity", 30},
	"youtube.com":         {"YouTube", "social_media", 30},
	"google.com":          {"Google", "search", 25},
	"googleapis.com":      {"Google APIs", "os_services", 20},
	// Apple
	"apple.com": {"Apple", "os_services", 15},
	"me.com":    {"iCloud Mail", "communication", 40},
	// Other mail providers — personal webmail is a classic exfil path
	"mail.yahoo.com": {"Yahoo Mail", "communication", 55},
	"proton.me":      {"Proton Mail", "communication", 60},
	"protonmail.com": {"Proton Mail", "communication", 60},
	"zoho.com":       {"Zoho", "productivity", 40},
	"mail.com":       {"Mail.com", "communication", 58},
	"yandex.com":     {"Yandex", "communication", 58},
	// Atlassian / design / e-sign
	"atlassian.net": {"Atlassian (Jira/Confluence)", "productivity", 35},
	"atlassian.com": {"Atlassian", "productivity", 35},
	"figma.com":     {"Figma", "productivity", 40},
	"canva.com":     {"Canva", "productivity", 40},
	"docusign.com":  {"DocuSign", "business", 30},
	"calendly.com":  {"Calendly", "productivity", 28},
	// Cloud infrastructure
	"amazonaws.com":  {"AWS", "cloud_storage", 45},
	"azure.com":      {"Microsoft Azure", "cloud_storage", 40},
	"cloudflare.com": {"Cloudflare", "os_services", 20},
	"notion.so":      {"Notion", "productivity", 42},
	"airtable.com":   {"Airtable", "productivity", 40},
	"evernote.com":   {"Evernote", "productivity", 45},
	"trello.com":     {"Trello", "productivity", 35},
	"asana.com":      {"Asana", "productivity", 32},
	"monday.com":     {"Monday.com", "productivity", 32},
	// Communication
	"slack.com":        {"Slack", "communication", 28},
	"zoom.us":          {"Zoom", "communication", 25},
	"discord.com":      {"Discord", "communication", 45},
	"telegram.org":     {"Telegram", "communication", 55},
	"web.whatsapp.com": {"WhatsApp Web", "communication", 50},
	// Dev tools — source-code exfil risk
	"github.com":    {"GitHub", "dev_tools", 45},
	"gitlab.com":    {"GitLab", "dev_tools", 45},
	"bitbucket.org": {"Bitbucket", "dev_tools", 45},
	"pastebin.com":  {"Pastebin", "dev_tools", 70},
	"codepen.io":    {"CodePen", "dev_tools", 40},
	"replit.com":    {"Replit", "dev_tools", 45},
	"ngrok.com":     {"ngrok", "dev_tools", 68},
	// Social
	"facebook.com":  {"Facebook", "social_media", 35},
	"twitter.com":   {"X / Twitter", "social_media", 30},
	"x.com":         {"X / Twitter", "social_media", 30},
	"instagram.com": {"Instagram", "social_media", 32},
	"tiktok.com":    {"TikTok", "social_media", 55},
	"linkedin.com":  {"LinkedIn", "social_media", 25},
	"reddit.com":    {"Reddit", "social_media", 30},
	// CRM / business
	"salesforce.com": {"Salesforce", "business", 30},
	"hubspot.com":    {"HubSpot", "business", 30},
	"zendesk.com":    {"Zendesk", "business", 28},
	// Password managers (low risk — generally sanctioned)
	"lastpass.com":  {"LastPass", "security", 20},
	"1password.com": {"1Password", "security", 15},
	"bitwarden.com": {"Bitwarden", "security", 15},
}

// categoryRisk backs the JSON override when an entry omits an explicit score.
var categoryRisk = map[string]int{
	"file_transfer": 72, "ai_tools": 60, "cloud_storage": 48, "dev_tools": 45,
	"communication": 30, "social_media": 32, "productivity": 38, "business": 30,
	"security": 18, "search": 25, "news_media": 25, "browser_services": 20,
	"os_services": 12, "unknown": 0,
}

// multiPartSuffixes are public suffixes with two labels, so the registrable
// domain of foo.example.co.uk is example.co.uk rather than co.uk. Covers the
// common ones without pulling in a full public-suffix list.
var multiPartSuffixes = map[string]bool{
	"co.uk": true, "org.uk": true, "ac.uk": true, "gov.uk": true,
	"co.in": true, "net.in": true, "org.in": true,
	"com.au": true, "net.au": true, "org.au": true,
	"co.jp": true, "co.nz": true, "co.za": true, "com.br": true,
	"com.sg": true, "com.hk": true, "com.mx": true, "com.tr": true,
}

type Catalog struct {
	apps map[string]App
}

func New() *Catalog {
	c := &Catalog{apps: map[string]App{}}
	for k, v := range seed {
		c.apps[k] = v
	}
	return c
}

// LoadOverride merges entries from a JSON file: {"domain": {"app","category","risk_score"}}.
func (c *Catalog) LoadOverride(path string) error {
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var extra map[string]App
	if err := json.Unmarshal(data, &extra); err != nil {
		return err
	}
	for domain, app := range extra {
		if app.RiskScore == 0 {
			if r, ok := categoryRisk[app.Category]; ok {
				app.RiskScore = r
			}
		}
		c.apps[strings.ToLower(domain)] = app
	}
	return nil
}

func (c *Catalog) Size() int { return len(c.apps) }

func norm(d string) string {
	d = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(d, ".")))
	return strings.TrimPrefix(d, "www.")
}

// Classify matches a domain (walking parent domains, so api.dropbox.com hits
// dropbox.com) against the catalog.
func (c *Catalog) Classify(domain string) Result {
	d := norm(domain)

	if app, ok := c.apps[d]; ok {
		return hit(d, app)
	}
	parts := strings.Split(d, ".")
	for i := 1; i < len(parts)-1; i++ {
		parent := strings.Join(parts[i:], ".")
		if app, ok := c.apps[parent]; ok {
			return hit(d, app)
		}
	}
	// Unknown app: still hand back something a UI can show. The registrable
	// domain drops the noisy service labels a raw hostname carries, so
	// browser.events.data.example.com reads as example.com.
	return Result{Domain: d, Category: "unknown", DisplayName: Registrable(d)}
}

func hit(domain string, app App) Result {
	return Result{
		Domain: domain, Matched: true, App: app.App, DisplayName: app.App,
		Category: app.Category, RiskScore: app.RiskScore,
	}
}

// Registrable reduces a hostname to its registrable domain (eTLD+1).
func Registrable(domain string) string {
	d := norm(domain)
	parts := strings.Split(d, ".")
	if len(parts) < 3 {
		return d
	}
	if multiPartSuffixes[strings.Join(parts[len(parts)-2:], ".")] {
		return strings.Join(parts[len(parts)-3:], ".")
	}
	return strings.Join(parts[len(parts)-2:], ".")
}

import type { ModuleSlug } from "./content";
import type { ShotKey } from "./shots";

type Crop = { x: number; y: number; scale: number };

/** Which console screens illustrate each platform module, and what to say about them. */
export const moduleShots: Record<
  ModuleSlug,
  {
    hero: ShotKey;
    gallery: { shot: ShotKey; title: string; body: string; points: string[]; crop?: Crop }[];
    detail: { shot: ShotKey; crop: Crop; caption: string }[];
    setup: string[];
  }
> = {
  "web-gateway": {
    hero: "webGateway",
    gallery: [
      { shot: "webGateway", title: "Policies in plain language", body: "Each policy lists the categories or domains it matches, the action and who it applies to. Blocked and logged counts update live.", points: ["Block, allow or alert per policy", "Apply to everyone, a team or one person", "Enable or pause without deleting"] },
      { shot: "urlChecker", title: "Ask before it happens", body: "The URL checker tells you what would happen to any address before an employee ever visits it, and which policy decides.", points: ["Test any URL instantly", "See the matching policy", "Great for answering 'why is this blocked?'"], crop: { x: 0, y: 12, scale: 1.55 } },
      { shot: "categories", title: "27 ready-made categories", body: "Social media, AI tools, gambling, torrents, VPN and proxy, phishing and more, each with its risk level and domain count. Add your own domains to any category.", points: ["Curated domain lists", "Custom domains per category", "Hide categories you never use"] },
    ],
    detail: [
      { shot: "activity", crop: { x: 30, y: 45, scale: 1.8 }, caption: "Blocked requests with the reason and category" },
      { shot: "webGatewayDark", crop: { x: 20, y: 30, scale: 1.6 }, caption: "Policies view in dark mode" },
    ],
    setup: ["Turn on the categories you want blocked", "Add any custom domains to allow or block", "Choose who the policy applies to", "Devices pull the signed policy within moments"],
  },
  "data-loss-prevention": {
    hero: "dlp",
    gallery: [
      { shot: "dlp", title: "Every incident, in one table", body: "Who sent it, from a browser or a desktop app, to which destination, what kind of content, what was found, and the risk score.", points: ["Gmail, Outlook, Teams, WhatsApp, ChatGPT and more", "File uploads and typed text", "Searchable by destination or file"] },
      { shot: "activityDlp", title: "In context with everything else", body: "DLP findings sit in the same activity feed as web, app and download events, so an investigation starts in one place.", points: ["Filter by control", "Last 24 hours to 30 days", "Blocked, alerted and incident views"] },
      { shot: "reportsRisk", title: "Who needs a conversation", body: "The employee risk report ranks people by incidents so coaching goes where it matters.", points: ["Per-employee incident counts", "Export to PDF, Excel or CSV", "Trend versus the previous period"] },
    ],
    detail: [
      { shot: "dlp", crop: { x: 70, y: 70, scale: 1.7 }, caption: "Detectors and risk score on each finding" },
      { shot: "dlpDark", crop: { x: 25, y: 18, scale: 1.6 }, caption: "On for the whole company, with no setup" },
    ],
    setup: ["Nothing to configure: the full detector set is on by default", "Optionally tune which detectors matter most", "Findings arrive in the console within seconds", "Admins get an email for high-risk findings"],
  },
  "application-control": {
    hero: "applications",
    gallery: [
      { shot: "applications", title: "Every installed app, every device", body: "The inventory lists each application with the employee, device, category, risk level and install date, across macOS, Windows and Linux.", points: ["Search by app, vendor or path", "Filter by employee and category", "Show uninstalled apps too"] },
      { shot: "applications", title: "Two switches per app", body: "Network block cuts an app off from its servers. App block terminates it whenever it runs and tells the employee why.", points: ["Network block or app block", "Scope to one employee", "Changes apply on the next policy pull"], crop: { x: 100, y: 30, scale: 1.6 } },
      { shot: "activity", title: "Attempts are recorded", body: "When someone tries to open a blocked app, the attempt appears in the activity feed with the device.", points: ["Blocked launches logged", "Tied to the employee", "Visible in reports"] },
    ],
    detail: [
      { shot: "applications", crop: { x: 20, y: 20, scale: 1.7 }, caption: "Two ways to block, explained in the console" },
      { shot: "overview", crop: { x: 30, y: 75, scale: 1.8 }, caption: "App control incidents on the overview" },
    ],
    setup: ["Review the inventory reported by your devices", "Flip network block or app block on risky apps", "Optionally target one employee", "Watch blocked attempts in the activity feed"],
  },
  "vpn-control": {
    hero: "overview",
    gallery: [
      { shot: "overview", title: "Bypass attempts on the overview", body: "VPN and bypass attempts get their own tile on the security overview, next to every other control.", points: ["Blocked and flagged counts", "Change versus the previous period", "One click to the detail"], crop: { x: 30, y: 72, scale: 1.75 } },
      { shot: "categories", title: "VPN and proxy sites as a category", body: "Known VPN and proxy websites are a category of their own, blocked alongside desktop clients and extensions.", points: ["Curated VPN and proxy domains", "Add your own", "Risk level shown"] },
      { shot: "activity", title: "Every attempt recorded", body: "Blocked VPN apps, installers and proxy sites appear in the activity feed tied to the person and device.", points: ["Filter by application control", "Search by app or domain", "Export for HR follow-up"] },
    ],
    detail: [
      { shot: "applications", crop: { x: 40, y: 50, scale: 1.7 }, caption: "VPN clients found in the app inventory" },
      { shot: "overviewDark", crop: { x: 30, y: 72, scale: 1.8 }, caption: "Bypass tile in dark mode" },
    ],
    setup: ["Nothing: it is on from the moment a device enrolls", "Optionally allow a company-approved VPN", "Review attempts in the activity feed"],
  },
  "malware-scanning": {
    hero: "activityDownloads",
    gallery: [
      { shot: "activityDownloads", title: "Every stopped download", body: "File name, source domain, signature and risk score for each blocked download, with the employee and device.", points: ["Trojans, phishing pages and macro documents", "Risk score from 0 to 100", "Searchable by domain or reason"] },
      { shot: "overview", title: "Threats at a glance", body: "Malware and threats are counted on the overview, and the needs-attention list calls out new detections.", points: ["Blocked versus flagged", "Trend against last period", "Admin email alerts"] },
      { shot: "activity", title: "Malicious sites blocked too", body: "Threat intelligence on domains and IPs blocks phishing and malware sites before a download even starts.", points: ["Domain and IP reputation", "File-hash reputation", "Works in every browser"] },
    ],
    detail: [
      { shot: "activityDownloads", crop: { x: 60, y: 40, scale: 1.7 }, caption: "Signature names and risk scores" },
      { shot: "overviewScroll", crop: { x: 90, y: 20, scale: 1.7 }, caption: "Malware detections in needs attention" },
    ],
    setup: ["On by default for every enrolled device", "Downloads stream through the scanner as they transfer", "Malicious files never reach disk", "Admins are alerted with the reason"],
  },
  "device-posture": {
    hero: "reportsCompliance",
    gallery: [
      { shot: "reportsCompliance", title: "A compliance report auditors accept", body: "Every device with its owner, state, last check-in and any security setting that is off, ready to export.", points: ["Encryption, firewall, updates, screen lock, antivirus", "Search and sort", "PDF, Excel or CSV"] },
      { shot: "devices", title: "Posture score per device", body: "The device list shows OS, agent version, status, enforcement and a posture score out of 100.", points: ["Online and offline status", "Company or personal ownership", "Revoke a device in one click"] },
      { shot: "activityPosture", title: "Alerts when something changes", body: "When a firewall is switched off or updates fall behind, a posture alert appears with how to fix it.", points: ["Plain-language fixes", "Tied to the device owner", "Shown in needs attention"] },
    ],
    detail: [
      { shot: "overview", crop: { x: 95, y: 60, scale: 1.7 }, caption: "Laptops that need a fix, with instructions" },
      { shot: "devices", crop: { x: 60, y: 30, scale: 1.6 }, caption: "Posture score and enforcement per device" },
    ],
    setup: ["Install the agent; posture checks start immediately", "Review devices that need a fix", "Share fix instructions with the owner", "Export the compliance report"],
  },
  "activity-monitoring": {
    hero: "screenshots",
    gallery: [
      { shot: "screenshots", title: "A day at a glance", body: "Tracked and active time, average activity and a colour-coded timeline of the working day for one employee.", points: ["Active, idle and break states", "Your time zone and day boundary", "Work sessions with project and task"] },
      { shot: "screenshots", title: "Periodic screenshots", body: "Screenshots at intervals you set, each with the activity level for that interval and the apps that were open.", points: ["Random intervals within your range", "Optional blur", "Configurable retention"], crop: { x: 20, y: 100, scale: 1.5 } },
      { shot: "screenshotsDark", title: "Built for the reviewers", body: "Admins with the right permission can delete sessions or screenshots, and every view is scoped to your organisation.", points: ["Permission-based deletion", "Signed, short-lived image links", "Per-device opt-in"] },
    ],
    detail: [
      { shot: "screenshots", crop: { x: 50, y: 62, scale: 1.7 }, caption: "Colour-coded activity timeline" },
      { shot: "settings", crop: { x: 15, y: 50, scale: 1.6 }, caption: "Monitoring and working-hours settings" },
    ],
    setup: ["Choose which devices are monitored", "Set the screenshot interval, blur and retention", "Tell employees what is monitored", "Review activity per employee"],
  },
};

// Single source for everything the marketing pages say about the product.
// Claims here mirror what the platform actually ships (see repo README).

export type ModuleSlug =
  | "web-gateway"
  | "data-loss-prevention"
  | "application-control"
  | "vpn-control"
  | "malware-scanning"
  | "device-posture"
  | "activity-monitoring";

export type IconKey =
  | "globe"
  | "file"
  | "app"
  | "vpn"
  | "bug"
  | "device"
  | "monitor";

export type Module = {
  slug: ModuleSlug;
  name: string;
  icon: IconKey;
  short: string;
  headline: string;
  intro: string;
  capabilities: { title: string; body: string }[];
  flow: { verb: string; body: string }[];
  events: { label: string; detail: string; state: "blocked" | "flagged" | "allowed" }[];
};

export const modules: Module[] = [
  {
    slug: "web-gateway",
    name: "Web Gateway",
    icon: "globe",
    short: "Block and log sites by category or domain, on every device, on every network.",
    headline: "The web your company approves. Nothing else.",
    intro:
      "Every request leaves the device through the DelSecure agent, so policy follows the laptop from the office to a hotel lobby without a hardware appliance in sight.",
    capabilities: [
      { title: "Category blocking", body: "Social media, AI tools, gambling, and sensitive banking or government sites, switched on per policy." },
      { title: "Custom lists", body: "Admins add any domain to allow or block. Changes reach devices on their next policy pull." },
      { title: "Full request log", body: "Every allowed and blocked visit is recorded against the employee and device that made it." },
      { title: "Works off-network", body: "Enforcement runs on the endpoint, so home Wi-Fi and mobile hotspots are covered too." },
    ],
    flow: [
      { verb: "Intercept", body: "The agent runs a local HTTPS proxy and sees each request before it leaves the device." },
      { verb: "Decide", body: "It checks the signed policy bundle for the domain and its category." },
      { verb: "Record", body: "The decision is logged to the admin console with device and user context." },
    ],
    events: [
      { label: "bet365.com", detail: "Gambling", state: "blocked" },
      { label: "docs.google.com", detail: "Productivity", state: "allowed" },
      { label: "instagram.com", detail: "Social media", state: "blocked" },
    ],
  },
  {
    slug: "data-loss-prevention",
    name: "Data Loss Prevention",
    icon: "file",
    short: "See sensitive data leaving through uploads, messages and email, without breaking anyone's work.",
    headline: "Know exactly what left the building.",
    intro:
      "DelSecure watches outbound uploads, messages and emails across Gmail, Outlook, Teams, OneDrive, ChatGPT and any other site or app. It is monitor-only, so the business is never interrupted.",
    capabilities: [
      { title: "Pattern detection", body: "Card numbers, government IDs, API keys, credentials and source code." },
      { title: "AI classification", body: "Recognises a salary sheet, a contract or a photographed ID even when no fixed pattern exists." },
      { title: "Reads inside files", body: "Documents, archives, PDFs and images, including OCR of scanned or photographed pages." },
      { title: "Never blocks", body: "Findings are recorded, not enforced. Work keeps moving while security keeps the full picture." },
    ],
    flow: [
      { verb: "Capture", body: "Outbound uploads stream from the agent to the DLP scanning service." },
      { verb: "Inspect", body: "Files are unpacked, OCR'd and checked against patterns and an AI classifier." },
      { verb: "Report", body: "The finding, file and destination land in the admin console within seconds." },
    ],
    events: [
      { label: "Q3-salaries.xlsx", detail: "Uploaded to chatgpt.com", state: "flagged" },
      { label: "prod.env", detail: "API key in Teams message", state: "flagged" },
      { label: "brochure.pdf", detail: "No sensitive data", state: "allowed" },
    ],
  },
  {
    slug: "application-control",
    name: "Application Control",
    icon: "app",
    short: "Stop specific desktop applications from running, by name or from what is installed.",
    headline: "Decide which apps get to run.",
    intro:
      "Block a desktop application outright, either by name or by picking it from the inventory the agent reports from each device.",
    capabilities: [
      { title: "Block by name", body: "Enter an application name once and it is stopped across the fleet." },
      { title: "Pick from inventory", body: "Choose from applications actually seen installed on your devices." },
      { title: "Per-employee scope", body: "Apply a block to one employee without touching everyone else." },
      { title: "Cross-platform", body: "The same rule works on macOS, Windows and Linux." },
    ],
    flow: [
      { verb: "Inventory", body: "Each agent reports the applications installed on its device." },
      { verb: "Target", body: "Admins pick an app and the people or groups the rule applies to." },
      { verb: "Enforce", body: "The agent stops the app from launching and logs the attempt." },
    ],
    events: [
      { label: "AnyDesk", detail: "Remote access tool", state: "blocked" },
      { label: "Slack", detail: "Approved", state: "allowed" },
      { label: "uTorrent", detail: "File sharing", state: "blocked" },
    ],
  },
  {
    slug: "vpn-control",
    name: "VPN Control",
    icon: "vpn",
    short: "VPNs and anonymizers are blocked by default. No setup required.",
    headline: "No tunnels around your policy.",
    intro:
      "Personal VPNs and anonymizers are the easiest way around a web policy. DelSecure blocks desktop clients, their downloads, and known browser extensions on every device from day one.",
    capabilities: [
      { title: "On by default", body: "Protection starts the moment a device enrolls. There is nothing to configure." },
      { title: "Desktop clients", body: "Known VPN applications are stopped from running." },
      { title: "Downloads", body: "Installers for VPN software are blocked before they land." },
      { title: "Browser extensions", body: "Known proxy and VPN extensions are blocked too." },
    ],
    flow: [
      { verb: "Recognise", body: "The agent matches clients, installers and extensions against a maintained list." },
      { verb: "Block", body: "The app, download or extension is stopped on the device." },
      { verb: "Surface", body: "The attempt shows up in the console so you can follow up." },
    ],
    events: [
      { label: "NordVPN", detail: "Desktop client", state: "blocked" },
      { label: "Hola", detail: "Browser extension", state: "blocked" },
      { label: "protonvpn-setup.exe", detail: "Download", state: "blocked" },
    ],
  },
  {
    slug: "malware-scanning",
    name: "Malware Scanning",
    icon: "bug",
    short: "Downloads are scanned before they finish landing on disk.",
    headline: "Stop the file before it opens.",
    intro:
      "Downloads stream through a dedicated scanning service while they transfer, so a malicious file is caught before an employee can double-click it.",
    capabilities: [
      { title: "In-flight scanning", body: "Files are checked as they download, not after." },
      { title: "Risk scoring", body: "Each file gets a risk score so admins can see why it was stopped." },
      { title: "Threat intelligence", body: "Domain, IP and file-hash reputation feed into every decision." },
      { title: "Every browser", body: "Because scanning happens at the network layer, it covers every browser and app." },
    ],
    flow: [
      { verb: "Stream", body: "The agent forwards the download to the malware service as it arrives." },
      { verb: "Score", body: "Signatures, reputation and heuristics produce a risk score." },
      { verb: "Release", body: "Clean files land normally. Malicious ones never reach disk." },
    ],
    events: [
      { label: "invoice_0932.zip", detail: "Trojan detected", state: "blocked" },
      { label: "figma-setup.dmg", detail: "Clean", state: "allowed" },
      { label: "crack-tool.exe", detail: "High risk score", state: "blocked" },
    ],
  },
  {
    slug: "device-posture",
    name: "Device Posture",
    icon: "device",
    short: "Disk encryption, firewall, OS patch level and antivirus, checked on every device.",
    headline: "Know every device is fit to work.",
    intro:
      "The agent continuously checks the basics that auditors ask about, and shows you which devices fall short.",
    capabilities: [
      { title: "Disk encryption", body: "FileVault, BitLocker and LUKS status per device." },
      { title: "Firewall", body: "Whether the OS firewall is switched on." },
      { title: "Patch level", body: "How far each device is behind on operating system updates." },
      { title: "Antivirus", body: "Whether an antivirus product is present and running." },
    ],
    flow: [
      { verb: "Check", body: "The agent reads posture signals from the operating system." },
      { verb: "Compare", body: "Results are compared against your organisation's baseline." },
      { verb: "Highlight", body: "Non-compliant devices are listed with what needs fixing." },
    ],
    events: [
      { label: "MacBook Pro · Ananya", detail: "FileVault on", state: "allowed" },
      { label: "ThinkPad · Rohan", detail: "Firewall off", state: "flagged" },
      { label: "Ubuntu · build-02", detail: "34 days unpatched", state: "flagged" },
    ],
  },
  {
    slug: "activity-monitoring",
    name: "Activity Monitoring",
    icon: "monitor",
    short: "Periodic screenshots and application usage, for the devices you choose to monitor.",
    headline: "See how work actually happens.",
    intro:
      "For the devices an organisation chooses to monitor, DelSecure captures periodic screenshots and application usage, stored securely and visible only to admins.",
    capabilities: [
      { title: "Periodic screenshots", body: "Captured on a schedule you set, only on monitored devices." },
      { title: "App usage", body: "Which applications were in use, and for how long." },
      { title: "Opt-in by device", body: "Monitoring is enabled per device, never silently for everyone." },
      { title: "Secure storage", body: "Images are stored in object storage and served through signed links." },
    ],
    flow: [
      { verb: "Enable", body: "Admins pick which devices are monitored." },
      { verb: "Capture", body: "The agent takes screenshots and records app usage on schedule." },
      { verb: "Review", body: "Admins browse activity per employee in the console." },
    ],
    events: [
      { label: "Figma", detail: "2h 14m today", state: "allowed" },
      { label: "Screenshot", detail: "Captured 10:42", state: "allowed" },
      { label: "VS Code", detail: "3h 51m today", state: "allowed" },
    ],
  },
];

export const getModule = (slug: string) => modules.find((m) => m.slug === slug);

export const solutions = [
  {
    id: "ai",
    name: "AI governance",
    headline: "Let people use AI without pasting the company into it.",
    body: "Decide which AI tools are allowed, and see when source code, credentials or customer data are uploaded to them.",
    points: ["Block or allow AI tools by category", "Flag sensitive uploads to ChatGPT and others", "Per-team policies for engineering, sales and finance"],
    modules: ["web-gateway", "data-loss-prevention"] as ModuleSlug[],
  },
  {
    id: "remote",
    name: "Remote teams",
    headline: "The same policy at home, in the office, and on the road.",
    body: "Enforcement runs on the laptop itself, so there is no VPN concentrator or office firewall to route traffic through.",
    points: ["Works on any network", "Personal VPNs blocked by default", "Downloads scanned wherever they happen"],
    modules: ["web-gateway", "vpn-control", "malware-scanning"] as ModuleSlug[],
  },
  {
    id: "compliance",
    name: "Audit readiness",
    headline: "Answer the auditor with evidence, not a spreadsheet.",
    body: "Show encryption, firewall and patch status for every device, plus a record of where sensitive data went.",
    points: ["Posture status per device", "Data movement history", "Application inventory across the fleet"],
    modules: ["device-posture", "data-loss-prevention", "application-control"] as ModuleSlug[],
  },
  {
    id: "insider",
    name: "Insider risk",
    headline: "Notice the resignation before the download.",
    body: "Combine data movement, application use and activity monitoring to see risk building up, early.",
    points: ["Sensitive uploads tied to the person", "Unapproved tools blocked", "Activity context for investigations"],
    modules: ["data-loss-prevention", "application-control", "activity-monitoring"] as ModuleSlug[],
  },
];

export const nav = [
  { href: "/platform", label: "Platform" },
  { href: "/solutions", label: "Solutions" },
  { href: "/security", label: "Trust" },
  { href: "/pricing", label: "Pricing" },
  { href: "/company", label: "Company" },
];

// One label per intent across the whole site.
export const CTA = { demo: "Book a demo", explore: "Explore platform" };

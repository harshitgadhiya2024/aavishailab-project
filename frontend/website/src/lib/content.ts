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
      "Every request leaves the device through the Aavishield agent, so policy follows the laptop from the office to a hotel lobby without a hardware appliance in sight.",
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
      "Aavishield watches outbound uploads, messages and emails across Gmail, Outlook, Teams, OneDrive, ChatGPT and any other site or app. It is monitor-only, so the business is never interrupted.",
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
      "Personal VPNs and anonymizers are the easiest way around a web policy. Aavishield blocks desktop clients, their downloads, and known browser extensions on every device from day one.",
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
      "For the devices an organisation chooses to monitor, Aavishield captures periodic screenshots and application usage, stored securely and visible only to admins.",
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

export const nav = [
  { href: "/platform", label: "Platform", menu: "platform" },
  { href: "/solutions", label: "Solutions", menu: "solutions" },
  { href: "/product-tour", label: "Resources", menu: "resources" },
  { href: "/pricing", label: "Pricing" },
  { href: "/company", label: "Company" },
] as const;

export const resources = [
  { href: "/product-tour", label: "Product tour", body: "Walk through the real console, screen by screen." },
  { href: "/how-it-works", label: "How it works", body: "From install to first event in an afternoon." },
  { href: "/why-aavishield", label: "Why Aavishield", body: "One agent instead of four separate tools." },
  { href: "/security", label: "Trust and security", body: "How we protect the data we see." },
  { href: "/faq", label: "FAQ", body: "Straight answers to common questions." },
];

// One label per intent across the whole site.
export const CTA = { demo: "Book a demo", explore: "Explore platform" };

// Per-feature page extras: imagery, search copy, use cases and FAQs.
export type ModuleExtra = {
  image: string;
  alt: string;
  seoTitle: string;
  description: string;
  keywords: string[];
  useCases: { title: string; body: string }[];
  faqs: { q: string; a: string }[];
};

export const moduleExtras: Record<ModuleSlug, ModuleExtra> = {
  "web-gateway": {
    image: "/images/web-gateway.webp",
    alt: "Streams of light passing through a dark archway, with a few stopped by an orange barrier",
    seoTitle: "Secure Web Gateway for Every Laptop",
    description:
      "Block and log websites by category or domain on every employee device, on any network. Aavishield's endpoint web gateway needs no appliance or VPN.",
    keywords: ["secure web gateway", "web filtering", "URL filtering", "block websites for employees", "endpoint web filter"],
    useCases: [
      { title: "Keep work devices for work", body: "Block social media, gambling and adult categories on company laptops without touching personal phones." },
      { title: "Govern AI tools", body: "Allow the AI tools your company has approved and block the rest, per team." },
      { title: "Protect remote staff", body: "The same filtering applies on home Wi-Fi, hotel networks and mobile hotspots." },
    ],
    faqs: [
      { q: "Does the web gateway need a VPN or office network?", a: "No. Filtering runs in the Aavishield agent on each device, so it works on any network without routing traffic through an office." },
      { q: "Can I block a single website that is not in a category?", a: "Yes. Admins can add any domain to a custom allow or block list, and devices pick it up on their next policy pull." },
      { q: "Are allowed visits logged too?", a: "Yes. Both allowed and blocked requests are recorded against the employee and device that made them." },
    ],
  },
  "data-loss-prevention": {
    image: "/images/data-loss-prevention.webp",
    alt: "Blank documents floating in the dark, scanned by a plane of light, with one flagged in orange",
    seoTitle: "Endpoint Data Loss Prevention (DLP) with AI",
    description:
      "Detect card numbers, IDs, API keys, source code and sensitive files leaving through Gmail, Outlook, Teams, OneDrive and ChatGPT. Monitor-only DLP with OCR and AI classification.",
    keywords: ["data loss prevention", "DLP software", "endpoint DLP", "ChatGPT data leak", "sensitive data monitoring", "OCR DLP"],
    useCases: [
      { title: "Stop secrets reaching AI tools", body: "See when API keys, credentials or source code are pasted or uploaded into ChatGPT and other AI tools." },
      { title: "Protect customer data", body: "Find card numbers and government IDs leaving through email and file sharing." },
      { title: "Catch documents, not just patterns", body: "AI classification recognises salary sheets, contracts and photographed IDs even with no fixed pattern." },
    ],
    faqs: [
      { q: "Does Aavishield DLP block uploads?", a: "No. DLP is monitor-only by design. It records what sensitive data left and where it went, without interrupting anyone's work." },
      { q: "Which apps and sites does DLP cover?", a: "Gmail, Outlook, Microsoft Teams, OneDrive, ChatGPT and any other website or desktop app that sends data over the network." },
      { q: "Can it read scanned documents and images?", a: "Yes. Documents, archives, PDFs and images are unpacked, and scanned or photographed pages are read with OCR." },
    ],
  },
  "application-control": {
    image: "/images/application-control.webp",
    alt: "A grid of frosted glass tiles with one sealed by an orange lock of light",
    seoTitle: "Application Control and App Blocking for Windows, macOS and Linux",
    description:
      "Block desktop applications by name or from your device inventory, for everyone or a single employee. Cross-platform application control from one console.",
    keywords: ["application control", "block applications", "app blocking software", "application allowlisting", "software inventory"],
    useCases: [
      { title: "Remove remote-access risk", body: "Block unapproved remote desktop tools that attackers and scammers rely on." },
      { title: "Stop file-sharing clients", body: "Keep torrent and personal sync clients off company machines." },
      { title: "Target one person", body: "Apply a block to a single employee during an investigation without affecting the team." },
    ],
    faqs: [
      { q: "How do I choose which app to block?", a: "Type the application name, or pick it from the inventory of applications the agent has seen installed on your devices." },
      { q: "Does it work on every operating system?", a: "Yes. The same rule is enforced on macOS, Windows and Linux." },
      { q: "Can a block apply to just one employee?", a: "Yes. Rules can target the whole organisation, a group, or a single employee." },
    ],
  },
  "vpn-control": {
    image: "/images/vpn-control.webp",
    alt: "A long dark tunnel of light blocked near the end by a wall of orange light",
    seoTitle: "Block Personal VPNs and Anonymizers on Company Devices",
    description:
      "Aavishield blocks VPN clients, VPN installers and proxy browser extensions on every device by default, so employees cannot tunnel around your web policy.",
    keywords: ["block VPN", "VPN blocking software", "block anonymizer", "block proxy extension", "VPN control"],
    useCases: [
      { title: "Close the easiest bypass", body: "A personal VPN would sidestep web filtering. Aavishield stops it before it connects." },
      { title: "Zero setup", body: "Protection is on from the moment a device enrolls. There is nothing to configure." },
      { title: "Cover the browser too", body: "Proxy and VPN extensions are blocked alongside desktop clients." },
    ],
    faqs: [
      { q: "Is VPN blocking on by default?", a: "Yes. VPNs and anonymizers are blocked on every enrolled device without any configuration." },
      { q: "What exactly is blocked?", a: "Known VPN desktop clients, downloads of VPN installers, and known VPN and proxy browser extensions." },
      { q: "Will it block our company VPN?", a: "Talk to us during the demo about allowing a company-approved VPN for your setup." },
    ],
  },
  "malware-scanning": {
    image: "/images/malware-scanning.webp",
    alt: "A black cube split open by an orange laser plane revealing a corrupted core",
    seoTitle: "Real-Time Malware Scanning for Downloads",
    description:
      "Scan every download while it transfers and stop malicious files before they reach disk. Risk scoring with signatures, reputation and threat intelligence.",
    keywords: ["malware scanning", "download scanning", "real-time malware protection", "threat intelligence", "endpoint malware protection"],
    useCases: [
      { title: "Stop phishing attachments", body: "Malicious archives and invoices downloaded from email are caught in flight." },
      { title: "Protect every browser", body: "Scanning happens at the network layer, so every browser and app is covered." },
      { title: "Explain every block", body: "Each stopped file has a risk score so admins can see why." },
    ],
    faqs: [
      { q: "When are downloads scanned?", a: "While they download. The file streams through the scanning service and a malicious file never reaches the disk." },
      { q: "How is risk decided?", a: "Signatures, domain, IP and file-hash reputation, and heuristics combine into a risk score for each file." },
      { q: "Does it slow downloads down?", a: "Clean files land normally. Scanning happens as the file transfers, not in a separate step afterwards." },
    ],
  },
  "device-posture": {
    image: "/images/device-posture.webp",
    alt: "An open laptop on a pedestal encircled by rings of light, the inner ring orange",
    seoTitle: "Device Posture Checks: Encryption, Firewall, Patches, Antivirus",
    description:
      "Continuously check disk encryption, firewall, OS patch level and antivirus on every Mac, Windows and Linux device, and see which ones fall short.",
    keywords: ["device posture", "device compliance", "disk encryption check", "patch compliance", "endpoint compliance"],
    useCases: [
      { title: "Pass audits faster", body: "Show encryption and patch status for every device instead of collecting screenshots." },
      { title: "Find the weak laptop", body: "Spot the one device with its firewall switched off before it becomes an incident." },
      { title: "Onboard with confidence", body: "Check new devices meet your baseline as soon as they enroll." },
    ],
    faqs: [
      { q: "What does Aavishield check?", a: "Disk encryption (FileVault, BitLocker, LUKS), OS firewall, operating system patch level, and antivirus presence." },
      { q: "How often are devices checked?", a: "Continuously. The agent reports posture regularly so the console reflects the current state." },
      { q: "Does it fix problems automatically?", a: "It highlights non-compliant devices and what needs fixing, so IT can follow up." },
    ],
  },
  "activity-monitoring": {
    image: "/images/activity-monitoring.webp",
    alt: "A dark desk from above with a laptop and light trails showing time spent in apps",
    seoTitle: "Employee Activity Monitoring and Screenshots",
    description:
      "Periodic screenshots and application usage for the devices you choose to monitor, stored securely and visible only to your admins.",
    keywords: ["employee monitoring", "activity monitoring", "screenshot monitoring", "app usage tracking", "productivity monitoring"],
    useCases: [
      { title: "Support investigations", body: "Add activity context when a DLP finding or policy violation needs a closer look." },
      { title: "Understand tool usage", body: "See which applications teams actually spend their time in." },
      { title: "Monitor only where needed", body: "Enable monitoring per device instead of for everyone." },
    ],
    faqs: [
      { q: "Is every device monitored?", a: "No. Monitoring is enabled per device, only for the devices an organisation chooses." },
      { q: "Where are screenshots stored?", a: "In object storage, served only through short-lived signed links to admins of that organisation." },
      { q: "What does app usage show?", a: "Which applications were in use on a monitored device, and for how long." },
    ],
  },
};

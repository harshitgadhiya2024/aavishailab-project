// Problem-led solution pages and industry pages. Each one starts from a
// problem companies actually have, then shows the Aavishield controls and
// console screens that answer it. Claims stay within what the product ships.

import type { ModuleSlug } from "./content";
import type { ShotKey } from "./shots";

export type SolutionIconKey =
  | "robot"
  | "house"
  | "userMinus"
  | "clipboard"
  | "squares"
  | "tunnel"
  | "fish"
  | "hourglass"
  | "briefcase"
  | "code"
  | "bank"
  | "heart"
  | "headset"
  | "rocket";

export type Solution = {
  slug: string;
  name: string;
  icon: SolutionIconKey;
  menu: string; // one line for the nav dropdown
  eyebrow: string;
  headline: string;
  accent: string[];
  intro: string;
  hero: ShotKey;
  problem: { title: string; body: string; points: { title: string; body: string }[] };
  why: { title: string; body: string }[]; // why it's happening now
  cost: { title: string; body: string }[]; // what it costs when ignored
  steps: { verb: string; title: string; body: string; shot: ShotKey }[];
  modules: ModuleSlug[];
  outcomes: { title: string; body: string }[];
  before: string[];
  after: string[];
  faqs: { q: string; a: string }[];
  seoTitle: string;
  description: string;
  keywords: string[];
};

export const solutionsList: Solution[] = [
  {
    slug: "ai-data-leakage",
    name: "AI data leakage",
    icon: "robot",
    menu: "Staff pasting code, customer data and contracts into ChatGPT",
    eyebrow: "Problem 01 · Generative AI",
    headline: "Your team uses ChatGPT every day. Do you know what they paste into it?",
    accent: ["paste"],
    intro:
      "Generative AI arrived faster than any policy. Engineers paste stack traces with secrets, finance uploads salary sheets for a quick summary, sales drops a customer export in for a cleaner list. Aavishield shows you exactly what reaches AI tools, and lets you decide which tools are allowed at all.",
    hero: "dlp",
    problem: {
      title: "The fastest-growing data leak has a friendly chat window.",
      body: "AI assistants are useful, so people use them on personal accounts, in the browser, with no logging on your side. Once a file is uploaded, you cannot pull it back, and you usually never find out it happened.",
      points: [
        { title: "Secrets in prompts", body: "API keys, database URLs and tokens copied along with an error message." },
        { title: "Whole files uploaded", body: "Spreadsheets, contracts and exports dropped in for a summary or a cleanup." },
        { title: "Shadow AI tools", body: "New AI sites appear every week, far faster than anyone can review them." },
        { title: "No audit trail", body: "When a customer asks whether their data went into an AI tool, nobody can answer." },
      ],
    },
    why: [
      { title: "Everyone has an AI tab open", body: "AI assistants went from novelty to daily habit across every department, not just engineering." },
      { title: "Personal accounts, company data", body: "Most people sign in with their own account, so the company has no admin view of what was shared." },
      { title: "Blocking outright backfires", body: "Ban every AI tool and people switch to their phones. Visibility plus a short approved list works better." },
    ],
    cost: [
      { title: "Lost IP", body: "Source code and product plans leave the company with no way to recall them." },
      { title: "Customer trust", body: "Customer records shared with a third-party AI can breach contracts and data protection law." },
      { title: "Regulatory exposure", body: "Personal data processed without a lawful basis is a reportable problem under laws such as India's DPDP Act and GDPR." },
    ],
    steps: [
      { verb: "Decide", title: "Allow the AI tools you trust, block the rest", body: "Turn on the AI Tools category in the web gateway and allow the assistant your company has approved. New AI sites are covered as the category list grows.", shot: "webGateway" },
      { verb: "See", title: "Every sensitive upload, with the file and the person", body: "DLP inspects outbound uploads and messages to ChatGPT, Claude, Gemini and any other site. It reads inside documents, archives and images with OCR, and flags secrets, IDs, salary data and source code.", shot: "dlp" },
      { verb: "Act", title: "Follow up with evidence, not guesses", body: "Each finding shows who, which device, which tool, what was detected and a risk score. Repeat behaviour rises to the top of the employee risk report.", shot: "reportsRisk" },
    ],
    modules: ["data-loss-prevention", "web-gateway", "activity-monitoring"],
    outcomes: [
      { title: "A real answer", body: "When someone asks whether customer data went into AI, you can answer with records." },
      { title: "Approved AI, not banned AI", body: "People keep the productivity gains of the tool you chose." },
      { title: "Secrets caught early", body: "Leaked keys are found the same day, so they can be rotated before anyone abuses them." },
      { title: "No slowdown", body: "DLP is monitor-only, so nobody's work is interrupted while you gain visibility." },
    ],
    before: ["No idea which AI tools are in use", "Files uploaded on personal accounts with no trace", "A blanket ban that people quietly work around", "Leaked API keys found months later"],
    after: ["One approved AI assistant, the rest blocked by category", "Every sensitive upload recorded with file and destination", "Secrets flagged within seconds of leaving the device", "A per-employee view of who needs coaching"],
    faqs: [
      { q: "Does Aavishield stop the upload to ChatGPT?", a: "DLP is monitor-only, so the upload goes through and is recorded. To stop an AI tool entirely, block it in the web gateway with the AI Tools category or a custom domain." },
      { q: "Which AI tools are covered?", a: "DLP inspects traffic to any website or desktop app, including ChatGPT, Claude, Gemini, Perplexity and Copilot. The AI Tools category in the web gateway lists known AI sites so they can be blocked or allowed together." },
      { q: "Can it detect a salary sheet with no fixed pattern?", a: "Yes. Alongside pattern detectors, an AI classifier recognises documents such as salary sheets, contracts and identity documents, including photographed pages read with OCR." },
      { q: "Can we allow one AI tool and block the others?", a: "Yes. Block the AI Tools category and add the approved assistant's domain to the allow list." },
    ],
    seoTitle: "Stop ChatGPT and AI Data Leakage at Work",
    description: "See when staff paste source code, credentials or customer data into ChatGPT, Claude or Gemini. Block unapproved AI tools and keep an audit trail.",
    keywords: ["ChatGPT data leak", "AI data leakage prevention", "block ChatGPT at work", "generative AI governance", "shadow AI", "AI DLP"],
  },
  {
    slug: "remote-workforce-security",
    name: "Remote and hybrid work",
    icon: "house",
    menu: "Laptops on home Wi-Fi, outside every office firewall",
    eyebrow: "Problem 02 · Remote work",
    headline: "Your firewall stayed in the office. Your people did not.",
    accent: ["did", "not."],
    intro:
      "Hybrid work moved company laptops onto home routers, café Wi-Fi and hotel networks. The perimeter you paid for only protects the days people come in. Aavishield puts the policy on the laptop itself, so it is enforced on every network, every day.",
    hero: "devices",
    problem: {
      title: "Most company traffic no longer passes anything you control.",
      body: "An office firewall or DNS filter sees nothing once a laptop leaves the building. Routing everything back through a VPN concentrator is slow, expensive and the first thing people disconnect.",
      points: [
        { title: "No filtering at home", body: "Web policy disappears the moment someone works from the couch." },
        { title: "Slow backhaul", body: "Forcing traffic through the office VPN makes every call and download worse." },
        { title: "Unknown device state", body: "You cannot tell if a remote laptop has its firewall on or is months behind on updates." },
        { title: "Downloads unchecked", body: "Files arrive on home networks with no gateway scanning them." },
      ],
    },
    why: [
      { title: "Hybrid is permanent", body: "Most teams now split time between home, office and travel, so the office network covers a fraction of the week." },
      { title: "SaaS replaced the server room", body: "Work happens in browser tabs talking straight to the internet, not through a data centre you own." },
      { title: "Appliances do not scale down", body: "Small and mid-sized companies cannot justify cloud proxy contracts built for ten thousand seats." },
    ],
    cost: [
      { title: "Unequal protection", body: "The same employee is protected on Tuesday in the office and exposed on Wednesday at home." },
      { title: "Incident blind spots", body: "When something goes wrong off-network, there are no logs to investigate." },
      { title: "Friction and workarounds", body: "Slow VPNs push people to turn protection off just to get work done." },
    ],
    steps: [
      { verb: "Install", title: "One agent on every laptop", body: "Employees install from their portal in a minute. The agent runs on macOS, Windows and Linux and enrolls the device to your organisation.", shot: "portalDownload" },
      { verb: "Enforce", title: "Policy runs on the device, on any network", body: "Web filtering, VPN blocking and download scanning happen locally, so home Wi-Fi and hotspots get exactly the same rules as the office.", shot: "webGateway" },
      { verb: "Verify", title: "See which devices are online and healthy", body: "The device list shows status, agent version, enforcement and posture for every laptop, wherever it is.", shot: "devices" },
    ],
    modules: ["web-gateway", "vpn-control", "malware-scanning", "device-posture"],
    outcomes: [
      { title: "Same rules everywhere", body: "Policy no longer depends on which network someone is connected to." },
      { title: "No backhaul", body: "Traffic goes straight to the internet, with enforcement on the device." },
      { title: "Fleet health at a glance", body: "Posture issues on remote laptops show up before they become incidents." },
      { title: "Evidence off-network", body: "Every block and alert is logged, even from a hotel lobby." },
    ],
    before: ["Filtering only inside the office", "VPN backhaul that slows everything down", "No idea if remote laptops are patched", "No logs from home networks"],
    after: ["Enforcement on the laptop, on every network", "Direct internet access with policy intact", "Posture score for every device", "One activity log for office and remote"],
    faqs: [
      { q: "Do employees need to connect to a VPN?", a: "No. Aavishield enforces policy on the device itself, so there is nothing to connect to." },
      { q: "What happens when a laptop is offline?", a: "The agent keeps enforcing the last signed policy it received and reports events once it reconnects." },
      { q: "Does it work on personal Wi-Fi and mobile hotspots?", a: "Yes. Because enforcement is on the endpoint, the network does not matter." },
      { q: "How do remote employees install it?", a: "They sign in to the employee portal and download a native installer for their operating system. No IT visit is needed." },
    ],
    seoTitle: "Remote Workforce Security Without a VPN",
    description: "Enforce web filtering, VPN blocking, malware scanning and device posture on every remote laptop, on any network, with one lightweight Aavishield agent.",
    keywords: ["remote workforce security", "hybrid work security", "secure remote employees", "endpoint web filtering", "work from home security"],
  },
  {
    slug: "insider-threat",
    name: "Insider risk and data theft",
    icon: "userMinus",
    menu: "Departing employees walking out with customer lists and code",
    eyebrow: "Problem 03 · Insider risk",
    headline: "Notice the resignation before the download.",
    accent: ["resignation"],
    intro:
      "Most data that leaves a company leaves with someone who had legitimate access: a salesperson exporting the CRM before a move, an engineer zipping a repository, a contractor syncing a folder to personal storage. Aavishield connects data movement, unapproved tools and activity context so you see risk building, early.",
    hero: "reportsRisk",
    problem: {
      title: "The riskiest user already has the password.",
      body: "Perimeter tools are built to stop outsiders. Insiders log in normally, open files they are allowed to open, and send them through tools everyone uses, so nothing looks unusual until it is too late.",
      points: [
        { title: "Exports before exit", body: "Customer lists and pricing sheets uploaded to personal email or storage in the last weeks of notice." },
        { title: "Code walking out", body: "Repositories zipped and sent through file-transfer sites." },
        { title: "Remote-access tools", body: "AnyDesk or TeamViewer installed to reach a company laptop from outside." },
        { title: "No context", body: "When HR raises a concern, IT has nothing concrete to look at." },
      ],
    },
    why: [
      { title: "High job mobility", body: "People change jobs more often, and many see their work files as their own." },
      { title: "Consumer tools everywhere", body: "Personal Gmail, WhatsApp Web and WeTransfer are one tab away on every laptop." },
      { title: "Contractors and freelancers", body: "More people outside the payroll get access to sensitive systems." },
    ],
    cost: [
      { title: "Competitive damage", body: "Customer lists and pricing in a competitor's hands are hard to recover from." },
      { title: "Legal cost", body: "Proving what was taken, and when, is expensive without records." },
      { title: "Client contracts", body: "Many client agreements require you to show how their data is protected from staff misuse." },
    ],
    steps: [
      { verb: "Record", title: "Sensitive uploads tied to a person", body: "DLP records every sensitive file or message leaving a device, with the employee, device, destination and what was detected.", shot: "dlp" },
      { verb: "Restrict", title: "Remove the easy exits", body: "Block remote-access tools, torrent clients and personal file-transfer sites for everyone, or just for one person under review.", shot: "applications" },
      { verb: "Investigate", title: "Add activity context when it matters", body: "For devices you choose to monitor, periodic screenshots and app usage show what happened around a finding.", shot: "screenshots" },
    ],
    modules: ["data-loss-prevention", "application-control", "activity-monitoring", "web-gateway"],
    outcomes: [
      { title: "Early warning", body: "Unusual data movement shows up while someone is still employed, not after." },
      { title: "Evidence for HR and legal", body: "A dated record of files, destinations and devices." },
      { title: "Fewer exits", body: "The tools most often used to move data out are simply not available." },
      { title: "Fair and targeted", body: "Monitoring can be scoped to specific devices instead of watching everyone." },
    ],
    before: ["Data theft discovered after the person left", "Personal storage and remote tools freely available", "HR concerns with nothing to check", "Arguments about what was taken"],
    after: ["Sensitive uploads flagged the same day", "Remote-access and transfer tools blocked", "Activity context for scoped investigations", "Dated evidence of every finding"],
    faqs: [
      { q: "Is every employee monitored with screenshots?", a: "No. Activity monitoring is enabled per device, only where your organisation decides it is needed." },
      { q: "Can I restrict tools for one employee only?", a: "Yes. Application control rules can apply to the whole company, a team or a single employee." },
      { q: "Will people notice DLP?", a: "DLP is monitor-only, so it never blocks or interrupts. Findings appear in the admin console." },
      { q: "How should we use this fairly?", a: "Tell employees what is monitored, keep monitoring proportionate, and follow your local employment and privacy law. Our acceptable use policy sets out the basics." },
    ],
    seoTitle: "Insider Threat and Data Theft Prevention",
    description: "Detect sensitive data leaving with departing employees and contractors. Combine DLP, application control and activity monitoring in one Aavishield agent.",
    keywords: ["insider threat detection", "employee data theft", "insider risk management", "departing employee data", "data exfiltration"],
  },
  {
    slug: "compliance-audit-readiness",
    name: "Compliance and audits",
    icon: "clipboard",
    menu: "ISO 27001, SOC 2 and DPDP evidence without screenshots",
    eyebrow: "Problem 04 · Compliance",
    headline: "Answer the auditor with evidence, not a spreadsheet.",
    accent: ["evidence,"],
    intro:
      "Audits and security questionnaires ask the same things every time. Are laptops encrypted? Is the firewall on? Are patches current? Where does sensitive data go? Most teams answer with screenshots collected by hand. Aavishield keeps that evidence current and exportable.",
    hero: "reportsCompliance",
    problem: {
      title: "Evidence collection eats the week before every audit.",
      body: "Endpoint controls are among the most-asked audit questions and the hardest to prove, because the evidence lives on dozens of laptops nobody can see at once.",
      points: [
        { title: "Manual screenshots", body: "Chasing employees for proof of FileVault or BitLocker." },
        { title: "Point-in-time only", body: "Evidence is stale the day after it is collected." },
        { title: "Questionnaires pile up", body: "Every enterprise customer sends another security review." },
        { title: "Data flow unknown", body: "Nobody can say where personal data actually went." },
      ],
    },
    why: [
      { title: "Customers demand proof", body: "Enterprise buyers now send security questionnaires before signing, even to small vendors." },
      { title: "Privacy law is real", body: "India's Digital Personal Data Protection Act and laws like GDPR expect reasonable security safeguards you can demonstrate." },
      { title: "Frameworks expect endpoint control", body: "ISO 27001 and SOC 2 both include controls on device security, malware protection and data leakage." },
    ],
    cost: [
      { title: "Lost deals", body: "Slow or weak questionnaire answers stall enterprise sales." },
      { title: "Audit findings", body: "Unencrypted or unpatched devices become formal non-conformities." },
      { title: "Team time", body: "Engineers and IT lose days gathering evidence by hand." },
    ],
    steps: [
      { verb: "Check", title: "Posture on every device, continuously", body: "Disk encryption, firewall, OS updates and antivirus are checked by the agent and summarised per device.", shot: "reportsCompliance" },
      { verb: "Record", title: "A log of where sensitive data went", body: "DLP findings and blocked events form a dated record of data movement and enforcement.", shot: "activity" },
      { verb: "Export", title: "Reports ready for auditors", body: "Executive summary, device compliance, incidents and policy effectiveness reports export to PDF, Excel or CSV.", shot: "reports" },
    ],
    modules: ["device-posture", "data-loss-prevention", "application-control", "web-gateway"],
    outcomes: [
      { title: "Always-current evidence", body: "Posture and enforcement records are there whenever the auditor asks." },
      { title: "Faster questionnaires", body: "Answer endpoint questions with a report instead of a project." },
      { title: "Fewer findings", body: "Non-compliant devices are fixed before the audit, not during it." },
      { title: "Clear data story", body: "Show customers how sensitive data is monitored." },
    ],
    before: ["Screenshots collected by hand", "Evidence out of date immediately", "No view of where personal data goes", "Days lost before every audit"],
    after: ["Continuous posture per device", "Exportable compliance reports", "A record of sensitive data movement", "Questionnaires answered in minutes"],
    faqs: [
      { q: "Is Aavishield certified for ISO 27001 or SOC 2?", a: "Aavishield helps you produce evidence for the endpoint controls these frameworks ask about. Certification of your organisation is done by your auditor." },
      { q: "Which posture checks are included?", a: "Disk encryption (FileVault, BitLocker, LUKS), OS firewall, operating system update status, screen lock and antivirus presence." },
      { q: "Which formats can reports be exported in?", a: "PDF, Excel and CSV." },
      { q: "Does it help with India's DPDP Act?", a: "It helps demonstrate reasonable security safeguards on endpoints and shows where personal data is sent. Legal compliance overall depends on your wider processes." },
    ],
    seoTitle: "ISO 27001, SOC 2 and DPDP Endpoint Evidence",
    description: "Continuous device posture, data movement records and exportable reports that answer audit and security questionnaire questions about your laptops.",
    keywords: ["ISO 27001 endpoint evidence", "SOC 2 device compliance", "DPDP Act compliance", "audit readiness", "device compliance report"],
  },
  {
    slug: "shadow-it",
    name: "Shadow IT and risky apps",
    icon: "squares",
    menu: "Unapproved remote-access, torrent and file-sharing apps",
    eyebrow: "Problem 05 · Shadow IT",
    headline: "Find the apps nobody approved, then switch them off.",
    accent: ["switch", "off."],
    intro:
      "Every laptop slowly collects software: a remote desktop tool for a quick fix, a torrent client, a personal sync app, a free PDF converter. Each is a way in or a way out. Aavishield inventories what is installed across the fleet and blocks what should not run.",
    hero: "applications",
    problem: {
      title: "You cannot secure software you do not know exists.",
      body: "Without an inventory, unapproved apps sit on laptops for years. Remote-access tools in particular are a favourite of scammers and attackers because they look legitimate.",
      points: [
        { title: "Remote-access tools", body: "AnyDesk and TeamViewer installed outside IT's control." },
        { title: "P2P and torrent clients", body: "File-sharing apps bringing malware and licensing risk." },
        { title: "Personal sync", body: "Consumer cloud apps syncing company folders off the network." },
        { title: "No inventory", body: "No single list of what runs on which device." },
      ],
    },
    why: [
      { title: "Self-service culture", body: "People install what they need without waiting for IT, especially in fast-growing teams." },
      { title: "Support scams", body: "Fake support callers ask victims to install remote-access software." },
      { title: "Mixed operating systems", body: "Macs, Windows and Linux laptops make manual tracking impossible." },
    ],
    cost: [
      { title: "Unauthorised access", body: "A forgotten remote-access tool is an open door." },
      { title: "Malware", body: "Cracked and P2P software is a common malware source." },
      { title: "Licence exposure", body: "Unlicensed software creates legal and audit risk." },
    ],
    steps: [
      { verb: "Inventory", title: "See every installed application", body: "Each agent reports installed applications, so you get one list across macOS, Windows and Linux, with risk levels.", shot: "applications" },
      { verb: "Block", title: "Stop an app by name or from the inventory", body: "Turn on app block or network block per application, for everyone or a single employee.", shot: "applications" },
      { verb: "Track", title: "See attempts to launch blocked apps", body: "Every blocked launch appears in the activity feed with the employee and device.", shot: "activity" },
    ],
    modules: ["application-control", "vpn-control", "malware-scanning"],
    outcomes: [
      { title: "A real software inventory", body: "Know what runs on every device without asking." },
      { title: "Fewer doors", body: "Remote-access and P2P tools are stopped fleet-wide." },
      { title: "Cross-platform rules", body: "One rule covers Mac, Windows and Linux." },
      { title: "Targeted enforcement", body: "Scope a block to one person during an investigation." },
    ],
    before: ["No list of installed software", "Remote-access tools installed freely", "Torrent clients on work laptops", "Different tools per operating system"],
    after: ["Fleet-wide application inventory", "Risky apps blocked by name", "Blocked launch attempts logged", "One rule for every OS"],
    faqs: [
      { q: "What is the difference between app block and network block?", a: "Network block cuts the app off from its servers so an installed copy stops being useful. App block terminates the app whenever it runs and shows the employee a notice." },
      { q: "Do I need to know the exact process name?", a: "No. Pick the application from the inventory or from the built-in catalogue of managed applications." },
      { q: "Does it work on Linux?", a: "Yes. The same rules apply on macOS, Windows and Linux." },
      { q: "Can I block browser extensions?", a: "Known VPN and proxy extensions are blocked by VPN control, and extension activity is reported to the console." },
    ],
    seoTitle: "Shadow IT Discovery and Application Blocking",
    description: "Inventory every installed app on macOS, Windows and Linux, and block remote-access, torrent and file-sharing tools with Aavishield application control.",
    keywords: ["shadow IT", "block AnyDesk", "application blocking", "software inventory", "unauthorized software"],
  },
  {
    slug: "vpn-and-proxy-bypass",
    name: "VPN and proxy bypass",
    icon: "tunnel",
    menu: "Personal VPNs and proxy extensions that skip your policy",
    eyebrow: "Problem 06 · Bypass",
    headline: "No tunnels around your policy.",
    accent: ["tunnels"],
    intro:
      "A free VPN, a proxy website or a browser extension is the quickest way around any web filter, and they are advertised everywhere. Aavishield blocks VPN clients, their installers, proxy sites and known extensions on every device from the moment it enrolls.",
    hero: "overview",
    problem: {
      title: "One free VPN undoes every policy you set.",
      body: "Personal VPNs hide traffic from web filters and route it through servers you know nothing about. Many free ones log or sell traffic, so they are a data risk in their own right.",
      points: [
        { title: "Desktop VPN clients", body: "NordVPN, Proton VPN and dozens more installed in a minute." },
        { title: "Browser extensions", body: "Proxy extensions that need no admin rights." },
        { title: "Proxy websites", body: "Web proxies that load blocked sites inside another page." },
        { title: "Unknown routing", body: "Company traffic passing through servers in unknown countries." },
      ],
    },
    why: [
      { title: "Heavy advertising", body: "Consumer VPNs are promoted constantly, so people see them as normal." },
      { title: "Free tiers", body: "Free VPNs and extensions remove any barrier to trying one." },
      { title: "Policy fatigue", body: "Any block, however reasonable, makes some people look for a way around it." },
    ],
    cost: [
      { title: "Policy is meaningless", body: "Web filtering and data monitoring stop seeing traffic." },
      { title: "Data exposure", body: "Untrusted VPN providers may log or inspect company traffic." },
      { title: "Investigation gaps", body: "Events stop being recorded while the tunnel is up." },
    ],
    steps: [
      { verb: "Default on", title: "Protection from the first minute", body: "VPN and proxy blocking is on for every enrolled device with no configuration at all.", shot: "overview" },
      { verb: "Block", title: "Clients, installers, sites and extensions", body: "Known VPN apps are stopped, their downloads blocked, VPN and proxy sites filtered and extensions flagged.", shot: "categories" },
      { verb: "Surface", title: "See who tried", body: "Bypass attempts appear in the console so you can talk to the person, not guess.", shot: "activity" },
    ],
    modules: ["vpn-control", "web-gateway", "application-control"],
    outcomes: [
      { title: "Policy that holds", body: "Web and data controls keep seeing traffic." },
      { title: "Zero setup", body: "Nothing to configure for baseline protection." },
      { title: "Known VPNs covered", body: "A maintained list of clients and extensions." },
      { title: "Clear follow-up", body: "Attempts are tied to a person and device." },
    ],
    before: ["Free VPNs installed in minutes", "Proxy extensions with no admin rights needed", "Filtering silently bypassed", "No record of bypass attempts"],
    after: ["VPN clients and installers blocked", "Proxy sites and extensions blocked", "Policy enforced continuously", "Every attempt logged"],
    faqs: [
      { q: "Do I need to set anything up?", a: "No. VPN control is on by default for every enrolled device." },
      { q: "Will it block our company VPN?", a: "Talk to us during the demo. A company-approved VPN can be accommodated for your setup." },
      { q: "Which VPNs are recognised?", a: "A maintained catalogue including NordVPN, ExpressVPN, Proton VPN, Surfshark, Windscribe, Hola, TunnelBear and many more, plus known proxy extensions." },
      { q: "What does the employee see?", a: "The VPN app does not run, or the download or site is blocked. The attempt is logged for admins." },
    ],
    seoTitle: "Block Personal VPNs, Proxies and Anonymizers",
    description: "Stop employees bypassing web policy with personal VPNs, proxy sites and browser extensions. On by default on every device with Aavishield VPN control.",
    keywords: ["block VPN on work laptop", "VPN bypass prevention", "block proxy sites", "block VPN extension", "anonymizer blocking"],
  },
  {
    slug: "phishing-and-malware",
    name: "Phishing and malware",
    icon: "fish",
    menu: "Fake invoices, cracked software and ransomware downloads",
    eyebrow: "Problem 07 · Threats",
    headline: "Stop the file before anyone double-clicks it.",
    accent: ["double-clicks"],
    intro:
      "Most attacks on small and mid-sized companies still start the same way: a convincing invoice, a fake login page, a cracked installer. Aavishield blocks known phishing and malware sites and scans downloads in flight, so the dangerous file never reaches the disk.",
    hero: "activityDownloads",
    problem: {
      title: "Attackers only need one click.",
      body: "Email filters miss things, people are busy, and a malicious attachment looks exactly like a real one. Once the file runs, recovery is slow and expensive.",
      points: [
        { title: "Invoice and payment lures", body: "Zipped invoices and HTML attachments that steal credentials." },
        { title: "Fake login pages", body: "Look-alike Microsoft and Google sign-in pages." },
        { title: "Cracked software", body: "Free versions of paid tools bundled with malware." },
        { title: "Macro documents", body: "Spreadsheets that download the real payload." },
      ],
    },
    why: [
      { title: "AI-written lures", body: "Phishing emails are now well written and personalised." },
      { title: "SMBs are targets", body: "Smaller companies are attacked because their defences are thinner." },
      { title: "Every browser, every app", body: "Files arrive through chat apps and cloud links, not just email." },
    ],
    cost: [
      { title: "Ransomware downtime", body: "Encrypted laptops and servers stop work for days." },
      { title: "Account takeover", body: "Stolen credentials lead to fraud and data theft." },
      { title: "Recovery cost", body: "Clean-up, notification and lost business add up fast." },
    ],
    steps: [
      { verb: "Filter", title: "Phishing and malware sites blocked", body: "Threat intelligence on domains and IPs blocks known malicious sites in every browser.", shot: "activity" },
      { verb: "Scan", title: "Downloads checked while they transfer", body: "Files stream through the scanning service with signatures, reputation and heuristics producing a risk score.", shot: "activityDownloads" },
      { verb: "Explain", title: "Every block has a reason", body: "Admins see the file, source, signature and score, and are alerted when something is stopped.", shot: "overview" },
    ],
    modules: ["malware-scanning", "web-gateway", "application-control"],
    outcomes: [
      { title: "Fewer infections", body: "Malicious files are stopped before they can run." },
      { title: "Every browser covered", body: "Chrome, Safari, Edge, Firefox and desktop apps alike." },
      { title: "Clear reasons", body: "Risk scores explain each decision." },
      { title: "Fast alerts", body: "Admins are told the moment a threat is blocked." },
    ],
    before: ["Attachments opened and run", "Look-alike login pages reachable", "Cracked installers on laptops", "Infections discovered late"],
    after: ["Downloads scanned in flight", "Known phishing sites blocked", "Risk score on every stopped file", "Admins alerted immediately"],
    faqs: [
      { q: "When is a download scanned?", a: "While it downloads. A malicious file never finishes landing on disk." },
      { q: "Does it replace antivirus?", a: "It adds network-layer download scanning and malicious site blocking. Device posture also checks that an antivirus product is present and running." },
      { q: "Does scanning slow downloads?", a: "Clean files land normally. Scanning happens during the transfer, not as a separate step afterwards." },
      { q: "Where does threat intelligence come from?", a: "Domain, IP and file-hash reputation feed every decision, alongside signature scanning and heuristics." },
    ],
    seoTitle: "Phishing and Download Malware Protection",
    description: "Block phishing and malware sites and scan every download in flight. Aavishield stops malicious files before they reach the disk on every browser.",
    keywords: ["phishing protection", "malware download protection", "ransomware prevention SMB", "block phishing sites", "download scanning"],
  },
  {
    slug: "productivity-and-distraction",
    name: "Productivity and focus",
    icon: "hourglass",
    menu: "Hours lost to social media, streaming and gaming at work",
    eyebrow: "Problem 08 · Productivity",
    headline: "Keep work laptops for work, without micromanaging.",
    accent: ["work,"],
    intro:
      "Social feeds, streaming and gaming sites quietly eat working hours, and the same sites carry scams and malvertising. Aavishield lets you block distracting categories on company devices, understand how tools are used, and let people request exceptions when they genuinely need a site.",
    hero: "categories",
    problem: {
      title: "Distraction is a security problem too.",
      body: "The sites that waste the most time are also where scams, fake giveaways and malicious ads live. A sensible web policy protects both focus and the network.",
      points: [
        { title: "Endless feeds", body: "Social media and short video on work laptops." },
        { title: "Gambling and betting", body: "Betting apps with real financial and legal risk." },
        { title: "Streaming and gaming", body: "Bandwidth-heavy sites during working hours." },
        { title: "Blanket bans", body: "Rigid rules that block what some roles genuinely need." },
      ],
    },
    why: [
      { title: "Work and life share a screen", body: "The same laptop is used for everything, all day." },
      { title: "Remote teams", body: "Managers have less visibility into how time is spent." },
      { title: "Role differences", body: "Marketing needs social media; finance does not." },
    ],
    cost: [
      { title: "Lost hours", body: "Small distractions add up across a team." },
      { title: "Scam exposure", body: "Gambling and giveaway sites are common scam sources." },
      { title: "Resentment", body: "Heavy-handed bans hurt trust if there is no way to ask." },
    ],
    steps: [
      { verb: "Choose", title: "Block categories per company or team", body: "Social media, gambling, streaming, gaming, adult and dating categories are one switch each.", shot: "categories" },
      { verb: "Allow exceptions", title: "Let people ask for a site", body: "Employees can request access to a blocked domain with a reason, and admins approve or decline.", shot: "accessRequests" },
      { verb: "Understand", title: "See how time is spent, where you choose to", body: "Activity monitoring shows tracked and active time and app usage for monitored devices.", shot: "screenshots" },
    ],
    modules: ["web-gateway", "activity-monitoring"],
    outcomes: [
      { title: "Focused devices", body: "Company laptops stay for company work." },
      { title: "Fair exceptions", body: "A clear path to request access when needed." },
      { title: "Per-team policy", body: "Different rules for marketing, engineering and finance." },
      { title: "Fewer scams", body: "High-risk categories stay blocked." },
    ],
    before: ["Feeds and betting sites on work laptops", "One rule for everyone", "No way to ask for an exception", "No view of time spent"],
    after: ["Categories blocked per team", "Access requests with reasons", "Approve or decline in one click", "Activity insight where enabled"],
    faqs: [
      { q: "Can marketing use social media while others cannot?", a: "Yes. Policies can apply to the whole company, specific teams or individual employees." },
      { q: "How do access requests work?", a: "When a site is blocked, the employee can ask for access with a reason. Admins review requests in the console." },
      { q: "Is activity monitoring required?", a: "No. It is optional and enabled per device." },
      { q: "Does it block personal phones?", a: "No. Aavishield runs on enrolled company devices only." },
    ],
    seoTitle: "Block Distracting Websites on Work Laptops",
    description: "Block social media, gambling, streaming and gaming on company devices per team, with access requests and optional activity insight from Aavishield.",
    keywords: ["block social media at work", "employee productivity software", "website blocker for business", "block gambling sites", "content filtering for employees"],
  },
  {
    slug: "contractors-and-byod",
    name: "Contractors and new joiners",
    icon: "briefcase",
    menu: "Onboarding freelancers and new hires onto a safe baseline",
    eyebrow: "Problem 09 · Onboarding",
    headline: "Every new laptop protected before its first login.",
    accent: ["first", "login."],
    intro:
      "New joiners, interns and contractors get access to real systems on day one, often on laptops IT never touched. Aavishield turns onboarding into a link: the person installs the agent, the device enrolls, and your full policy applies immediately, with posture checked from the first minute.",
    hero: "portalDownload",
    problem: {
      title: "Day one is when devices are least protected.",
      body: "Setting up laptops by hand is slow, so people start working before policy is in place. Contractors' machines may never be configured at all.",
      points: [
        { title: "Manual setup", body: "IT configures each laptop by hand, and some get missed." },
        { title: "Unknown baseline", body: "No proof a new device is encrypted or patched." },
        { title: "Contractor machines", body: "Freelancers on hardware IT has never seen." },
        { title: "Offboarding gaps", body: "Devices of leavers stay enrolled or unaccounted for." },
      ],
    },
    why: [
      { title: "Fast hiring", body: "Growing teams onboard people every week." },
      { title: "Flexible workforce", body: "More contractors, agencies and part-timers." },
      { title: "Shipping laptops", body: "Devices go straight from the vendor to the employee's home." },
    ],
    cost: [
      { title: "Unprotected first weeks", body: "The riskiest period gets the least protection." },
      { title: "Inconsistent policy", body: "Different devices end up with different rules." },
      { title: "IT bottleneck", body: "Manual setup slows every hire." },
    ],
    steps: [
      { verb: "Invite", title: "Add the person once", body: "Import employees from CSV or add them one by one, and assign them to a team.", shot: "employees" },
      { verb: "Self-enroll", title: "They install from the portal", body: "Native installers for macOS, Windows and Linux enroll the device to your organisation in minutes.", shot: "portalDownload" },
      { verb: "Verify", title: "Posture and policy from minute one", body: "The device appears with its posture score and enforcement status as soon as it reports in.", shot: "devices" },
    ],
    modules: ["device-posture", "web-gateway", "data-loss-prevention", "vpn-control"],
    outcomes: [
      { title: "Protected on day one", body: "Policy applies the moment a device enrolls." },
      { title: "No IT visit", body: "Employees enroll themselves from a link." },
      { title: "Consistent baseline", body: "Every device gets the same checks." },
      { title: "Clean offboarding", body: "Uninstall requires admin approval and is logged." },
    ],
    before: ["Laptops configured by hand", "New joiners working unprotected", "Contractor devices unknown", "Leavers' devices forgotten"],
    after: ["Self-enrollment from a link", "Policy on the first login", "Posture checked immediately", "Approved, logged uninstalls"],
    faqs: [
      { q: "How long does enrollment take?", a: "A few minutes: sign in to the employee portal, download the installer, run it." },
      { q: "Can contractors use their own laptops?", a: "Yes, if your policy allows it. Devices can be marked as company or personally owned." },
      { q: "Can an employee uninstall the agent?", a: "Uninstalling needs admin approval, and the event is recorded in the console." },
      { q: "Can I import employees in bulk?", a: "Yes. Import from CSV or add them individually." },
    ],
    seoTitle: "Secure Onboarding for New Hires and Contractors",
    description: "Self-enrollment links, native installers and instant posture checks put every new joiner's and contractor's laptop under policy from day one.",
    keywords: ["secure employee onboarding", "contractor device security", "BYOD security", "device enrollment", "new hire laptop security"],
  },
];

export const getSolution = (slug: string) => solutionsList.find((s) => s.slug === slug);

export type Industry = {
  slug: string;
  name: string;
  icon: SolutionIconKey;
  menu: string;
  headline: string;
  accent: string[];
  intro: string;
  hero: ShotKey;
  challenges: { title: string; body: string }[];
  data: string[]; // the sensitive data this industry handles
  useCases: { title: string; body: string; shot: ShotKey }[];
  modules: ModuleSlug[];
  solutions: string[];
  faqs: { q: string; a: string }[];
  seoTitle: string;
  description: string;
};

export const industries: Industry[] = [
  {
    slug: "it-and-software",
    name: "IT services and software",
    icon: "code",
    menu: "Protect source code, client data and credentials",
    headline: "Ship code without shipping your secrets.",
    accent: ["secrets."],
    intro: "Software teams handle client code, production credentials and customer data on laptops that move between home and office. Aavishield catches secrets leaving, blocks risky tools and gives client audits the evidence they ask for.",
    hero: "dlp",
    challenges: [
      { title: "Secrets in chat and AI tools", body: "Keys and tokens pasted into Teams, Slack or ChatGPT while debugging." },
      { title: "Client code confidentiality", body: "Client contracts often forbid code leaving approved systems." },
      { title: "Developer freedom", body: "Engineers need admin rights and broad internet access to work." },
      { title: "Client security audits", body: "Every enterprise client sends another questionnaire." },
    ],
    data: ["Source code", "API keys and tokens", "Database URLs", "Client documents", "Customer exports"],
    useCases: [
      { title: "Catch leaked credentials", body: "DLP flags AWS keys, GitHub tokens and database URLs leaving in messages and uploads.", shot: "dlp" },
      { title: "Govern AI coding tools", body: "Allow the approved assistant, block the rest, and see source code uploads.", shot: "webGateway" },
      { title: "Prove controls to clients", body: "Export device compliance and incident reports for client reviews.", shot: "reportsCompliance" },
    ],
    modules: ["data-loss-prevention", "web-gateway", "application-control", "device-posture"],
    solutions: ["ai-data-leakage", "insider-threat", "compliance-audit-readiness"],
    faqs: [
      { q: "Will it break developer tools?", a: "No. DLP is monitor-only and does not block. Web filtering is limited to the categories you choose." },
      { q: "Does it work on Linux workstations?", a: "Yes. The agent runs on Linux as well as macOS and Windows." },
      { q: "Can it see secrets in git pushes?", a: "DLP inspects outbound uploads and messages over the network, including to code hosting and file-sharing sites." },
    ],
    seoTitle: "Endpoint Security for IT and Software Companies",
    description: "Detect leaked credentials and source code, govern AI coding tools and prove controls to clients with Aavishield endpoint security for software teams.",
  },
  {
    slug: "financial-services",
    name: "Financial services and fintech",
    icon: "bank",
    menu: "Customer financial data, card numbers and audits",
    headline: "Customer money data stays where it belongs.",
    accent: ["belongs."],
    intro: "Lenders, brokers, payment companies and accounting firms process card numbers, bank details and identity documents every day. Aavishield shows where that data goes and keeps every device at a baseline auditors accept.",
    hero: "reportsCompliance",
    challenges: [
      { title: "Regulated data", body: "Card numbers, bank accounts, PAN and identity documents." },
      { title: "Strict audits", body: "Regulators and partners expect strong endpoint controls." },
      { title: "Phishing targets", body: "Finance teams are prime targets for invoice and payment fraud." },
      { title: "Remote advisors", body: "Staff working from home or client sites." },
    ],
    data: ["Card numbers", "Bank account and IFSC details", "PAN and Aadhaar numbers", "Salary data", "Customer KYC documents"],
    useCases: [
      { title: "Track financial data movement", body: "DLP detects card numbers, bank details and identity numbers in uploads and messages.", shot: "dlp" },
      { title: "Block payment-fraud lures", body: "Malicious invoices and look-alike login pages are stopped before they open.", shot: "activityDownloads" },
      { title: "Show device compliance", body: "Encryption, firewall and patch status for every device, exportable for audits.", shot: "reportsCompliance" },
    ],
    modules: ["data-loss-prevention", "malware-scanning", "device-posture", "web-gateway"],
    solutions: ["compliance-audit-readiness", "phishing-and-malware", "insider-threat"],
    faqs: [
      { q: "Can Aavishield detect Indian identity numbers?", a: "Yes. Detectors include PAN, Aadhaar, GST numbers, bank account details and card numbers, alongside AI classification of documents." },
      { q: "Does it support audit reporting?", a: "Yes. Reports export to PDF, Excel and CSV." },
      { q: "Can we restrict sensitive banking sites?", a: "Sensitive banking and finance sites are a category that can be blocked or allowed per policy." },
    ],
    seoTitle: "Endpoint DLP for Financial Services",
    description: "Monitor card numbers, bank details and identity documents leaving devices, block payment fraud and export compliance evidence with Aavishield.",
  },
  {
    slug: "healthcare",
    name: "Healthcare and life sciences",
    icon: "heart",
    menu: "Patient records, reports and shared workstations",
    headline: "Patient data protected on every screen.",
    accent: ["every", "screen."],
    intro: "Clinics, diagnostic labs and health-tech companies handle patient reports, prescriptions and identity documents on busy, shared devices. Aavishield keeps those devices patched, encrypted and watched for sensitive data leaving.",
    hero: "activity",
    challenges: [
      { title: "Sensitive health data", body: "Lab reports, prescriptions and patient IDs." },
      { title: "Shared devices", body: "Front-desk and lab computers used by many people." },
      { title: "Messaging habits", body: "Reports sent over personal WhatsApp or email." },
      { title: "Ransomware risk", body: "Healthcare is a frequent ransomware target." },
    ],
    data: ["Patient reports", "Identity documents", "Prescriptions", "Insurance details", "Staff records"],
    useCases: [
      { title: "See reports leaving over chat", body: "DLP flags identity documents and sensitive files sent through WhatsApp Web, Gmail and more.", shot: "dlp" },
      { title: "Stop ransomware at the download", body: "Malicious downloads are blocked before they can run.", shot: "activityDownloads" },
      { title: "Keep devices compliant", body: "Encryption and patch status on every workstation.", shot: "reportsCompliance" },
    ],
    modules: ["data-loss-prevention", "malware-scanning", "device-posture", "web-gateway"],
    solutions: ["phishing-and-malware", "compliance-audit-readiness", "productivity-and-distraction"],
    faqs: [
      { q: "Can it read scanned or photographed documents?", a: "Yes. Images and scanned PDFs are read with OCR before classification." },
      { q: "Does it work on Windows front-desk PCs?", a: "Yes. The agent runs on Windows, macOS and Linux." },
      { q: "Can healthcare sites be treated differently?", a: "Sensitive healthcare sites are a category you can allow or block." },
    ],
    seoTitle: "Endpoint Security for Healthcare and Labs",
    description: "Protect patient reports and identity documents, stop ransomware downloads and keep shared workstations compliant with Aavishield.",
  },
  {
    slug: "bpo-and-customer-support",
    name: "BPO and customer support",
    icon: "headset",
    menu: "Large agent teams handling customer records",
    headline: "Hundreds of agents. One consistent policy.",
    accent: ["consistent"],
    intro: "Contact centres and support teams give large numbers of agents access to customer records, often across shifts and locations. Aavishield enforces the same web and data policy on every seat and shows how time is spent where monitoring is part of the job.",
    hero: "screenshots",
    challenges: [
      { title: "Customer records at scale", body: "Agents see customer names, phone numbers and payment details." },
      { title: "Client requirements", body: "Clients mandate strict controls and monitoring." },
      { title: "High turnover", body: "Frequent onboarding and offboarding." },
      { title: "Work-from-home agents", body: "Remote seats outside the centre's network." },
    ],
    data: ["Customer contact details", "Payment information", "Call notes", "Account records", "Client documents"],
    useCases: [
      { title: "Lock down web access", body: "Block social media, personal email and file sharing on agent machines.", shot: "categories" },
      { title: "Monitor where required", body: "Screenshots, activity timeline and work sessions for monitored seats.", shot: "screenshots" },
      { title: "Fast onboarding", body: "New agents enroll from a link and get policy immediately.", shot: "employees" },
    ],
    modules: ["web-gateway", "activity-monitoring", "data-loss-prevention", "application-control"],
    solutions: ["productivity-and-distraction", "insider-threat", "contractors-and-byod"],
    faqs: [
      { q: "Can screenshots be blurred?", a: "Screenshot settings include interval, idle threshold, retention and a blur option." },
      { q: "Can policies differ by client team?", a: "Yes. Use teams to apply different policies to different client programmes." },
      { q: "How long are screenshots kept?", a: "Retention is configurable per organisation." },
    ],
    seoTitle: "Endpoint Security for BPO and Support Teams",
    description: "Consistent web and data policy on every agent seat, optional activity monitoring and fast onboarding for contact centres with Aavishield.",
  },
  {
    slug: "startups-and-smbs",
    name: "Startups and growing SMBs",
    icon: "rocket",
    menu: "Enterprise-grade controls without a security team",
    headline: "Security your first enterprise customer will accept.",
    accent: ["accept."],
    intro: "Growing companies need to pass security reviews and protect customer data long before they can hire a security team. Aavishield gives one IT person the controls of a much larger company, in one agent and one console.",
    hero: "overview",
    challenges: [
      { title: "No security team", body: "Security is a part-time job for a founder or IT generalist." },
      { title: "Security questionnaires", body: "Enterprise deals depend on good answers." },
      { title: "Mixed devices", body: "Macs, Windows and Linux, company-owned and personal." },
      { title: "Tight budget", body: "No room for four separate security products." },
    ],
    data: ["Customer data", "Source code", "Financial records", "Employee records", "Investor documents"],
    useCases: [
      { title: "One console for everything", body: "Web, data, apps, downloads and posture in one place.", shot: "overview" },
      { title: "Ask the assistant", body: "The built-in assistant answers questions about devices, alerts and reports from live data.", shot: "ai" },
      { title: "Answer questionnaires", body: "Export compliance and incident reports in minutes.", shot: "reports" },
    ],
    modules: ["web-gateway", "data-loss-prevention", "device-posture", "vpn-control"],
    solutions: ["compliance-audit-readiness", "ai-data-leakage", "remote-workforce-security"],
    faqs: [
      { q: "How fast can we get started?", a: "Most teams install the agent and set a policy in an afternoon." },
      { q: "Do we need a dedicated security person?", a: "No. The console is built for one IT person or founder to run." },
      { q: "Can we start small?", a: "Yes. Start with a few controls and turn on more later, with no reinstall." },
    ],
    seoTitle: "Endpoint Security for Startups and SMBs",
    description: "Enterprise-grade web filtering, DLP, device posture and VPN control for growing companies, run by one person from one Aavishield console.",
  },
];

export const getIndustry = (slug: string) => industries.find((i) => i.slug === slug);

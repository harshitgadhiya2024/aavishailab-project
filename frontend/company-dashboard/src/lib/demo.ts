/**
 * Local preview data for the company dashboard (Northwind Labs).
 * Turned on with NEXT_PUBLIC_DEMO_DATA=1 so marketing screenshots can be
 * taken against the latest UI without admin-api.
 */

import { PERMISSIONS } from "@/lib/permissions";

export const isDemo = process.env.NEXT_PUBLIC_DEMO_DATA === "1";

export const DEMO_SESSION = {
  expires: "2099-12-31T23:59:59.999Z",
  accessToken: "",
  user: {
    id: "emp-meera",
    email: "meera.shah@northwindlabs.com",
    name: "Meera Shah",
    full_name: "Meera Shah",
    first_name: "Meera",
    last_name: "Shah",
    role: "org_admin",
    org_id: "org-northwind",
    org_name: "Northwind Labs",
    permissions: Object.values(PERMISSIONS),
  },
};

const EMP = {
  aisha: { first_name: "Aisha", last_name: "Qureshi", email: "aisha.qureshi@northwindlabs.com" },
  farhan: { first_name: "Farhan", last_name: "Ali", email: "farhan.ali@northwindlabs.com" },
  pooja: { first_name: "Pooja", last_name: "Bhatt", email: "pooja.bhatt@northwindlabs.com" },
  kavya: { first_name: "Kavya", last_name: "Reddy", email: "kavya.reddy@northwindlabs.com" },
  daniel: { first_name: "Daniel", last_name: "Fernandez", email: "daniel.fernandez@northwindlabs.com" },
  lakshmi: { first_name: "Lakshmi", last_name: "Menon", email: "lakshmi.menon@northwindlabs.com" },
  rohan: { first_name: "Rohan", last_name: "Mehta", email: "rohan.mehta@northwindlabs.com" },
  neha: { first_name: "Neha", last_name: "Kapoor", email: "neha.kapoor@northwindlabs.com" },
  isha: { first_name: "Isha", last_name: "Desai", email: "isha.desai@northwindlabs.com" },
  vikram: { first_name: "Vikram", last_name: "Rao", email: "vikram.rao@northwindlabs.com" },
  nikhil: { first_name: "Nikhil", last_name: "Verma", email: "nikhil.verma@northwindlabs.com" },
  karan: { first_name: "Karan", last_name: "Sethi", email: "karan.sethi@northwindlabs.com" },
  riya: { first_name: "Riya", last_name: "Chopra", email: "riya.chopra@northwindlabs.com" },
  kabir: { first_name: "Kabir", last_name: "Malhotra", email: "kabir.malhotra@northwindlabs.com" },
  aditya: { first_name: "Aditya", last_name: "Joshi", email: "aditya.joshi@northwindlabs.com" },
  zoya: { first_name: "Zoya", last_name: "Khan", email: "zoya.khan@northwindlabs.com" },
  siddharth: { first_name: "Siddharth", last_name: "Pillai", email: "siddharth.pillai@northwindlabs.com" },
  priya: { first_name: "Priya", last_name: "Iyer", email: "priya.iyer@northwindlabs.com" },
  arjun: { first_name: "Arjun", last_name: "Nair", email: "arjun.nair@northwindlabs.com" },
  meera: { first_name: "Meera", last_name: "Shah", email: "meera.shah@northwindlabs.com" },
};

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

function daysAgo(d: number, hour = 14) {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(hour, 12, 0, 0);
  return x.toISOString();
}

function ymdOffset(d: number) {
  const x = new Date();
  x.setDate(x.getDate() - d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

function pageOf<T>(rows: T[], page = 1, limit = 20) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);
  const start = (p - 1) * l;
  return { data: rows.slice(start, start + l), total: rows.length };
}

function pathOf(url?: string) {
  if (!url) return "";
  try {
    if (url.startsWith("http")) return new URL(url).pathname;
  } catch { /* relative */ }
  return url.split("?")[0];
}

const TITLES: Record<string, { department: string; job_title: string; phone: string; team: string }> = {
  aisha: { department: "Engineering", job_title: "Frontend engineer", phone: "+91 98765 41001", team: "team-eng" },
  farhan: { department: "Engineering", job_title: "Backend engineer", phone: "+91 98765 41002", team: "team-eng" },
  pooja: { department: "Finance", job_title: "Accounts lead", phone: "+91 98765 41003", team: "team-fin" },
  kavya: { department: "People", job_title: "People partner", phone: "+91 98765 41004", team: "team-people" },
  daniel: { department: "Engineering", job_title: "DevOps engineer", phone: "+91 98765 41005", team: "team-eng" },
  lakshmi: { department: "Engineering", job_title: "Staff engineer", phone: "+91 98765 41006", team: "team-eng" },
  rohan: { department: "Finance", job_title: "FP&A analyst", phone: "+91 98765 41007", team: "team-fin" },
  neha: { department: "Design", job_title: "Product designer", phone: "+91 98765 41008", team: "team-design" },
  isha: { department: "Sales", job_title: "Account executive", phone: "+91 98765 41009", team: "team-sales" },
  vikram: { department: "Sales", job_title: "Sales engineer", phone: "+91 98765 41010", team: "team-sales" },
  nikhil: { department: "Engineering", job_title: "Security engineer", phone: "+91 98765 41011", team: "team-eng" },
  karan: { department: "Engineering", job_title: "QA engineer", phone: "+91 98765 41012", team: "team-eng" },
  riya: { department: "Design", job_title: "Brand designer", phone: "+91 98765 41013", team: "team-design" },
  kabir: { department: "Engineering", job_title: "Platform engineer", phone: "+91 98765 41014", team: "team-eng" },
  aditya: { department: "Engineering", job_title: "iOS engineer", phone: "+91 98765 41015", team: "team-eng" },
  zoya: { department: "Engineering", job_title: "QA analyst", phone: "+91 98765 41016", team: "team-eng" },
  siddharth: { department: "Sales", job_title: "SDR", phone: "+91 98765 41017", team: "team-sales" },
  priya: { department: "People", job_title: "Recruiter", phone: "+91 98765 41018", team: "team-people" },
  arjun: { department: "Design", job_title: "UX researcher", phone: "+91 98765 41019", team: "team-design" },
  meera: { department: "People", job_title: "IT administrator", phone: "+91 98765 41020", team: "team-people" },
};

const EMPLOYEES = Object.entries(EMP).map(([key, e], i) => {
  const extra = TITLES[key];
  return {
    id: `emp-${key}`,
    ...e,
    department: extra.department,
    job_title: extra.job_title,
    title: extra.job_title,
    phone: extra.phone,
    team_id: extra.team,
    status: key === "siddharth" ? "inactive" : "active",
    created_at: daysAgo(90 - i * 3, 10),
  };
});

const DEPARTMENTS = [...new Set(EMPLOYEES.map((e) => e.department))];

type DemoEvent = {
  id: string;
  action: string;
  target: string;
  target_domain?: string;
  target_app?: string;
  event_type?: string;
  operation?: string;
  category: string;
  policy_name?: string;
  risk_score: number;
  timestamp: string;
  employee: { first_name: string; last_name: string; email: string };
  process_name?: string;
  metadata?: {
    request_source?: string;
    service?: string;
    site?: string;
    content_kind?: string;
    detectors?: string[];
    app_name?: string;
  };
};

const DLP_EVENTS: DemoEvent[] = [
  { id: "dlp-1", action: "alerted", target: "passport-copy.png", target_domain: "mail.google.com", risk_score: 80, timestamp: hoursAgo(2), category: "dlp", operation: "File upload", policy_name: "Sensitive data", employee: EMP.aisha, metadata: { request_source: "browser", service: "Gmail", site: "mail.google.com", content_kind: "file-upload", detectors: ["passport_number"] } },
  { id: "dlp-2", action: "alerted", target: "aadhaar-scan.jpg", target_domain: "mail.google.com", risk_score: 84, timestamp: hoursAgo(5), category: "dlp", operation: "File upload", policy_name: "Sensitive data", employee: EMP.farhan, metadata: { request_source: "browser", service: "Gmail", site: "mail.google.com", content_kind: "file-upload", detectors: ["aadhaar_number"] } },
  { id: "dlp-3", action: "alerted", target: "aadhaar-scan.jpg", target_domain: "mail.google.com", risk_score: 74, timestamp: hoursAgo(26), category: "dlp", operation: "File upload", policy_name: "Sensitive data", employee: EMP.farhan, metadata: { request_source: "browser", service: "Gmail", site: "mail.google.com", content_kind: "file-upload", detectors: ["aadhaar_number"] } },
  { id: "dlp-4", action: "alerted", target: "vendor-bank-details.pdf", target_domain: "web.whatsapp.com", risk_score: 69, timestamp: hoursAgo(30), category: "dlp", operation: "File upload", policy_name: "Sensitive data", employee: EMP.pooja, metadata: { request_source: "browser", service: "WhatsApp", site: "web.whatsapp.com", content_kind: "file-upload", detectors: ["bank_account", "ifsc_code"] } },
  { id: "dlp-5", action: "alerted", target: "offer-letter-final.pdf", target_domain: "outlook.office.com", risk_score: 56, timestamp: daysAgo(2, 15), category: "dlp", operation: "File upload", policy_name: "Sensitive data", employee: EMP.kavya, metadata: { request_source: "browser", service: "Outlook", site: "outlook.office.com", content_kind: "file-upload", detectors: ["salary_data", "pan_number"] } },
  { id: "dlp-6", action: "alerted", target: "customer-export-sept.csv", target_domain: "drive.google.com", risk_score: 77, timestamp: daysAgo(2, 19), category: "dlp", operation: "File upload", policy_name: "Sensitive data", employee: EMP.daniel, metadata: { request_source: "browser", service: "Google Drive", site: "drive.google.com", content_kind: "file-upload", detectors: ["email_address", "phone_number", "credentials"] } },
  { id: "dlp-7", action: "alerted", target: "db-schema.sql", target_domain: "gemini.google.com", risk_score: 58, timestamp: daysAgo(3, 11), category: "dlp", operation: "File upload", policy_name: "Sensitive data", employee: EMP.lakshmi, metadata: { request_source: "browser", service: "Gemini", site: "gemini.google.com", content_kind: "file-upload", detectors: ["source_code"] } },
  { id: "dlp-8", action: "alerted", target: "prod.env", target_domain: "", risk_score: 95, timestamp: daysAgo(3, 21), category: "dlp", operation: "File shared", policy_name: "Sensitive data", employee: EMP.rohan, metadata: { request_source: "app", app_name: "Microsoft Teams", content_kind: "text", detectors: ["aws_key", "database_url"] } },
];

const WEB_EVENTS: DemoEvent[] = [
  { id: "web-1", action: "blocked", target: "x.com", target_domain: "x.com", target_app: "X", event_type: "web_request", operation: "Web request", category: "url_category", policy_name: "Social Media", risk_score: 10, timestamp: hoursAgo(1), employee: EMP.aisha },
  { id: "web-2", action: "blocked", target: "perplexity.ai", target_domain: "perplexity.ai", target_app: "Perplexity", event_type: "web_request", operation: "Web request", category: "url_category", policy_name: "AI Tools", risk_score: 25, timestamp: hoursAgo(3), employee: EMP.neha },
  { id: "web-3", action: "blocked", target: "instagram.com", target_domain: "instagram.com", target_app: "Instagram", event_type: "web_request", operation: "Web request", category: "url_category", policy_name: "Social Media", risk_score: 10, timestamp: hoursAgo(4), employee: EMP.isha },
  { id: "web-4", action: "blocked", target: "dream11.com", target_domain: "dream11.com", event_type: "web_request", operation: "Web request", category: "url_category", policy_name: "Gambling", risk_score: 20, timestamp: hoursAgo(8), employee: EMP.vikram },
  { id: "web-5", action: "blocked", target: "facebook.com", target_domain: "facebook.com", event_type: "web_request", operation: "Web request", category: "url_category", policy_name: "Social Media", risk_score: 20, timestamp: hoursAgo(20), employee: EMP.nikhil },
  { id: "web-6", action: "blocked", target: "perplexity.ai", target_domain: "perplexity.ai", event_type: "web_request", operation: "Web request", category: "url_category", policy_name: "AI Tools", risk_score: 25, timestamp: hoursAgo(22), employee: EMP.riya },
  { id: "web-7", action: "blocked", target: "bet365.com", target_domain: "bet365.com", event_type: "web_request", operation: "Web request", category: "url_category", policy_name: "Gambling", risk_score: 30, timestamp: daysAgo(1, 16), employee: EMP.kabir },
  { id: "web-8", action: "blocked", target: "chat.deepseek.com", target_domain: "chat.deepseek.com", event_type: "web_request", operation: "Web request", category: "url_category", policy_name: "AI Tools", risk_score: 25, timestamp: daysAgo(1, 10), employee: EMP.arjun },
];

const APP_EVENTS: DemoEvent[] = [
  { id: "app-1", action: "blocked", target: "Tor Browser", target_domain: "", event_type: "app_launch", operation: "App launch", category: "application_control", policy_name: "Application control: Tor Browser", risk_score: 0, timestamp: hoursAgo(18), employee: EMP.farhan, process_name: "tor" },
  { id: "app-2", action: "blocked", target: "uTorrent", target_domain: "", event_type: "app_launch", operation: "App launch", category: "application_control", policy_name: "Application control: uTorrent", risk_score: 0, timestamp: hoursAgo(21), employee: EMP.karan, process_name: "utorrent" },
  { id: "app-3", action: "blocked", target: "AnyDesk", target_domain: "", event_type: "app_launch", operation: "App launch", category: "application_control", policy_name: "Application control: AnyDesk", risk_score: 0, timestamp: daysAgo(1, 12), employee: EMP.aditya, process_name: "anydesk" },
];

const VPN_EVENTS: DemoEvent[] = [
  { id: "vpn-1", action: "blocked", target: "NordVPN", target_domain: "", event_type: "app_launch", operation: "App launch", category: "application_control", policy_name: "VPN control", risk_score: 40, timestamp: daysAgo(1, 9), employee: EMP.nikhil, process_name: "nordvpn" },
];

const MALWARE_EVENTS: DemoEvent[] = [
  { id: "mal-1", action: "blocked", target: "invoice-q3-final.exe", target_domain: "files.wetransfer.com", event_type: "file_download", operation: "File download", category: "malware_detection", policy_name: "Trojan.GenericKD.48291", risk_score: 96, timestamp: hoursAgo(6), employee: EMP.vikram },
  { id: "mal-2", action: "blocked", target: "payroll-fix.msi", target_domain: "cdn.discordapp.com", event_type: "file_download", operation: "File download", category: "malware_detection", policy_name: "Win32.Downloader.Agent", risk_score: 91, timestamp: hoursAgo(14), employee: EMP.kabir },
  { id: "mal-3", action: "blocked", target: "zoom-update.zip", target_domain: "drive.google.com", event_type: "file_download", operation: "File download", category: "malware_detection", policy_name: "PUA.Win.BundleInstaller", risk_score: 72, timestamp: daysAgo(1, 17), employee: EMP.isha },
  { id: "mal-4", action: "blocked", target: "chrome-plugin.crx", target_domain: "github.com", event_type: "file_download", operation: "File download", category: "malware_detection", policy_name: "JS.BrowserStealer", risk_score: 88, timestamp: daysAgo(2, 11), employee: EMP.aditya },
];

const POSTURE_EVENTS: DemoEvent[] = [
  { id: "pos-1", action: "alerted", target: "OS updates off", target_domain: "NW-DANIEL-LT08", event_type: "posture_check", operation: "Posture check", category: "device_posture", policy_name: "Device security baseline", risk_score: 70, timestamp: hoursAgo(9), employee: EMP.daniel },
  { id: "pos-2", action: "alerted", target: "OS updates off", target_domain: "NW-KARAN-LT12", event_type: "posture_check", operation: "Posture check", category: "device_posture", policy_name: "Device security baseline", risk_score: 68, timestamp: hoursAgo(11), employee: EMP.karan },
  { id: "pos-3", action: "alerted", target: "Firewall off", target_domain: "NW-SIDDHARTH-LT17", event_type: "posture_check", operation: "Posture check", category: "device_posture", policy_name: "Device security baseline", risk_score: 82, timestamp: hoursAgo(16), employee: EMP.siddharth },
  { id: "pos-4", action: "alerted", target: "Disk encryption off", target_domain: "NW-ISHA-MB04", event_type: "posture_check", operation: "Posture check", category: "device_posture", policy_name: "Device security baseline", risk_score: 75, timestamp: daysAgo(1, 13), employee: EMP.isha },
];

const ALL_ACTIVITY = [...WEB_EVENTS, ...DLP_EVENTS, ...APP_EVENTS, ...VPN_EVENTS, ...MALWARE_EVENTS, ...POSTURE_EVENTS]
  .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));

const INSTALLED = [
  { id: "app-utorrent-kabir", name: "uTorrent", version: "3.5.5", vendor: "BitTorrent", category: "p2p", risk_level: 90, first_seen_at: daysAgo(18), employee_name: "Kabir Malhotra", device_name: "Kabir-MacBook-Pro", block_network: true, block_process: true },
  { id: "app-chrome-aditya", name: "Google Chrome", version: "129.0.6668", vendor: "Google", category: "browser", risk_level: 10, first_seen_at: daysAgo(22), employee_name: "Aditya Joshi", device_name: "Aditya-MacBook-Pro", block_network: false, block_process: false },
  { id: "app-teams-kavya", name: "Microsoft Teams", version: "24295.606.3238", vendor: "Microsoft", category: "messaging", risk_level: 15, first_seen_at: daysAgo(22), employee_name: "Kavya Reddy", device_name: "Kavya-MacBook-Pro", block_network: false, block_process: false },
  { id: "app-vscode-lakshmi", name: "Visual Studio Code", version: "1.94.2", vendor: "Microsoft", category: "development", risk_level: 10, first_seen_at: daysAgo(25), employee_name: "Lakshmi Menon", device_name: "Lakshmi-MacBook-Pro", block_network: false, block_process: false },
  { id: "app-zoom-farhan", name: "Zoom", version: "6.2.6", vendor: "Zoom", category: "messaging", risk_level: 15, first_seen_at: daysAgo(28), employee_name: "Farhan Ali", device_name: "Farhan-MacBook-Pro", block_network: false, block_process: false },
  { id: "app-postman-zoya", name: "Postman", version: "11.16.0", vendor: "Postman", category: "development", risk_level: 20, first_seen_at: daysAgo(29), employee_name: "Zoya Khan", device_name: "Zoya-ThinkPad", block_network: false, block_process: false },
  { id: "app-excel-rohan", name: "Microsoft Excel", version: "16.89", vendor: "Microsoft", category: "other", risk_level: 10, first_seen_at: daysAgo(29), employee_name: "Rohan Mehta", device_name: "Rohan-ThinkPad", block_network: false, block_process: false },
  { id: "app-anydesk-aditya", name: "AnyDesk", version: "8.1.0", vendor: "AnyDesk", category: "remote_access", risk_level: 88, first_seen_at: daysAgo(12), employee_name: "Aditya Joshi", device_name: "Aditya-MacBook-Pro", block_network: true, block_process: true },
  { id: "app-nord-nikhil", name: "NordVPN", version: "8.27.1", vendor: "Nord Security", category: "vpn", risk_level: 92, first_seen_at: daysAgo(6), employee_name: "Nikhil Verma", device_name: "Nikhil-Windows", block_network: true, block_process: true },
];

const POLICIES = [
  {
    id: "pol-ai",
    name: "Unapproved AI tools",
    description: "Only the approved AI assistant is allowed",
    type: "url_category",
    action: "block",
    enabled: true,
    rules: { categories: ["ai_tools"] },
    targets: { scope: "all" },
    created_at: daysAgo(40),
  },
  {
    id: "pol-web",
    name: "Block distracting and risky sites",
    description: "Company-wide web policy",
    type: "url_category",
    action: "block",
    enabled: true,
    rules: { categories: ["social_media", "gambling", "adult_content", "file_sharing", "anonymizer", "p2p", "streaming", "games"] },
    targets: { scope: "all" },
    created_at: daysAgo(40),
  },
];

const TEAMS = [
  { id: "team-eng", name: "Engineering", description: "Product, platform and security engineers", member_count: 9, created_at: daysAgo(80) },
  { id: "team-design", name: "Design", description: "Product, brand and research", member_count: 3, created_at: daysAgo(78) },
  { id: "team-fin", name: "Finance", description: "Accounts and FP&A", member_count: 2, created_at: daysAgo(70) },
  { id: "team-people", name: "People & IT", description: "HR, recruiting and IT administration", member_count: 3, created_at: daysAgo(70) },
  { id: "team-sales", name: "Sales", description: "Account executives and SDRs", member_count: 3, created_at: daysAgo(65) },
];

const HOSTS: Record<string, string> = {
  aisha: "NW-AISHA-MB02",
  farhan: "NW-FARHAN-MB03",
  pooja: "NW-POOJA-LT05",
  kavya: "NW-KAVYA-MB04",
  daniel: "NW-DANIEL-LT08",
  lakshmi: "NW-LAKSHMI-MB06",
  rohan: "NW-ROHAN-LT07",
  neha: "NW-NEHA-MB09",
  isha: "NW-ISHA-MB04",
  vikram: "NW-VIKRAM-LT10",
  nikhil: "NW-NIKHIL-LT11",
  karan: "NW-KARAN-LT12",
  riya: "NW-RIYA-MB13",
  kabir: "NW-KABIR-MB14",
  aditya: "NW-ADITYA-MB15",
  zoya: "NW-ZOYA-LT16",
  siddharth: "NW-SIDDHARTH-LT17",
  priya: "NW-PRIYA-MB18",
  arjun: "NW-ARJUN-MB19",
  meera: "NW-MEERA-LT20",
};

const DEVICE_ROWS = Object.keys(EMP).map((key, i) => {
  const os = (["darwin", "windows", "linux"] as const)[i % 3];
  const hostname = HOSTS[key];
  const issues = key === "daniel" || key === "karan" || key === "siddharth" || key === "isha";
  const offline = key === "siddharth";
  return {
    id: `dev-${key}`,
    hostname,
    os_type: os,
    os_version: os === "darwin" ? "15.1" : os === "windows" ? "11 24H2" : "Ubuntu 24.04",
    agent_version: "1.4.2",
    mac_address: `3C:22:FB:1A:${(10 + i).toString(16).padStart(2, "0")}:${(20 + i).toString(16).padStart(2, "0")}`,
    ip_address: `10.12.4.${20 + i}`,
    status: offline ? "offline" : "online",
    last_seen_at: offline ? daysAgo(9, 18) : hoursAgo(i % 4),
    posture_score: issues ? (key === "siddharth" ? 62 : 78) : 96 - (i % 5),
    ownership: key === "isha" || key === "arjun" ? "personal" : "company",
    employee: EMP[key as keyof typeof EMP],
    metadata: {
      cap_screen_recording: key !== "priya",
      cap_input_monitoring: key !== "priya",
    },
    enforcement: {
      mode: "full",
      until: null,
      source: "org",
    },
  };
});

const DEVICE_ACTIVITY = [
  { id: "lc-1", employee: "Aisha Qureshi", event: "Connected", event_type: "connected", hostname: "NW-AISHA-MB02", timestamp: hoursAgo(2) },
  { id: "lc-2", employee: "Daniel Fernandez", event: "Connected", event_type: "connected", hostname: "NW-DANIEL-LT08", timestamp: hoursAgo(5) },
  { id: "lc-3", employee: "Siddharth Pillai", event: "Disconnected", event_type: "disconnected", hostname: "NW-SIDDHARTH-LT17", detail: "Last seen 9 days ago", timestamp: daysAgo(9, 18) },
  { id: "lc-4", employee: "Kavya Reddy", event: "Connected", event_type: "connected", hostname: "NW-KAVYA-MB04", timestamp: hoursAgo(1) },
];

const CATEGORIES = [
  { id: "cat-ai", name: "AI tools", slug: "ai_tools", description: "Generative AI chat and coding assistants", risk_level: 3, domain_count: 48, color: "#7c3aed" },
  { id: "cat-social", name: "Social media", slug: "social_media", description: "Social networks and short-form video", risk_level: 2, domain_count: 126, color: "#2563eb" },
  { id: "cat-gamble", name: "Gambling", slug: "gambling", description: "Betting, casinos and fantasy sports", risk_level: 4, domain_count: 214, color: "#dc2626" },
  { id: "cat-adult", name: "Adult content", slug: "adult_content", description: "Pornography and adult streaming", risk_level: 5, domain_count: 890, color: "#9f1239" },
  { id: "cat-share", name: "File sharing", slug: "file_sharing", description: "Public file hosts and anonymous transfer", risk_level: 4, domain_count: 67, color: "#c2410c" },
  { id: "cat-anon", name: "Anonymizer", slug: "anonymizer", description: "Proxies, VPNs sold as anonymity tools", risk_level: 5, domain_count: 41, color: "#0f766e" },
  { id: "cat-p2p", name: "P2P", slug: "p2p", description: "BitTorrent and peer-to-peer networks", risk_level: 4, domain_count: 33, color: "#b45309" },
  { id: "cat-stream", name: "Streaming", slug: "streaming", description: "Video and music streaming", risk_level: 2, domain_count: 58, color: "#0369a1" },
  { id: "cat-games", name: "Games", slug: "games", description: "Online games and game stores", risk_level: 2, domain_count: 72, color: "#15803d" },
  { id: "cat-cloud", name: "Cloud storage", slug: "cloud_storage", description: "Personal cloud drives outside the company", risk_level: 3, domain_count: 29, color: "#1d4ed8" },
];

const ACCESS_REQUESTS = [
  { id: "ar-1", kind: "website", label: "instagram.com", domain: "instagram.com", resource: "instagram.com", reason: "Need Stories ads manager for the Diwali campaign", status: "pending", created_at: hoursAgo(3), employee: EMP.isha },
  { id: "ar-2", kind: "website", label: "perplexity.ai", domain: "perplexity.ai", resource: "perplexity.ai", reason: "Research competitor pricing for the Q4 deck", status: "pending", created_at: hoursAgo(7), employee: EMP.neha },
  { id: "ar-3", kind: "application", label: "Slack", domain: "", resource: "Slack", reason: "Customer success uses Slack Connect with Acme", status: "approved", created_at: daysAgo(2, 11), reviewed_at: daysAgo(2, 16), employee: EMP.priya },
  { id: "ar-4", kind: "website", label: "chatgpt.com", domain: "chatgpt.com", resource: "chatgpt.com", reason: "Drafting job descriptions", status: "approved", created_at: daysAgo(4, 9), reviewed_at: daysAgo(4, 14), employee: EMP.kavya },
  { id: "ar-5", kind: "download", label: "zoom-update.zip", domain: "drive.google.com", resource: "zoom-update.zip", reason: "IT sent the official Zoom package", status: "denied", created_at: daysAgo(1, 17), reviewed_at: daysAgo(1, 18), review_note: "File was flagged as a bundle installer", employee: EMP.isha },
  { id: "ar-6", kind: "dlp", label: "offer-letter-final.pdf", domain: "outlook.office.com", resource: "offer-letter-final.pdf", reason: "Sending an approved offer to a candidate", status: "approved", created_at: daysAgo(2, 15), reviewed_at: daysAgo(2, 16), employee: EMP.kavya },
];

const REPORT_CATALOG = [
  { id: "executive", group: "Overview", name: "Executive summary", description: "Protection status, incidents by control and change vs the previous period. The one to send to management.", icon: "layout-dashboard" },
  { id: "incidents", group: "Security", name: "All incidents", description: "Every blocked or flagged event, with employee, device, control and policy.", icon: "shield" },
  { id: "dlp", group: "Security", name: "Data protection", description: "Sensitive data leaving the company: which service, what kind of data, how severe, and who.", icon: "file-warning" },
  { id: "web", group: "Security", name: "Web filtering", description: "Blocked websites by domain and category, and who tried to reach them.", icon: "globe" },
  { id: "apps", group: "Security", name: "Application control", description: "Blocked applications and VPN bypass attempts, by app and by employee.", icon: "app-window" },
  { id: "employee-risk", group: "People & devices", name: "Employee risk", description: "Incidents per employee, broken down by control, ranked by severity.", icon: "users" },
  { id: "employee-activity", group: "People & devices", name: "Employee activity", description: "Tracked and active hours, activity level and screenshots per employee.", icon: "clock" },
  { id: "devices", group: "People & devices", name: "Device compliance", description: "Every device with agent status, last check-in and security settings that are turned off.", icon: "monitor" },
  { id: "policies", group: "Governance", name: "Policy effectiveness", description: "Which policies fire and how often, so you can tune or retire them.", icon: "file-text" },
  { id: "access-requests", group: "Governance", name: "Access requests", description: "Exception requests from employees and how they were decided.", icon: "inbox" },
];

function shotSvg(title: string, accent: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#1b1d22"/><rect width="640" height="28" fill="#111317"/><circle cx="14" cy="14" r="5" fill="#ff5f57"/><circle cx="32" cy="14" r="5" fill="#febc2e"/><circle cx="50" cy="14" r="5" fill="#28c840"/><text x="68" y="18" fill="#9aa3b2" font-family="ui-sans-serif,system-ui" font-size="11">${title}</text><rect x="0" y="28" width="150" height="332" fill="#14171c"/><rect x="168" y="52" width="420" height="10" rx="2" fill="${accent}" opacity="0.85"/><rect x="168" y="76" width="360" height="8" rx="2" fill="#3a4150"/><rect x="168" y="96" width="300" height="8" rx="2" fill="#2c3340"/><rect x="168" y="128" width="440" height="180" rx="6" fill="#101318" stroke="${accent}" stroke-opacity="0.35"/><rect x="188" y="148" width="180" height="8" rx="2" fill="${accent}" opacity="0.55"/><rect x="188" y="168" width="380" height="6" rx="2" fill="#3a4150"/><rect x="188" y="184" width="340" height="6" rx="2" fill="#2c3340"/><rect x="188" y="200" width="300" height="6" rx="2" fill="#2c3340"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function monitoringDay() {
  const date = new Date();
  date.setHours(4, 0, 0, 0);
  const from = new Date(date);
  const to = new Date(date);
  to.setDate(to.getDate() + 1);
  const seg = (h1: number, m1: number, h2: number, m2: number, state: string) => {
    const start = new Date(from);
    start.setHours(h1, m1, 0, 0);
    const end = new Date(from);
    end.setHours(h2, m2, 0, 0);
    return { start: start.toISOString(), end: end.toISOString(), state };
  };
  const timeline = [
    seg(10, 5, 11, 20, "active"),
    seg(11, 20, 11, 40, "idle"),
    seg(11, 40, 13, 0, "active"),
    seg(13, 0, 13, 45, "meeting"),
    seg(13, 45, 16, 10, "active"),
    seg(16, 10, 16, 25, "idle"),
    seg(16, 25, 18, 40, "active"),
  ];
  const shots = [
    { id: "ss-1", captured_at: hoursAgo(5), interval_start: hoursAgo(5.2), interval_end: hoursAgo(5), activity_percent: 86, image_url: shotSvg("VS Code — aavishield-agent", "#3b82f6"), apps: ["Visual Studio Code", "Google Chrome"] },
    { id: "ss-2", captured_at: hoursAgo(4), interval_start: hoursAgo(4.2), interval_end: hoursAgo(4), activity_percent: 74, image_url: shotSvg("Figma — Northwind console", "#a855f7"), apps: ["Figma", "Slack"] },
    { id: "ss-3", captured_at: hoursAgo(3), interval_start: hoursAgo(3.2), interval_end: hoursAgo(3), activity_percent: 41, image_url: shotSvg("Gmail — Inbox", "#f59e0b"), apps: ["Google Chrome"] },
    { id: "ss-4", captured_at: hoursAgo(2), interval_start: hoursAgo(2.2), interval_end: hoursAgo(2), activity_percent: 91, image_url: shotSvg("Linear — Sprint 42", "#22c55e"), apps: ["Linear", "Visual Studio Code"] },
    { id: "ss-5", captured_at: hoursAgo(1), interval_start: hoursAgo(1.2), interval_end: hoursAgo(1), activity_percent: 68, image_url: shotSvg("Notion — Design spec", "#38bdf8"), apps: ["Notion", "Figma"] },
    { id: "ss-6", captured_at: hoursAgo(0.4), interval_start: hoursAgo(0.6), interval_end: hoursAgo(0.4), activity_percent: 22, image_url: shotSvg("Slack — #eng-northwind", "#6366f1"), apps: ["Slack"], employee_note: "Standup notes" },
  ];
  return {
    permissions: { delete_session: true, delete_screenshot: true },
    window: { from: from.toISOString(), to: to.toISOString() },
    totals: { screenshots: 28, tracked_seconds: 8 * 3600 + 12 * 60, active_seconds: 6 * 3600 + 40 * 60, avg_activity: 72 },
    timeline,
    sessions: [{
      id: "sess-1",
      started_at: hoursAgo(8),
      ended_at: hoursAgo(0.3),
      avg_activity: 72,
      project: "Console redesign",
      task: "Overview polish",
      ip: "10.12.4.21",
      hostname: "NW-AISHA-MB02",
      screenshots: shots,
    }],
  };
}

function reportFor(type: string) {
  const trend = [6, 5, 4, 3, 2, 1, 0].map((d, i) => {
    const row = {
      t: ymdOffset(d),
      dlp: [3, 4, 5, 4, 4, 4, 4][i],
      web: [38, 42, 46, 44, 48, 46, 46][i],
      apps: [2, 2, 3, 2, 3, 2, 2][i],
      vpn: [1, 2, 1, 2, 1, 2, 1][i],
      threats: [3, 4, 3, 4, 3, 4, 3][i],
      devices: [1, 0, 1, 1, 0, 1, 0][i],
    };
    return { ...row, total: row.dlp + row.web + row.apps + row.vpn + row.threats + row.devices };
  });
  const topUsers = [
    ["Farhan Ali", "farhan.ali@northwindlabs.com", "Engineering", 18, 2, 6, 8, 3, 1, 0, 0, "Today"],
    ["Aisha Qureshi", "aisha.qureshi@northwindlabs.com", "Engineering", 15, 1, 3, 12, 0, 0, 0, 0, "Today"],
    ["Karan Sethi", "karan.sethi@northwindlabs.com", "Engineering", 12, 0, 1, 6, 4, 1, 0, 0, "Yesterday"],
    ["Rohan Mehta", "rohan.mehta@northwindlabs.com", "Finance", 11, 1, 4, 5, 0, 2, 0, 0, "2 days ago"],
    ["Neha Kapoor", "neha.kapoor@northwindlabs.com", "Design", 9, 0, 0, 9, 0, 0, 0, 0, "Today"],
    ["Isha Desai", "isha.desai@northwindlabs.com", "Sales", 8, 0, 0, 6, 0, 0, 1, 1, "Yesterday"],
    ["Vikram Rao", "vikram.rao@northwindlabs.com", "Sales", 7, 0, 0, 4, 0, 0, 2, 1, "Today"],
    ["Daniel Fernandez", "daniel.fernandez@northwindlabs.com", "Engineering", 6, 1, 2, 3, 0, 0, 0, 1, "Today"],
  ];
  if (type === "devices") {
    return {
      name: "Device compliance",
      columns: ["Device", "Employee", "Email", "State", "Settings turned off", "Security score", "OS", "Agent version", "Status", "Last check-in", "Enrolled"],
      rows: DEVICE_ROWS.map((d) => {
        const name = `${d.employee.first_name} ${d.employee.last_name}`;
        const failed = d.id === "dev-daniel" || d.id === "dev-karan"
          ? "OS updates off"
          : d.id === "dev-siddharth"
            ? "Firewall, OS updates off"
            : d.id === "dev-isha"
              ? "Disk encryption off"
              : "";
        const state = d.status === "offline" ? "Not checking in" : failed ? "Needs a fix" : "Healthy";
        return [d.hostname, name, d.employee.email, state, failed, d.posture_score, `${d.os_type} ${d.os_version}`, d.agent_version, d.status, d.status === "offline" ? "9 days ago" : "just now", "12 Aug 2025"];
      }),
      summary: [
        { label: "Devices", value: 24, hint: "" },
        { label: "Security setting turned off", value: 4, hint: "firewall, encryption, updates, screen lock or antivirus" },
        { label: "Not checking in (7+ days)", value: 1, hint: "" },
        { label: "Employees without a device", value: 0, hint: "" },
      ],
      charts: [],
    };
  }
  if (type === "employee-risk") {
    return {
      name: "Employee risk",
      columns: ["Employee", "Email", "Department", "Incidents", "High-severity data", "Data protection", "Web", "Apps", "VPN", "Threats", "Device health", "Last incident"],
      rows: topUsers,
      summary: [{ label: "Employees with incidents", value: 8, hint: "of 24 employees" }],
      charts: [{ type: "bars", title: "Employees with the most incidents", data: topUsers.slice(0, 6).map((r) => ({ label: r[0], count: r[3] })) }],
    };
  }
  return {
    name: "Executive summary",
    columns: ["Area", "Measure", "This period", "Previous period", "Change"],
    rows: [
      ["Protection", "Devices online", "23 of 24", "22 of 24", "+4%"],
      ["Protection", "Employee coverage", "24 of 24", "24 of 24", "0%"],
      ["Incidents", "All incidents", 392, 385, "+1.8%"],
      ["Incidents", "Data protection", 28, 24, "+16%"],
      ["Incidents", "Web filtering", 310, 308, "+0.6%"],
      ["Incidents", "Application control", 16, 18, "−11%"],
      ["Incidents", "VPN bypass", 10, 12, "−17%"],
      ["Incidents", "Malicious downloads", 24, 19, "+26%"],
      ["Devices", "Posture alerts", 4, 4, "0%"],
    ],
    summary: [
      { label: "Incidents", value: 392, hint: "+1.8% vs previous period" },
      { label: "Devices protected", value: "23 of 24 online", hint: "" },
      { label: "Employee coverage", value: "100%", hint: "" },
      { label: "Needs attention", value: 4, hint: "open items" },
    ],
    charts: [
      { type: "trend", title: "Incidents over time, by control", data: trend },
      { type: "bars", title: "Employees with the most incidents", data: topUsers.slice(0, 6).map((r) => ({ label: r[0], count: r[3] })) },
    ],
    period: { tz: "Asia/Kolkata" },
  };
}

function overview() {
  const trend = [6, 5, 4, 3, 2, 1, 0].map((d, i) => ({
    t: ymdOffset(d),
    dlp: [3, 4, 5, 4, 4, 4, 4][i],
    web: [38, 42, 46, 44, 48, 46, 46][i],
    apps: [2, 2, 3, 2, 3, 2, 2][i],
    vpn: [1, 2, 1, 2, 1, 2, 1][i],
    threats: [3, 4, 3, 4, 3, 4, 3][i],
    devices: [1, 0, 1, 1, 0, 1, 0][i],
  }));

  return {
    period: { bucket: "day" },
    health: {
      devices: 24,
      online: 23,
      stale: 0,
      posture_issues: 4,
      employees: 24,
      employees_without_agent: 0,
      pending_requests: 2,
      policies: 2,
      policies_enabled: 2,
      settings_issues: [
        { device: "NW-DANIEL-LT08", employee: "Daniel Fernandez", summary: "OS updates is off on Daniel Fernandez's laptop", fix: ["Windows Update", "Install updates"] },
      ],
    },
    attention: [
      { severity: "high", title: "OS updates is off on Daniel Fernandez's laptop", detail: "NW-DANIEL-LT08. To fix: OS settings → Windows Update, then install updates.", href: "/dashboard/reports?report=devices" },
      { severity: "high", title: "OS updates is off on Karan Sethi's laptop", detail: "NW-KARAN-LT12. To fix: OS settings → Windows Update, then install updates.", href: "/dashboard/reports?report=devices" },
      { severity: "high", title: "Firewall and OS updates are off on Siddharth Pillai's laptop", detail: "NW-SIDDHARTH-LT17. To fix: Firewall → Windows security → Firewall & network…", href: "/dashboard/reports?report=devices" },
      { severity: "medium", title: "1 more laptop has a security setting turned off", detail: "See the Device compliance report for the full list.", href: "/dashboard/reports?report=devices" },
    ],
    controls: [
      { id: "dlp", count: 28, blocked: 0, alerted: 28 },
      { id: "web", count: 310, blocked: 310, alerted: 0 },
      { id: "apps", count: 16, blocked: 16, alerted: 0 },
      { id: "vpn", count: 10, blocked: 10, alerted: 0 },
      { id: "threats", count: 24, blocked: 24, alerted: 0 },
      { id: "devices", count: 4, blocked: 0, alerted: 4 },
    ],
    totals: { incidents: 392, prev: 385, delta: 1.8, affected_employees: 24 },
    trend,
    top_apps: [
      { name: "uTorrent", control: "apps", count: 7, employees: 3 },
      { name: "NordVPN", control: "vpn", count: 6, employees: 2 },
      { name: "AnyDesk", control: "apps", count: 5, employees: 2 },
      { name: "Tor Browser", control: "apps", count: 4, employees: 1 },
    ],
    top_sites: [
      { domain: "instagram.com", category: "Social Media", count: 84 },
      { domain: "perplexity.ai", category: "AI Tools", count: 61 },
      { domain: "x.com", category: "Social Media", count: 48 },
      { domain: "facebook.com", category: "Social Media", count: 37 },
      { domain: "dream11.com", category: "Gambling", count: 22 },
      { domain: "bet365.com", category: "Gambling", count: 18 },
    ],
    dlp_services: [
      { service: "Gmail", count: 11, high: 4 },
      { service: "Microsoft Teams", count: 6, high: 2 },
      { service: "Google Drive", count: 4, high: 1 },
      { service: "WhatsApp", count: 3, high: 0 },
      { service: "ChatGPT", count: 3, high: 1 },
      { service: "Outlook", count: 1, high: 0 },
    ],
    dlp_types: [
      { label: "Identity numbers", count: 9 },
      { label: "Credentials", count: 6 },
      { label: "Source code", count: 5 },
      { label: "Salary data", count: 4 },
      { label: "Bank details", count: 4 },
    ],
    top_users: [
      { employee_id: "emp-farhan", name: "Farhan Ali", email: EMP.farhan.email, incidents: 18, dlp: 6, web: 8, apps: 3, vpn: 1, threats: 0, devices: 0, high_dlp: 2 },
      { employee_id: "emp-aisha", name: "Aisha Qureshi", email: EMP.aisha.email, incidents: 15, dlp: 3, web: 12, apps: 0, vpn: 0, threats: 0, devices: 0, high_dlp: 1 },
      { employee_id: "emp-karan", name: "Karan Sethi", email: EMP.karan.email, incidents: 12, dlp: 1, web: 6, apps: 4, vpn: 1, threats: 0, devices: 0, high_dlp: 0 },
      { employee_id: "emp-rohan", name: "Rohan Mehta", email: EMP.rohan.email, incidents: 11, dlp: 4, web: 5, apps: 0, vpn: 2, threats: 0, devices: 0, high_dlp: 1 },
      { employee_id: "emp-neha", name: "Neha Kapoor", email: EMP.neha.email, incidents: 9, dlp: 0, web: 9, apps: 0, vpn: 0, threats: 0, devices: 0, high_dlp: 0 },
    ],
  };
}

function filterActivity(params: Record<string, any>) {
  const source = params.source ?? "";
  const action = String(params.action ?? "");
  const search = String(params.search ?? "").toLowerCase();
  const wanted = action.split(",").filter(Boolean);

  return ALL_ACTIVITY.filter((ev) => {
    if (source === "dlp" && ev.category !== "dlp") return false;
    if (source === "web_gateway" && ev.event_type !== "web_request") return false;
    if (source === "application" && ev.category !== "application_control") return false;
    if (source === "malware" && ev.category !== "malware_detection") return false;
    if (source === "device_posture" && ev.category !== "device_posture") return false;
    if (wanted.length && !wanted.includes(ev.action)) return false;
    if (search) {
      const hay = `${ev.target ?? ""} ${ev.target_domain ?? ""} ${ev.policy_name ?? ""} ${ev.employee.first_name} ${ev.employee.last_name}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/** Axios-shaped payload for a demo request, or undefined to fall through. */
export function resolveDemo(config: { method?: string; url?: string; params?: any; data?: any }): unknown {
  const method = (config.method || "get").toLowerCase();
  const path = pathOf(config.url);
  const params = config.params ?? {};
  const body = config.data ?? {};

  if (path.includes("/reports/overview")) return overview();
  if (path.includes("/reports/catalog")) return { reports: REPORT_CATALOG };
  if (path.match(/\/reports\/[a-z-]+$/)) {
    const type = path.split("/").pop() || "executive";
    return reportFor(type);
  }

  if (path.includes("/devices/activity")) return { data: DEVICE_ACTIVITY };
  if ((path.endsWith("/activity") || path.includes("/activity?")) && !path.includes("/devices/") && method === "get") {
    const rows = filterActivity(params);
    return pageOf(rows, params.page, params.limit);
  }

  if (path.includes("/applications/installed")) {
    let rows = INSTALLED;
    if (params.category) rows = rows.filter((a) => a.category === params.category);
    if (params.search) {
      const q = String(params.search).toLowerCase();
      rows = rows.filter((a) => `${a.name} ${a.vendor} ${a.employee_name}`.toLowerCase().includes(q));
    }
    return { ...pageOf(rows, params.page, params.limit), categories: [...new Set(INSTALLED.map((a) => a.category))] };
  }

  if (path.includes("/monitoring/employees")) {
    return { employees: EMPLOYEES.filter((e) => e.status === "active").slice(0, 12) };
  }
  if (path.includes("/monitoring/screenshots")) return monitoringDay();
  if (path.includes("/monitoring/settings")) {
    return {
      settings: {
        enabled: true,
        min_interval_seconds: 300,
        max_interval_seconds: 600,
        idle_threshold_percent: 20,
        blur: true,
        retention_days: 30,
      },
      storage: "local",
    };
  }

  if (path.includes("/employees/departments")) return { data: DEPARTMENTS };
  if (path.includes("/employees")) {
    let rows = EMPLOYEES;
    if (params.status) rows = rows.filter((e) => e.status === params.status);
    if (params.department) rows = rows.filter((e) => e.department === params.department);
    if (params.team_id) rows = rows.filter((e) => e.team_id === params.team_id);
    if (params.search) {
      const q = String(params.search).toLowerCase();
      rows = rows.filter((e) => `${e.first_name} ${e.last_name} ${e.email} ${e.job_title}`.toLowerCase().includes(q));
    }
    return pageOf(rows, params.page, params.limit ?? 10);
  }

  if (path.includes("/teams") && path.includes("/members")) {
    const teamId = path.split("/teams/")[1]?.split("/")[0];
    return { data: EMPLOYEES.filter((e) => e.team_id === teamId) };
  }
  if (path.includes("/teams")) return { data: TEAMS, total: TEAMS.length };

  if (path.includes("/policies")) {
    let rows = POLICIES;
    if (params.type) {
      const wanted = String(params.type).split(",");
      rows = rows.filter((p) => wanted.includes(p.type));
    }
    if (params.search) {
      const q = String(params.search).toLowerCase();
      rows = rows.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q));
    }
    return pageOf(rows, params.page, params.limit ?? 10);
  }

  if (path.includes("/swg/stats")) return { total_blocked: 6930 };
  if (path.includes("/swg/check")) {
    const url = String(body.url ?? "").toLowerCase();
    const blocked = /instagram|facebook|x\.com|twitter|perplexity|bet365|dream11|tiktok/.test(url);
    return blocked
      ? { blocked: true, reason: "Blocked by category policy: Block distracting and risky sites", category: "social_media" }
      : { blocked: false, reason: "Allowed by current policy" };
  }

  if (path.includes("/categories")) return { data: CATEGORIES, total: CATEGORIES.length };
  if (path.includes("/announcements")) return { announcements: [] };
  if (path.includes("/tickets/unread")) return { unread: 0 };

  if (path.includes("/access-requests")) {
    const counts = {
      pending: ACCESS_REQUESTS.filter((r) => r.status === "pending").length,
      approved: ACCESS_REQUESTS.filter((r) => r.status === "approved").length,
      denied: ACCESS_REQUESTS.filter((r) => r.status === "denied").length,
      revoked: ACCESS_REQUESTS.filter((r) => r.status === "revoked").length,
    };
    let rows = ACCESS_REQUESTS;
    if (params.status) rows = rows.filter((r) => r.status === params.status);
    if (params.kind) rows = rows.filter((r) => r.kind === params.kind);
    if (params.search) {
      const q = String(params.search).toLowerCase();
      rows = rows.filter((r) => `${r.label} ${r.domain} ${r.reason} ${r.employee.first_name} ${r.employee.last_name}`.toLowerCase().includes(q));
    }
    return { ...pageOf(rows, params.page, params.limit ?? 25), counts };
  }

  if (path.includes("/devices")) return { data: DEVICE_ROWS, total: DEVICE_ROWS.length };

  if (path.includes("/organization/timezones")) {
    return { timezones: ["Asia/Kolkata", "UTC", "America/New_York", "Europe/London", "Asia/Singapore"] };
  }
  if (path.includes("/organization/block-page")) {
    return { message: "This site is blocked by Northwind Labs policy.", contact: "it@northwindlabs.com" };
  }
  if (path.includes("/organization")) {
    return {
      name: "Northwind Labs",
      timezone: "Asia/Kolkata",
      notification_prefs: {
        high_risk_dlp: true,
        incident_digest: true,
        digest_threshold: 10,
        access_requests: true,
        device_offline: true,
        posture_alerts: true,
      },
    };
  }

  if (path.includes("/settings/mfa") || path.includes("/auth/mfa/status")) {
    return { required: true, enabled: true, method: "totp" };
  }
  if (path.includes("/settings/mitm")) {
    return { enabled: true, bypass_domains: ["meet.google.com", "zoom.us"] };
  }
  if (path.includes("/enforcement/schedule")) {
    return {
      schedule: {
        timezone: "Asia/Kolkata",
        windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: "10:00", end: "19:00" })),
        holidays: [],
        off_hours_mode: "full_pause",
        enabled: true,
      },
      state: { enforcing: true, reason: "Inside working hours" },
      org_timezone: "Asia/Kolkata",
    };
  }
  if (path.includes("/settings/data-residency")) {
    return { enabled: false, database: null, files: null };
  }
  if (path.includes("/ai/sessions")) return { data: [] };

  if (method === "get") return { data: [], total: 0 };
  return { ok: true };
}

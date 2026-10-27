// Real screenshots of the Aavishield console, captured with Playwright from a
// running build against a demo organisation ("Northwind Labs"). Every name,
// device and event in them is fictional demo data.

// `sidebar`: the screen has the console's left sidebar, which still carries
// the old logo and is cropped off when shown (see SIDEBAR_PX).
export type Shot = { src: string; alt: string; w: number; h: number; url: string; sidebar: boolean };

/** Source pixels from the left edge to just past the sidebar and its collapse button. */
export const SIDEBAR_PX = 512;

/** Share of the screenshot's width to crop off the left. */
export const sidebarShare = (shot: Shot) => (shot.sidebar ? SIDEBAR_PX / shot.w : 0);

const s = (file: string, alt: string, url: string, w = 2880, h = 1800, sidebar = true): Shot => ({ src: `/images/product/${file}`, alt, w, h, url, sidebar });

export const shots = {
  overview: s("overview-latest.jpg", "Aavishield security overview: devices online, employee coverage, incidents by control and items needing attention", "aavishield-app.aavishailab.com / dashboard"),
  overviewScroll: s("overview-scroll.jpg", "Incidents over time chart and the needs-attention list in the Aavishield dashboard", "aavishield-app.aavishailab.com / dashboard"),
  overviewDark: s("overview-dark.jpg", "The Aavishield security overview in dark mode", "aavishield-app.aavishailab.com / dashboard"),
  dlp: s("dlp-latest.jpg", "Data loss prevention incidents: employee, destination such as Gmail or ChatGPT, detectors found and risk score", "aavishield-app.aavishailab.com / dlp"),
  dlpDark: s("dlp-dark.jpg", "Data loss prevention incidents in dark mode", "aavishield-app.aavishailab.com / dlp"),
  webGateway: s("web-gateway.jpg", "Web gateway policies and blocked request counts in the Aavishield console", "aavishield-app.aavishailab.com / web-gateway"),
  webGatewayDark: s("web-gateway-dark.jpg", "Web gateway policies in dark mode", "aavishield-app.aavishailab.com / web-gateway"),
  urlChecker: s("url-checker-latest.jpg", "URL checker showing instagram.com blocked by the company category policy", "aavishield-app.aavishailab.com / web-gateway"),
  applications: s("applications-latest.jpg", "Application control: installed applications per employee with network and app block switches", "aavishield-app.aavishailab.com / applications"),
  categories: s("categories.jpg", "Policy categories such as AI tools, gambling and cloud storage with domain counts and risk", "aavishield-app.aavishailab.com / categories"),
  activity: s("activity-latest.jpg", "Security activity feed of blocked and alerted events across web, DLP, apps and downloads", "aavishield-app.aavishailab.com / activity"),
  activityDark: s("activity-dark.jpg", "Security activity feed in dark mode", "aavishield-app.aavishailab.com / activity"),
  activityDlp: s("activity-dlp.jpg", "Activity feed filtered to data loss prevention events", "aavishield-app.aavishailab.com / activity"),
  activityDownloads: s("activity-downloads.jpg", "Activity feed of malicious downloads blocked, with signature names and risk scores", "aavishield-app.aavishailab.com / activity"),
  activityPosture: s("activity-posture.jpg", "Activity feed of device posture alerts such as firewall off and OS updates pending", "aavishield-app.aavishailab.com / activity"),
  reports: s("reports.jpg", "Executive summary report with incidents over time and the employees with the most incidents", "aavishield-app.aavishailab.com / reports"),
  reportsDark: s("reports-dark.jpg", "Executive summary report in dark mode", "aavishield-app.aavishailab.com / reports"),
  reportsCompliance: s("reports-compliance.jpg", "Device compliance report listing each device, its owner and settings that are turned off", "aavishield-app.aavishailab.com / reports"),
  reportsRisk: s("reports-risk.jpg", "Employee risk report ranking employees by incidents", "aavishield-app.aavishailab.com / reports"),
  employees: s("employees.jpg", "Employee directory with department, title, status and import or export to CSV", "aavishield-app.aavishailab.com / employees"),
  teams: s("teams.jpg", "Teams list with member counts used to scope policies", "aavishield-app.aavishailab.com / teams"),
  screenshots: s("screenshots.jpg", "Activity monitoring: tracked and active time, activity timeline and periodic screenshots for one employee", "aavishield-app.aavishailab.com / screenshots"),
  screenshotsDark: s("screenshots-dark.jpg", "Activity monitoring timeline in dark mode", "aavishield-app.aavishailab.com / screenshots"),
  accessRequests: s("access-requests.jpg", "Access requests from employees asking to unblock a domain, with their reason", "aavishield-app.aavishailab.com / access-requests"),
  settings: s("settings.jpg", "Organisation settings: password, two-factor, notifications, working hours and monitoring", "aavishield-app.aavishailab.com / settings"),
  ai: s("ai-assistant.jpg", "The Aavishield assistant answering questions about devices, alerts and reports from live data", "aavishield-app.aavishailab.com / dashboard"),
  devices: s("devices.jpg", "Device inventory with operating system, agent version, status, enforcement and posture score", "aavishield-app.aavishailab.com / devices"),
  login: s("login.jpg", "Aavishield company admin sign-in page", "aavishield-app.aavishailab.com / login", 2880, 1800, false),
  portalLogin: s("portal-login.jpg", "Aavishield employee portal sign-in page", "aavishield-employee.aavishailab.com / login", 2880, 1800, false),
  portalDownload: s("portal-download.jpg", "Employee portal download page with one-click installers for macOS, Windows and Linux", "aavishield-employee.aavishailab.com / download"),
} satisfies Record<string, Shot>;

export type ShotKey = keyof typeof shots;

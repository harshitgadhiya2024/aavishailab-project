import { formatDateTime } from "@/lib/utils";

/*
 * Application Control, app-first: the inventory API returns one row per app
 * per device. Admins think in apps ("block AnyDesk"), so these helpers fold
 * those rows into one entry per application, across every device, and work
 * out who an app is blocked for from the org's control rules.
 */

export const CATEGORY_LABELS: Record<string, string> = {
  ai_tools: "AI tools",
  file_sharing: "File sharing",
  messaging: "Messaging",
  remote_access: "Remote access",
  anonymizer: "Anonymizer",
  p2p: "Peer-to-peer",
  vpn: "VPN",
  development: "Development",
  browser: "Browser",
  other: "Other",
};

export const categoryLabel = (c?: string) => (c ? CATEGORY_LABELS[c] ?? c.replace(/_/g, " ") : "Other");

export type InstalledApp = {
  id: string;
  application_id?: string | null;
  employee_id?: string | null;
  device_id?: string;
  identifier?: string;
  name: string;
  version?: string;
  vendor?: string;
  install_path?: string;
  source?: string;
  category?: string;
  risk_level?: number;
  installed_at?: string | null;
  first_seen_at?: string;
  removed?: boolean;
  employee_name?: string;
  device_name?: string;
  block_network: boolean;
  block_process: boolean;
  rule_id?: string;
};

export type Targets = { scope?: "all" | "team" | "employee"; team_ids?: string[]; employee_ids?: string[] };

export type AppRule = {
  id: string;
  application_id: string;
  employee_id?: string | null;
  enabled: boolean;
  action: string;
  block_network: boolean;
  block_process: boolean;
  targets?: Targets;
  application?: { id: string; name: string; vendor?: string; category?: string; risk_level?: number; domains?: string[] };
};

export type CatalogApp = {
  id: string;
  name: string;
  vendor?: string;
  category?: string;
  risk_level?: number;
  domains?: string[];
  description?: string;
  rule?: AppRule;
};

export type AppGroup = {
  key: string;
  name: string;
  vendor: string;
  category: string;
  risk: number;
  /** Catalog application the rules hang on, when any install is linked. */
  appId?: string;
  /** One installed row per device (removed ones excluded). */
  installs: InstalledApp[];
  people: Map<string, string>;
  devices: number;
  firstSeen?: string;
  isNew: boolean;
  system: boolean;
  /** The company- or team-wide rule for this app, if any. */
  orgRule?: AppRule;
  /** One-person rules, by employee id. */
  personRules: Map<string, AppRule>;
};

export function riskBadge(level: number) {
  if (level >= 85) return { label: "Critical", className: "bg-red-500/10 text-danger" };
  if (level >= 65) return { label: "High", className: "bg-orange-500/10 text-warning" };
  if (level >= 40) return { label: "Medium", className: "bg-yellow-500/10 text-warning" };
  return { label: "Low", className: "bg-green-500/10 text-success" };
}

export const isHighRisk = (risk: number) => risk >= 65;

/** Most platforms record no install date; "first seen" is the honest fallback. */
export function installedLabel(app: InstalledApp) {
  if (app.installed_at) return { text: formatDateTime(app.installed_at), exact: true };
  if (app.first_seen_at) return { text: formatDateTime(app.first_seen_at), exact: false };
  return { text: "—", exact: true };
}

/** "Folder Colorizer 2 version 4.1.6" and "Folder Colorizer 2" are one app. */
export function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\s*\((x64|x86|64-bit|32-bit|user|machine)\)\s*/g, " ")
    .replace(/\s+(version\s+)?v?\d+(\.\d+)+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SYSTEM_VENDORS = /^(microsoft( corporation)?|apple( inc\.?)?|canonical( ltd\.?)?|google llc|intel( corporation)?|nvidia( corporation)?|realtek.*|advanced micro devices.*|amd)$/i;

/**
 * Built-in operating-system and driver software (Photos, GameInput, graphics
 * drivers): low risk, uncategorised, from the OS or hardware vendor. Hidden by
 * default because nobody decides to block them, and they bury the apps people
 * actually chose to install. Anything with a real category (Teams, Edge,
 * VS Code) is never treated as system software.
 */
export function looksLikeSystemApp(name: string, vendor: string, category: string, risk: number) {
  if (risk >= 40) return false;
  if (category && category !== "other") return false;
  if (SYSTEM_VENDORS.test(vendor.trim())) return true;
  return /^(microsoft (visual c\+\+|\.net|edge webview|update health)|windows (sdk|driver|software development)|intel\(r\)|nvidia (graphics|physx|hd audio))/i.test(name);
}

const WEEK = 7 * 24 * 3600 * 1000;

export function groupInstalls(rows: InstalledApp[], rules: AppRule[]): AppGroup[] {
  const groups = new Map<string, AppGroup>();
  for (const r of rows) {
    if (r.removed) continue;
    const key = `${normalizeName(r.name)}|${(r.vendor || "").toLowerCase().trim()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, name: r.name.replace(/\s+version\s+[\d.]+$/i, ""), vendor: r.vendor || "", category: r.category || "other",
        risk: r.risk_level ?? 0, installs: [], people: new Map(), devices: 0, isNew: false, system: false,
        personRules: new Map(),
      };
      groups.set(key, g);
    }
    g.installs.push(r);
    if (r.application_id && !g.appId) g.appId = r.application_id;
    if (r.employee_id) g.people.set(r.employee_id, r.employee_name || "Unknown");
    if ((r.risk_level ?? 0) > g.risk) g.risk = r.risk_level ?? 0;
    if (r.category && r.category !== "other") g.category = r.category;
    const seen = r.installed_at || r.first_seen_at;
    if (seen && (!g.firstSeen || seen < g.firstSeen)) g.firstSeen = seen;
  }

  const byAppId = new Map<string, AppGroup>();
  const byName = new Map<string, AppGroup>();
  for (const g of groups.values()) {
    g.devices = new Set(g.installs.map(i => i.device_id || i.id)).size;
    g.isNew = !!g.firstSeen && Date.now() - new Date(g.firstSeen).getTime() < WEEK;
    g.system = looksLikeSystemApp(g.name, g.vendor, g.category, g.risk);
    if (g.appId) byAppId.set(g.appId, g);
    byName.set(normalizeName(g.name), g);
  }

  for (const rule of rules) {
    if (!rule.enabled || (!rule.block_network && !rule.block_process)) continue;
    const g = byAppId.get(rule.application_id) ?? (rule.application ? byName.get(normalizeName(rule.application.name)) : undefined);
    if (!g) continue;
    if (!g.appId) g.appId = rule.application_id;
    if (rule.employee_id) g.personRules.set(rule.employee_id, rule);
    else g.orgRule = rule;
  }

  return [...groups.values()].sort((a, b) => b.risk - a.risk || b.people.size - a.people.size || a.name.localeCompare(b.name));
}

export type BlockStatus = { blocked: boolean; label: string; who: string; how: string };

export function blockStatus(g: Pick<AppGroup, "orgRule" | "personRules">, teamNames: Map<string, string>): BlockStatus {
  const parts: string[] = [];
  const how = new Set<string>();
  const r = g.orgRule;
  if (r) {
    const scope = r.targets?.scope ?? "all";
    if (scope === "team") {
      const names = (r.targets?.team_ids ?? []).map(id => teamNames.get(id) ?? "a team");
      parts.push(names.length <= 2 ? names.join(", ") : `${names.length} teams`);
    } else if (scope === "employee") {
      const n = r.targets?.employee_ids?.length ?? 0;
      parts.push(`${n} ${n === 1 ? "person" : "people"}`);
    } else {
      parts.push("everyone");
    }
    if (r.block_network) how.add("internet cut");
    if (r.block_process) how.add("closed on open");
  }
  if (g.personRules.size) {
    const n = g.personRules.size;
    parts.push(`${n} ${n === 1 ? "person" : "people"}`);
    for (const pr of g.personRules.values()) {
      if (pr.block_network) how.add("internet cut");
      if (pr.block_process) how.add("closed on open");
    }
  }
  if (!parts.length) return { blocked: false, label: "Allowed", who: "", how: "" };
  const who = `for ${parts.join(" + ")}`;
  return { blocked: true, label: `Blocked ${who}`, who, how: [...how].join(", ") };
}

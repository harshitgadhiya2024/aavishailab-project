/*
 * "Needs attention", grouped and ranked for the dashboard.
 *
 * The API lists one item per laptop with a setting off (plus "N more
 * laptops…"); here those become a single item with a count per setting. Every
 * item gets the button that fixes it, and the list is ordered worst first.
 */

export type ApiAttention = { severity: "high" | "medium"; title: string; detail: string; href: string };

export type AttentionItem = {
  key: string;
  severity: "high" | "medium";
  title: string;
  detail?: string;
  chips?: { label: string; count: number }[];
  href: string;
  cta: string;
  primary?: boolean;
  /** Short phrase for the headline sentence ("96 high-severity data leaks"). */
  phrase: string;
};

type SettingIssue = { off?: string[] };
type DlpService = { service: string; count: number; high: number };

const LAPTOP_ITEM = /\b(is|are) off on\b|more laptops? ha(s|ve) a security setting/i;

// Lower is shown first among items of the same severity.
const ORDER: Record<string, number> = {
  "/dashboard/swg": 0, "/dashboard/dlp": 1, "/dashboard/activity": 2, "laptops": 3,
  "/dashboard/access-requests": 4, "/dashboard/devices": 5, "/dashboard/employees": 6,
};

const CTA: Record<string, string> = {
  "/dashboard/swg": "Set up a policy",
  "/dashboard/dlp": "Review leaks",
  "/dashboard/activity": "Review activity",
  "/dashboard/access-requests": "Review requests",
  "/dashboard/devices": "View devices",
  "/dashboard/employees": "Send enrollment links",
};

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function groupAttention(
  items: ApiAttention[],
  laptopsWithIssues: number,
  settingIssues: SettingIssue[] = [],
  dlpServices: DlpService[] = [],
): AttentionItem[] {
  const out: AttentionItem[] = [];
  let laptops = false;

  for (const a of items) {
    if (LAPTOP_ITEM.test(a.title)) {
      laptops = true;
      continue;
    }
    const base = a.href.split("?")[0];
    const item: AttentionItem = {
      key: `${a.href}:${a.title}`, severity: a.severity, title: a.title, detail: a.detail, href: a.href,
      cta: CTA[base] ?? "Open", phrase: lowerFirst(a.title.replace(/ flagged$/, "")),
    };
    if (base === "/dashboard/swg") {
      item.primary = true;
    }
    if (base === "/dashboard/dlp") {
      // Say where the worst of it went.
      const worst = [...dlpServices].sort((x, y) => y.high - x.high)[0];
      if (worst?.high) item.detail = `${worst.high.toLocaleString()} went to ${worst.service}. Sensitive data left through a monitored channel.`;
    }
    if (/malware|threat/i.test(a.title)) item.cta = "Review threats";
    out.push(item);
  }

  if (laptops || laptopsWithIssues > 0) {
    const counts = new Map<string, number>();
    for (const s of settingIssues) for (const off of s.off ?? []) counts.set(off, (counts.get(off) ?? 0) + 1);
    const n = Math.max(laptopsWithIssues, settingIssues.length);
    out.push({
      key: "laptops", severity: "high", href: "/dashboard/reports?report=devices",
      title: `${n} ${n === 1 ? "laptop has" : "laptops have"} security settings off`,
      chips: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
      cta: "See laptops and fixes",
      phrase: `${n} ${n === 1 ? "laptop" : "laptops"} with security settings off`,
    });
  }

  const rank = (i: AttentionItem) => (i.severity === "high" ? 0 : 100) + (ORDER[i.key === "laptops" ? "laptops" : i.href.split("?")[0]] ?? 50);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** "a, b and c" */
export function joinPhrases(p: string[]) {
  if (p.length <= 1) return p[0] ?? "";
  return `${p.slice(0, -1).join(", ")} and ${p[p.length - 1]}`;
}

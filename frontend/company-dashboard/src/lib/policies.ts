export type PolicyCondition = {
  type: string;
  operator: string;
  value: string;
};

export type DLPCustomPattern = {
  name: string;
  regex: string;
};

export type DLPFormData = {
  detectors: string[];
  keywords: string; // one per line in the textarea; split into an array on submit
  customPatterns: DLPCustomPattern[];
  bypassFileTypes: string[];
  // Decision bands: a scanned upload scoring >= blockThreshold is blocked,
  // >= alertThreshold is alerted (but allowed through), below that is allowed.
  blockThreshold: number;
  alertThreshold: number;
  // Optional per-detector weight overrides (detector value -> 0..100). Empty
  // means "use the service defaults" (DLP_DEFAULT_WEIGHTS).
  detectorWeights: Record<string, number>;
  // When content can't be fully inspected (a password-protected zip/Office
  // file, a scan that timed out, the extraction service being unreachable),
  // this decides what happens instead of silently allowing it through.
  // Unset (false) preserves today's behavior for every reason — allow, with
  // nothing more than a debug log; admin-api's resolveUnscannableAction
  // defaults each reason to "allow" when this is omitted from Rules
  // entirely, so leaving this off changes nothing about existing policies.
  blockUnscannable: boolean;
};

// Default per-detector weights — mirrors dlp-service DEFAULT_WEIGHTS so the
// sliders start at the same place the backend would use.
export const DLP_DEFAULT_WEIGHTS: Record<string, number> = {
  aws_key: 85,
  github_token: 80,
  generic_api_key: 70,
  credit_card: 55,
  aadhaar: 55,
  pan_india: 45,
  source_code: 40,
};

export const DLP_DETECTORS: { value: string; label: string }[] = [
  { value: "credit_card", label: "Credit Card Number" },
  { value: "pan_india", label: "PAN Card (India)" },
  { value: "aadhaar", label: "Aadhaar Number (India)" },
  { value: "aws_key", label: "AWS Access Key" },
  { value: "github_token", label: "GitHub Token" },
  { value: "generic_api_key", label: "Generic API Key / Secret" },
  { value: "source_code", label: "Source Code Files" },
  {
    value: "ai_visual",
    label: "AI Image Classification (photos/screenshots of ID cards, credentials, etc.)",
  },
];

export const DLP_BYPASS_FILE_TYPES: { value: string; label: string }[] = [
  { value: "image", label: "Images" },
  { value: "pdf", label: "PDFs" },
];

// The reasons on_unscannable's "block" setting applies to, in one bundle —
// see DLPFormData.blockUnscannable. Kept in sync with admin-api's
// resolveUnscannableAction reason strings.
export const DLP_UNSCANNABLE_REASONS = [
  "encrypted_archive",
  "encrypted_document",
  "unsupported_archive",
] as const;

export const EMPTY_DLP_FORM: DLPFormData = {
  detectors: ["credit_card", "pan_india", "aadhaar"],
  keywords: "",
  customPatterns: [],
  // Deep content inspection now unpacks images and PDFs (OCR + text-layer
  // extraction) instead of only ever seeing their raw bytes, so a brand
  // new policy no longer needs to exempt them by default. Existing
  // policies that already bypass image/pdf are left exactly as they were
  // — see the dashboard banner that flags them instead of silently
  // rewriting a live policy's enforcement.
  bypassFileTypes: [],
  blockThreshold: 80,
  alertThreshold: 50,
  detectorWeights: {},
  blockUnscannable: false,
};

// ─── Targeting (who a policy applies to) ───────────────────────────────────────

export type TargetScope = "all" | "team" | "employee";

export type TargetFormData = {
  scope: TargetScope;
  team_ids: string[];
  employee_ids: string[];
};

export const EMPTY_TARGET: TargetFormData = { scope: "all", team_ids: [], employee_ids: [] };

// ─── Website-blocking conditions (Domain tab vs Category tab) ─────────────────
// Domain tab: literal domain / URL pattern strings — both map to the same
// exact-match "domains" list server-side (no real path-pattern matching
// exists anywhere in this codebase yet; "URL pattern" is a label for the
// admin's own clarity today, not a different matching engine).
// Category tab: pick from the pre-built category list (Social Media,
// Gambling, AI Tools, ...) — resolves server-side to every domain in that
// category via the category_domains table.

export const DOMAIN_CONDITION_TYPES = [
  { value: "domain", label: "Domain" },
  { value: "url_pattern", label: "URL Pattern" },
];

export type PolicyFormData = {
  name: string;
  description: string;
  policy_type: string;
  priority: number;
  conditions: PolicyCondition[]; // generic builder, used by non-website policy types
  conditionTab: "domain" | "category"; // website-blocking types only
  domainConditions: PolicyCondition[]; // Domain tab rows
  categoryConditions: string[]; // Category tab rows (category slugs)
  actions: string[];
  dlp: DLPFormData;
  target: TargetFormData;
};

export const POLICY_TYPE_LABELS: Record<string, string> = {
  web_filter: "Web Filter",
  application_control: "App Control",
  time_restriction: "Time Restriction",
  dlp: "Data Loss Prevention",
  network: "Network / Domain",
};

/** Policy types that use the Domain/Category tabbed website-blocking builder. */
export const WEBSITE_BLOCKING_UI_TYPES = ["web_filter", "network"];

/** UI form values → API policy_type enum */
export const UI_TO_API_TYPE: Record<string, string> = {
  web_filter: "url_category",
  network: "domain",
  application_control: "application",
  time_restriction: "time_based",
  dlp: "dlp",
};

/** API policy_type enum → UI form values */
export const API_TO_UI_TYPE: Record<string, string> = {
  url_category: "web_filter",
  domain: "network",
  application: "application_control",
  time_based: "time_restriction",
  dlp: "dlp",
  usb: "application_control",
  process: "application_control",
};

export function formToApiPayload(form: PolicyFormData) {
  let rules: Record<string, unknown>;
  let apiType = UI_TO_API_TYPE[form.policy_type] || "domain";

  if (form.policy_type === "dlp") {
    const keywords = form.dlp.keywords
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
    const customPatterns = form.dlp.customPatterns.filter((p) => p.name.trim() && p.regex.trim());

    rules = {
      detectors: form.dlp.detectors,
      keywords,
      custom_patterns: customPatterns,
      bypass_file_types: form.dlp.bypassFileTypes,
      block_threshold: form.dlp.blockThreshold,
      alert_threshold: form.dlp.alertThreshold,
      detector_weights: form.dlp.detectorWeights,
    };
    if (form.dlp.blockUnscannable) {
      rules.on_unscannable = Object.fromEntries(DLP_UNSCANNABLE_REASONS.map((r) => [r, "block"]));
    }
  } else if (WEBSITE_BLOCKING_UI_TYPES.includes(form.policy_type)) {
    if (form.conditionTab === "category") {
      rules = { categories: form.categoryConditions.filter(Boolean) };
      apiType = "url_category";
    } else {
      const domains = form.domainConditions
        .filter((c) => c.value.trim())
        .map((c) => c.value.trim());
      rules = { domains };
      apiType = "domain";
    }
  } else {
    const domains: string[] = [];
    const categories: string[] = [];
    const conditions = form.conditions.filter((c) => c.value.trim());

    for (const c of conditions) {
      const value = c.value.trim();
      if (c.type === "domain") domains.push(value);
      if (c.type === "category") categories.push(value);
    }

    rules = { conditions: form.conditions };
    if (domains.length) rules.domains = domains;
    if (categories.length) rules.categories = categories;
  }

  const primaryAction = form.actions.includes("block")
    ? "block"
    : form.actions.includes("allow")
      ? "allow"
      : form.actions.includes("alert")
        ? "alert"
        : form.actions.includes("log")
          ? "log"
          : "block";

  return {
    name: form.name,
    description: form.description,
    type: apiType,
    action: primaryAction,
    priority: form.priority,
    enabled: true,
    rules,
    targets: form.target,
  };
}

export function apiToForm(policy: Record<string, unknown>): PolicyFormData {
  const rules = (policy.rules as Record<string, unknown>) || {};
  let conditions: PolicyCondition[] = [];

  if (Array.isArray(rules.conditions) && rules.conditions.length > 0) {
    conditions = rules.conditions as PolicyCondition[];
  } else {
    if (Array.isArray(rules.domains)) {
      conditions.push(
        ...(rules.domains as string[]).map((d) => ({
          type: "domain",
          operator: "matches",
          value: d,
        }))
      );
    }
    if (Array.isArray(rules.categories)) {
      conditions.push(
        ...(rules.categories as string[]).map((c) => ({
          type: "category",
          operator: "equals",
          value: c,
        }))
      );
    }
  }

  if (!conditions.length) {
    conditions = [{ type: "domain", operator: "matches", value: "" }];
  }

  const domainConditions: PolicyCondition[] = Array.isArray(rules.domains) && rules.domains.length
    ? (rules.domains as string[]).map((d) => ({ type: "domain", operator: "matches", value: d }))
    : [{ type: "domain", operator: "matches", value: "" }];
  const categoryConditions: string[] = Array.isArray(rules.categories)
    ? (rules.categories as string[])
    : [];
  const conditionTab: "domain" | "category" = categoryConditions.length > 0 ? "category" : "domain";

  const apiType = String(policy.type || "domain");
  const action = policy.action ? String(policy.action) : "block";

  const dlp: DLPFormData = {
    detectors: Array.isArray(rules.detectors) ? (rules.detectors as string[]) : EMPTY_DLP_FORM.detectors,
    keywords: Array.isArray(rules.keywords) ? (rules.keywords as string[]).join("\n") : "",
    customPatterns: Array.isArray(rules.custom_patterns)
      ? (rules.custom_patterns as Record<string, unknown>[]).map((p) => ({
          name: String(p.name || ""),
          regex: String(p.regex || ""),
        }))
      : [],
    bypassFileTypes: Array.isArray(rules.bypass_file_types)
      ? (rules.bypass_file_types as string[])
      : EMPTY_DLP_FORM.bypassFileTypes,
    blockThreshold: typeof rules.block_threshold === "number" ? (rules.block_threshold as number) : 80,
    alertThreshold: typeof rules.alert_threshold === "number" ? (rules.alert_threshold as number) : 50,
    detectorWeights:
      rules.detector_weights && typeof rules.detector_weights === "object"
        ? (rules.detector_weights as Record<string, number>)
        : {},
    blockUnscannable:
      typeof rules.on_unscannable === "object" && rules.on_unscannable !== null
        ? Object.values(rules.on_unscannable as Record<string, unknown>).some((v) => v === "block")
        : false,
  };

  const rawTargets = (policy.targets as Record<string, unknown>) || {};
  const target: TargetFormData = {
    scope: (rawTargets.scope as TargetScope) || "all",
    team_ids: Array.isArray(rawTargets.team_ids) ? (rawTargets.team_ids as string[]) : [],
    employee_ids: Array.isArray(rawTargets.employee_ids) ? (rawTargets.employee_ids as string[]) : [],
  };

  return {
    name: String(policy.name || ""),
    description: String(policy.description || ""),
    policy_type: API_TO_UI_TYPE[apiType] || "network",
    priority: Number(policy.priority ?? 50),
    conditions,
    conditionTab,
    domainConditions,
    categoryConditions,
    actions: [action],
    dlp,
    target,
  };
}

export function policyTypeLabel(policy: Record<string, unknown>) {
  const uiType = API_TO_UI_TYPE[String(policy.type)] || String(policy.type);
  return POLICY_TYPE_LABELS[uiType] ?? String(policy.type);
}

export function policyTargetLabel(policy: Record<string, unknown>): string {
  const targets = (policy.targets as Record<string, unknown>) || {};
  const scope = (targets.scope as string) || "all";
  if (scope === "team") {
    const n = Array.isArray(targets.team_ids) ? targets.team_ids.length : 0;
    return n === 1 ? "1 team" : `${n} teams`;
  }
  if (scope === "employee") {
    const n = Array.isArray(targets.employee_ids) ? targets.employee_ids.length : 0;
    return n === 1 ? "1 employee" : `${n} employees`;
  }
  return "Full organization";
}

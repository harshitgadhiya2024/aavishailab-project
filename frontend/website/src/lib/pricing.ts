/*
 * Plans are sized by device count. Essentials and Business cover up to 50
 * devices; more than 50 devices is Enterprise. Prices are quoted per device,
 * billed annually, so the page shows "Custom quote" rather than numbers.
 */
export const SMALL_PLAN_MAX = 50;

export const plans = [
  {
    name: "Essentials",
    for: "For small teams getting their first policy in place.",
    range: `1 to ${SMALL_PLAN_MAX} devices`,
    features: ["Web Gateway", "VPN Control", "Malware Scanning", "Device Posture", "Admin console"],
    max: SMALL_PLAN_MAX,
  },
  {
    name: "Business",
    for: "For companies that handle customer or financial data.",
    range: `1 to ${SMALL_PLAN_MAX} devices`,
    features: ["Everything in Essentials", "Data Loss Prevention", "Application Control", "AI classification of files", "Per-group policies"],
    max: SMALL_PLAN_MAX,
  },
  {
    name: "Enterprise",
    for: "For fleets of more than 50 devices, with audit and monitoring needs.",
    range: `${SMALL_PLAN_MAX + 1}+ devices`,
    features: ["Everything in Business", "Activity Monitoring", "Custom data retention", "Dedicated onboarding", "Priority support"],
    min: SMALL_PLAN_MAX + 1,
  },
] as const;

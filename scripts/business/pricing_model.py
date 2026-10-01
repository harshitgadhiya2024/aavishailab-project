#!/usr/bin/env python3
"""Aavishield unit-economics model: infra cost and pricing at six scales.

    python3 scripts/business/pricing_model.py            # prints markdown tables

Every number the pricing documents quote comes from here. Assumptions are
named constants at the top; change one and re-run to see the effect. All
money is USD per month unless a name says otherwise. Sources for unit prices
are listed in docs/business/pricing-strategy-en.md.
"""

from dataclasses import dataclass

SCALES = [100, 1_000, 10_000, 100_000, 500_000, 1_000_000]  # protected employees

# ─── Usage assumptions (per employee / per device) ───────────────────────────
DEVICES_PER_EMPLOYEE = 1.2       # laptop + an occasional second machine
WORKDAYS = 22                    # per month
ONLINE_PEAK = 0.60               # share of devices online at the busiest hour (one region)
ONLINE_PEAK_GLOBAL = 0.45        # once customers span time zones (100k+)

# Requests per online device per second.
RPS_CURRENT = 0.10 + 1 / 60 + 1 / 300 + 0.005 + 0.010    # rules every 10s, heartbeat 60s, mitm 300s, threat lookups, events/DLP
RPS_OPTIMIZED = 1 / 60 + 1 / 120 + 1 / 300 + 0.005 + 0.010  # rules: ETag/long-poll 60s, heartbeat 120s
API_RPS_PER_CORE = 1_500         # Go API, cached JSON, TLS ends at Cloudflare
SCAN_CPU_SEC_PER_EMP_DAY = 9.0   # DLP text+files+OCR (~7s) + download malware scans (~2s)
SCAN_PEAK_FACTOR = 2.0
WORK_HOURS = 9

# AI (DLP classification). Since 2026-10-01 text and vision run on Mistral
# Small 4 (mistralai/mistral-small-2603, OpenRouter list $0.15 in / $0.60 out
# per M tokens). Calls that end up on a fallback model (rate limits, outages)
# are priced at Gemini 3.1 Flash-Lite ($0.25 / $1.50), the dearest fallback.
LLM_IN_PER_M, LLM_OUT_PER_M = 0.15, 0.60     # Mistral Small 4 (text)
VIS_IN_PER_M, VIS_OUT_PER_M = 0.15, 0.60     # Mistral Small 4 (vision, same price)
FALLBACK_IN_PER_M, FALLBACK_OUT_PER_M = 0.25, 1.50
FALLBACK_SHARE = 0.05            # share of calls answered by a fallback model
TEXT_CALLS_CURRENT = 60          # per employee per workday: every message not already blocked
TEXT_CALLS_OPTIMIZED = 25        # after min-length/entity pre-filter, dedupe, cache
TEXT_TOKENS_IN, TEXT_TOKENS_OUT = 1_200, 60
IMAGE_CALLS = 4                  # per employee per workday
IMAGE_TOKENS_IN, IMAGE_TOKENS_OUT = 1_500, 80
# From 500k: Mistral Small 4 (open weights) on own GPUs. Against a $0.15/$0.60
# API the saving is ~30%, not the ~65% it was against Gemini list prices.
SELF_HOSTED_LLM_SHARE = 0.70
ASSISTANT_PER_EMP = 0.01         # admin assistant queries (Mistral Small 4), spread per employee

# Activity monitoring (screenshots): Enterprise / add-on only.
MONITORED_SHARE = 0.25           # share of protected employees with screenshots on
SHOTS_PER_DAY = 120              # default 60-420s random interval over an 8h day
SHOT_KB_CURRENT = 417            # measured in production (lossless WebP)
SHOT_KB_OPTIMIZED = 70           # lossy WebP q≈60 at ≤1600px wide
RETENTION_MONTHS = 3             # screenshot retention (90 days default)
R2_GB_MONTH = 0.015
R2_CLASS_A_PER_M = 4.50

# Events (blocked/alerted only; allowed traffic is never stored).
EVENTS_PER_DEVICE_DAY = 30
EVENT_BYTES_COMPRESSED = 50      # columnar store (ClickHouse) ~8x compression
EVENT_RETENTION_MONTHS = 12

# ─── Infra unit prices (OCI list, Cloudflare, AWS for managed DB) ────────────
OCPU_MONTH = 0.01 * 730          # OCI Ampere A1, $/OCPU-month
GB_RAM_MONTH = 0.0015 * 730      # OCI Ampere A1, $/GB-month
BLOCK_GB_MONTH = 0.0425          # OCI block volume incl. balanced performance
NODE = 4 * OCPU_MONTH + 24 * GB_RAM_MONTH   # 4 OCPU / 24 GB node
K8S_CONTROL_PLANE = 74.40        # OKE enhanced cluster, per region
EGRESS_PER_GB = 0.0085           # OCI after 10 TB free
# Managed PostgreSQL (Multi-AZ, AWS RDS list used as the conservative proxy)
RDS = {"t4g.medium": 0.065, "r7g.large": 0.239, "r7g.xlarge": 0.478, "r7g.2xlarge": 0.956, "r7g.4xlarge": 1.912, "r7g.8xlarge": 3.824}
RDS_GP3_GB = 0.115


@dataclass
class Plan:
    regions: int
    db: str | None           # None = Postgres inside the single VM
    db_replicas: int         # read replicas beyond the Multi-AZ pair
    db_storage_gb: int
    clickhouse_nodes: int
    base_nodes: int          # dashboards, Redis, observability, etc. per region
    cloudflare: float
    sre_fte: float           # people, not infra (shown separately)
    support_fte: float
    compliance_month: float  # SOC 2 / ISO 27001 / pen tests, amortised


PLANS = {
    100: Plan(1, None, 0, 0, 0, 1, 0, 0, 0, 0),
    1_000: Plan(1, "t4g.medium", 0, 50, 0, 2, 20, 0.1, 0.2, 2_500),
    10_000: Plan(1, "r7g.large", 0, 100, 1, 3, 250, 1, 1, 4_000),
    100_000: Plan(2, "r7g.xlarge", 1, 400, 3, 4, 3_000, 3, 4, 6_000),
    500_000: Plan(3, "r7g.2xlarge", 1, 1_200, 6, 5, 6_000, 6, 12, 8_000),
    1_000_000: Plan(4, "r7g.4xlarge", 1, 2_000, 9, 6, 10_000, 8, 20, 10_000),
}
SRE_FTE_MONTH = 3_500            # India-based, fully loaded
SUPPORT_FTE_MONTH = 1_500


def llm_cost_per_emp(optimized: bool, n: int) -> float:
    calls = TEXT_CALLS_OPTIMIZED if optimized else TEXT_CALLS_CURRENT
    def blend(tok_in, tok_out, p_in, p_out):
        primary = tok_in * p_in + tok_out * p_out
        fallback = tok_in * FALLBACK_IN_PER_M + tok_out * FALLBACK_OUT_PER_M
        return ((1 - FALLBACK_SHARE) * primary + FALLBACK_SHARE * fallback) / 1e6
    text = calls * WORKDAYS * blend(TEXT_TOKENS_IN, TEXT_TOKENS_OUT, LLM_IN_PER_M, LLM_OUT_PER_M)
    img = IMAGE_CALLS * WORKDAYS * blend(IMAGE_TOKENS_IN, IMAGE_TOKENS_OUT, VIS_IN_PER_M, VIS_OUT_PER_M)
    total = text + img
    if optimized and n >= 500_000:
        total *= SELF_HOSTED_LLM_SHARE
    return total + ASSISTANT_PER_EMP


def infra(n: int, optimized: bool = True, dlp_share: float = 0.7) -> dict:
    """Monthly infra cost for n protected employees. dlp_share = share of seats on
    plans with DLP (AI cost only applies to those)."""
    p = PLANS[n]
    devices = n * DEVICES_PER_EMPLOYEE
    online = devices * (ONLINE_PEAK_GLOBAL if n >= 100_000 else ONLINE_PEAK)
    rps = online * (RPS_OPTIMIZED if optimized else RPS_CURRENT)
    api_cores = rps / API_RPS_PER_CORE * 1.5
    scan_cores = n * SCAN_CPU_SEC_PER_EMP_DAY / (WORK_HOURS * 3600) * SCAN_PEAK_FACTOR
    if n == 100:
        # One paid 4-OCPU/24-GB A1 VM runs everything (today's prod box sits inside
        # OCI Always Free; budgeted as paid so production never depends on it).
        compute = NODE
    else:
        work_nodes = (api_cores + scan_cores) / 3.0  # ~3 usable OCPU per 4-OCPU node
        compute = (work_nodes + p.base_nodes * p.regions) * NODE
    k8s = K8S_CONTROL_PLANE * p.regions if n >= 10_000 else 0
    # Database
    if p.db:
        hourly = RDS[p.db] * 2 + RDS[p.db] * p.db_replicas
        db = (hourly * 730 + p.db_storage_gb * RDS_GP3_GB * 2) * p.regions
    else:
        db = 15.0  # Postgres on the VM: extra block volume + off-site backups
    events_gb = devices * EVENTS_PER_DEVICE_DAY * WORKDAYS * EVENT_RETENTION_MONTHS * EVENT_BYTES_COMPRESSED / 1e9
    clickhouse = p.clickhouse_nodes * (8 * OCPU_MONTH + 64 * GB_RAM_MONTH) + events_gb * 3 * BLOCK_GB_MONTH
    # Screenshots
    kb = SHOT_KB_OPTIMIZED if optimized else SHOT_KB_CURRENT
    monitored = n * MONITORED_SHARE
    shots_month = monitored * SHOTS_PER_DAY * WORKDAYS
    shots_gb = shots_month * RETENTION_MONTHS * kb / 1e6
    storage = shots_gb * R2_GB_MONTH + shots_month * R2_CLASS_A_PER_M / 1e6 + (db / 50)  # + backups
    # AI
    ai = llm_cost_per_emp(optimized, n) * n * dlp_share
    # Network
    egress_gb = rps * 1.0 * 730 * 3600 / 1e6  # ~1 KB per response
    network = max(0.0, egress_gb - 10_000) * EGRESS_PER_GB + p.cloudflare
    observability = 0.10 * (compute + clickhouse) + (0 if n < 10_000 else 100 * p.regions)
    email = n * 0.0002 + (0 if n < 10_000 else 20)
    infra_total = compute + k8s + db + clickhouse + storage + ai + network + observability + email
    people = p.sre_fte * SRE_FTE_MONTH + p.support_fte * SUPPORT_FTE_MONTH
    return {
        "n": n, "devices": devices, "rps": rps, "api_cores": api_cores, "scan_cores": scan_cores,
        "compute": compute, "k8s": k8s, "db": db, "clickhouse": clickhouse, "events_gb": events_gb,
        "storage": storage, "shots_tb": shots_gb / 1000, "ai": ai, "network": network,
        "observability": observability, "email": email, "infra": infra_total,
        "people": people, "compliance": p.compliance_month,
        "all_in": infra_total + people + p.compliance_month, "regions": p.regions,
    }


# ─── Pricing (USD per user per month, billed annually) ───────────────────────
LIST = {"Essentials": 4.0, "Business": 9.0, "Enterprise": 14.0}
INR = {"Essentials": 149, "Business": 349, "Enterprise": 549}  # + GST
BANDS = [(249, 0.00), (999, 0.10), (4_999, 0.20), (24_999, 0.30), (99_999, 0.38), (10**9, 0.45)]
PAYMENT_FEES = 0.025


def discount(seats: int) -> float:
    for top, d in BANDS:
        if seats <= top:
            return d
    return BANDS[-1][1]


def quote(seats: int, plan: str) -> float:
    """Monthly price for one customer with `seats` users on `plan` (USD)."""
    return seats * LIST[plan] * (1 - discount(seats))


# Plan mix of the customer base at each platform scale (Ess, Bus, Ent).
MIX = {100: (0.2, 0.7, 0.1), 1_000: (0.25, 0.6, 0.15), 10_000: (0.25, 0.55, 0.2),
       100_000: (0.25, 0.5, 0.25), 500_000: (0.2, 0.5, 0.3), 1_000_000: (0.2, 0.45, 0.35)}
# Typical customer size at each platform scale (drives the average discount).
TYPICAL_CUSTOMER = {100: 100, 1_000: 150, 10_000: 300, 100_000: 800, 500_000: 2_000, 1_000_000: 3_000}


def blended_arpu(n: int) -> float:
    e, b, x = MIX[n]
    list_avg = e * LIST["Essentials"] + b * LIST["Business"] + x * LIST["Enterprise"]
    return list_avg * (1 - discount(TYPICAL_CUSTOMER[n]))


def money(v: float) -> str:
    return f"${v:,.0f}" if v >= 10 else f"${v:,.2f}"


def main() -> None:
    print("## Infra cost per month (optimized architecture)\n")
    print("| Employees | Devices | Regions | Compute | K8s | Postgres | Events DB | Object storage | AI | Network+CDN | Observability | **Infra total** | **Per employee** |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n in SCALES:
        r = infra(n, True)
        print(f"| {n:,} | {r['devices']:,.0f} | {r['regions']} | {money(r['compute'])} | {money(r['k8s'])} | {money(r['db'])} | {money(r['clickhouse'])} | {money(r['storage'])} | {money(r['ai'])} | {money(r['network'])} | {money(r['observability'])} | **{money(r['infra'])}** | **${r['infra'] / n:.3f}** |")
    print("\n## Current architecture vs optimized (infra only)\n")
    print("| Employees | Current infra | Optimized infra | Saving | API req/s current → optimized | Screenshot storage TB current → optimized |")
    print("|---|---|---|---|---|---|")
    for n in SCALES:
        c, o = infra(n, False), infra(n, True)
        print(f"| {n:,} | {money(c['infra'])} | {money(o['infra'])} | {(1 - o['infra'] / c['infra']) * 100:.0f}% | {c['rps']:,.0f} → {o['rps']:,.0f} | {c['shots_tb']:,.1f} → {o['shots_tb']:,.1f} |")
    print("\n## All-in cost to serve (infra + people + compliance)\n")
    print("| Employees | Infra | SRE + support | Compliance | **All-in / month** | **All-in per employee** |")
    print("|---|---|---|---|---|---|")
    for n in SCALES:
        r = infra(n, True)
        print(f"| {n:,} | {money(r['infra'])} | {money(r['people'])} | {money(r['compliance'])} | **{money(r['all_in'])}** | **${r['all_in'] / n:.2f}** |")
    print("\n## Revenue and gross margin at each platform scale\n")
    print("| Employees | Blended ARPU (per user/month) | MRR | ARR | Infra margin | All-in margin (after people, compliance, payment fees) |")
    print("|---|---|---|---|---|---|")
    for n in SCALES:
        r = infra(n, True)
        arpu = blended_arpu(n)
        mrr = arpu * n
        fees = mrr * PAYMENT_FEES
        print(f"| {n:,} | ${arpu:.2f} | {money(mrr)} | {money(mrr * 12)} | {(1 - r['infra'] / mrr) * 100:.0f}% | {(1 - (r['all_in'] + fees) / mrr) * 100:.0f}% |")
    print("\n## What one customer pays (USD per month, annual billing)\n")
    print("| Company size | Discount | Essentials | Business | Enterprise | Business per user |")
    print("|---|---|---|---|---|---|")
    for n in SCALES:
        print(f"| {n:,} | {discount(n) * 100:.0f}% | {money(quote(n, 'Essentials'))} | {money(quote(n, 'Business'))} | {money(quote(n, 'Enterprise'))} | ${quote(n, 'Business') / n:.2f} |")
    print("\n## What one Indian customer pays (INR per month, annual billing, + 18% GST)\n")
    print("| Company size | Discount | Essentials | Business | Enterprise |")
    print("|---|---|---|---|---|")
    for n in SCALES:
        d = 1 - discount(n)
        print(f"| {n:,} | {discount(n) * 100:.0f}% | ₹{n * INR['Essentials'] * d:,.0f} | ₹{n * INR['Business'] * d:,.0f} | ₹{n * INR['Enterprise'] * d:,.0f} |")
    print("\n## AI cost per DLP employee per month\n")
    for opt in (False, True):
        print(f"- {'optimized' if opt else 'current'}: ${llm_cost_per_emp(opt, 1_000):.2f} (≥500k self-hosted: ${llm_cost_per_emp(opt, 500_000):.2f})")


if __name__ == "__main__":
    main()

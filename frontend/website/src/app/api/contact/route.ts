// Demo requests from /contact. The lead is stored by admin-api (which emails
// the team and the requester, and lists it in the superadmin panel); this
// route validates, rate-limits and forwards it server-to-server.

const MAX = 4000;
const ADMIN_API = process.env.ADMIN_API_INTERNAL_URL || "http://admin-api:6000";

// Per-visitor limit, in memory: 5 submissions per 10 minutes per IP. The
// website runs as a single container, so this is enough to stop form spam.
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;
const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  // Honeypot: a field real visitors never see. Bots fill it; pretend success.
  if (String(body.website ?? "").trim()) return Response.json({ ok: true });

  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim();
  if (limited(ip || "unknown")) {
    return Response.json({ error: "Too many requests. Please try again in a few minutes." }, { status: 429 });
  }

  const pick = (k: string) => String(body[k] ?? "").trim().slice(0, MAX);
  const lead = {
    name: pick("name"),
    email: pick("email"),
    company: pick("company"),
    devices: pick("devices"),
    message: pick("message"),
    source: pick("source") || "/contact",
    ip_address: ip,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 500),
  };

  if (!lead.name || !lead.company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    return Response.json({ error: "missing fields" }, { status: 422 });
  }

  try {
    const res = await fetch(`${ADMIN_API}/internal/website/demo-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": process.env.INTERNAL_API_SECRET || "" },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`admin-api ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    // Keep the lead recoverable from `docker logs` even when admin-api is down.
    console.error("[demo-request] forward failed", err, JSON.stringify(lead));
    return Response.json({ error: "Could not send your request. Please try again." }, { status: 502 });
  }

  return Response.json({ ok: true });
}

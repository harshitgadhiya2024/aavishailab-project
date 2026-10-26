// Prelaunch waitlist sign-ups from /waitlist. The entry is stored by admin-api
// (which emails a confirmation and lists it in the superadmin panel); this
// route validates, rate-limits and forwards it server-to-server, the same way
// /api/contact handles demo requests.

import http from "node:http";

const MAX = 300;
const ADMIN_API = process.env.ADMIN_API_INTERNAL_URL || "http://admin-api:6000";

// Per-visitor limit, in memory: 5 sign-ups per 10 minutes per IP. The
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

// admin-api listens on 6000 inside the compose network, and 6000 is on the
// fetch spec's blocked-port list, so this call uses node:http directly.
function postInternal(url: string, payload: unknown): Promise<{ status: number; body: string }> {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const r = http.request(
      url,
      {
        method: "POST",
        timeout: 8000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          "X-Internal-Secret": process.env.INTERNAL_API_SECRET || "",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", reject);
    r.end(data);
  });
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
    return Response.json({ error: "Too many sign-ups from here. Please try again in a few minutes." }, { status: 429 });
  }

  const pick = (k: string) => String(body[k] ?? "").trim().slice(0, MAX);
  const entry = {
    name: pick("name"),
    email: pick("email"),
    company: pick("company"),
    team_size: pick("team_size"),
    role: pick("role"),
    source: pick("source") || "/waitlist",
    ip_address: ip,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 500),
  };

  if (!entry.name || !entry.company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)) {
    return Response.json({ error: "Please fill in your name, work email and company." }, { status: 422 });
  }

  try {
    const res = await postInternal(`${ADMIN_API}/internal/website/waitlist`, entry);
    if (res.status < 200 || res.status >= 300) throw new Error(`admin-api ${res.status}: ${res.body.slice(0, 200)}`);
  } catch (err) {
    // Keep the sign-up recoverable from `docker logs` even when admin-api is down.
    console.error("[waitlist] forward failed", err, JSON.stringify(entry));
    return Response.json({ error: "Could not add you to the list. Please try again." }, { status: 500 });
  }

  return Response.json({ ok: true });
}

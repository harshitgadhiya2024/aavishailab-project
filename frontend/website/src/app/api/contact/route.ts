// Demo requests. Every request is logged (visible in `docker logs`), and
// forwarded to CONTACT_WEBHOOK_URL when set (Slack/Discord/CRM webhook).

const MAX = 2000;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const pick = (k: string) => String(body[k] ?? "").trim().slice(0, MAX);
  const lead = {
    name: pick("name"),
    email: pick("email"),
    company: pick("company"),
    devices: pick("devices"),
    message: pick("message"),
    at: new Date().toISOString(),
  };

  if (!lead.name || !lead.company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    return Response.json({ error: "missing fields" }, { status: 422 });
  }

  console.log("[demo-request]", JSON.stringify(lead));

  const hook = process.env.CONTACT_WEBHOOK_URL;
  if (hook) {
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `New DelSecure demo request\n${lead.name} <${lead.email}>\n${lead.company}, ${lead.devices} devices\n${lead.message}`,
          content: `New DelSecure demo request: ${lead.name} <${lead.email}>, ${lead.company}, ${lead.devices} devices. ${lead.message}`,
          lead,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      console.error("[demo-request] webhook failed", err);
    }
  }

  return Response.json({ ok: true });
}

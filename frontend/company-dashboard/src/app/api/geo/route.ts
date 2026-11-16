import { NextResponse } from "next/server";

// The visitor's country as Cloudflare sees it (CF-IPCountry), so prices show
// in the right currency. Null when the header is missing, as in local dev.
export function GET(req: Request) {
  const country = req.headers.get("cf-ipcountry");
  return NextResponse.json({ country: country && country !== "XX" ? country : null }, { headers: { "Cache-Control": "private, no-store" } });
}

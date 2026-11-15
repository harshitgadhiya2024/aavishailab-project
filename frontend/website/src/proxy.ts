import { NextResponse, type NextRequest } from "next/server";

// aavishield.com is the one public origin. The old prelaunch subdomain and
// www both redirect to it permanently, keeping the path and query, so links
// and search rankings move over in one hop. Cloudflare should do the same at
// the edge; this is the fallback when a request reaches the app directly.
const CANONICAL_HOST = "aavishield.com";
const REDIRECT_HOSTS = new Set(["website.aavishield.com", "www.aavishield.com"]);

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!REDIRECT_HOSTS.has(host)) return NextResponse.next();

  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${CANONICAL_HOST}`);
  // 308 is permanent like 301 and keeps the method, so form POSTs survive.
  return NextResponse.redirect(url, 308);
}

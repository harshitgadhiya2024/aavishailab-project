import { NextResponse, type NextRequest } from "next/server";

// aavishield.com is the prelaunch domain: it serves only the waitlist page.
// The full website lives on website.aavishield.com.
const WAITLIST_HOSTS = new Set(["aavishield.com", "www.aavishield.com"]);
const WEBSITE_URL = "https://website.aavishield.com";

// What the waitlist page itself needs: its sign-up route, build output, images and icons.
const ALLOWED = [/^\/waitlist\/?$/, /^\/api\/waitlist\/?$/, /^\/_next\//, /^\/brand\//, /^\/images\//, /^\/[^/]+\.(png|svg|ico|webmanifest|txt|xml)$/, /^\/opengraph-image/];

// Legal pages linked from the sign-up form open on the full website.
const LEGAL = ["/privacy-policy", "/terms-and-conditions", "/cookie-policy", "/acceptable-use-policy"];

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!WAITLIST_HOSTS.has(host)) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (ALLOWED.some((re) => re.test(pathname))) return NextResponse.next();
  if (LEGAL.includes(pathname)) return NextResponse.redirect(`${WEBSITE_URL}${pathname}`);

  return NextResponse.redirect(new URL("/waitlist", `https://${host}`));
}

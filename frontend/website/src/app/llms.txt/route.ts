import { listPosts } from "@/lib/cms";
import { modules } from "@/lib/content";
import { SITE_URL } from "@/lib/seo";
import { industries, solutionsList } from "@/lib/solutions";

// llms.txt (https://llmstxt.org): a plain Markdown map of the site for AI
// assistants and answer engines. Built from the same data as the pages and
// the sitemap, and refreshed with them.
export const revalidate = 300;

const link = (title: string, path: string, note?: string) => `- [${title}](${SITE_URL}${path})${note ? `: ${note}` : ""}`;

export async function GET() {
  const [guides, blog] = await Promise.all([listPosts("guide"), listPosts("blog")]);
  const body = [
    "# Aavishield",
    "",
    "> Aavishield is endpoint security for companies. One agent on macOS, Windows and Linux enforces web filtering, data loss prevention (DLP), application control, VPN and proxy blocking, malware scanning and device posture checks, on any network, with every decision recorded in one console. Built by Aavish AI Lab.",
    "",
    "## Product",
    link("Platform overview", "/platform"),
    ...modules.map((m) => link(m.name, `/platform/${m.slug}`, m.short)),
    link("How it works", "/how-it-works", "install, set policy, see every decision"),
    link("Pricing", "/pricing", "per device, custom quote"),
    link("Security and data protection", "/security"),
    link("Why Aavishield", "/why-aavishield"),
    link("Product tour", "/product-tour"),
    "",
    "## Solutions",
    ...solutionsList.map((s) => link(s.name, `/solutions/${s.slug}`, s.description)),
    "",
    "## Industries",
    ...industries.map((i) => link(i.name, `/industries/${i.slug}`, i.menu)),
    "",
    "## Knowledge hub",
    ...guides.map((g) => link(g.title, `/knowledge-hub/${g.slug}`, g.excerpt || undefined)),
    "",
    "## Blog",
    ...blog.map((b) => link(b.title, `/blog/${b.slug}`, b.excerpt || undefined)),
    "",
    "## Company",
    link("About", "/company"),
    link("Contact and demo requests", "/contact"),
    link("FAQ", "/faq"),
    link("Privacy policy", "/privacy-policy"),
    link("Terms and conditions", "/terms-and-conditions"),
    "",
  ].join("\n");

  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}

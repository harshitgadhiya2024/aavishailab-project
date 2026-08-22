import { DocPage, Callout, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/web-security"
      title="Web Security (SWG)"
      description="Domain and category-based web filtering, URL categories, and HTTPS inspection."
      audience="Company"
    >
      <h2>Web Gateway</h2>
      <p>
        The Web Gateway (SWG) page is where domain-level rules live: allow or block a specific
        website, see stats on what's being blocked, run an ad-hoc URL check ("would this be blocked
        right now?"), and look up threat-intel reputation for a domain.
      </p>

      <h2>Policy Categories</h2>
      <p>
        Rather than listing every domain by hand, you can block or allow whole categories of sites
        (e.g. "File Sharing", "Adult Content", "AI Tools"). The Policy Categories page shows:
      </p>
      <FeatureTable
        rows={[
          { name: "Built-in categories", desc: "Shipped with the platform, with a risk level from None to Critical." },
          { name: "Domain membership", desc: "Click into a category to see and edit which domains belong to it." },
          { name: "Built-in vs. added domains", desc: "Domains you add yourself are tagged \"Added by you\", separate from the built-in list, so your customizations survive updates." },
        ]}
      />
      <p>
        A category becomes useful the moment a policy (see <em>Policies Overview</em>) references it as
        a condition — blocking "File Sharing" as a category is one rule instead of maintaining a
        domain list by hand.
      </p>

      <h2>SSL Inspection</h2>
      <p>
        DLP and content-based rules can only see plaintext traffic. Most of the web today is HTTPS, so
        without SSL Inspection turned on, those rules only ever see HTTP traffic — a small fraction of
        real usage. The SSL Inspection page configures the per-organization certificate used to inspect
        HTTPS traffic and lets you set a bypass list for sites you never want inspected (e.g. banking,
        personal health portals) for privacy reasons.
      </p>

      <Callout type="warning" title="Turn this on if DLP matters to you">
        If sensitive-data protection is a priority, SSL Inspection isn't optional — without it, DLP is
        only checking a sliver of your company's actual traffic.
      </Callout>
    </DocPage>
  );
}

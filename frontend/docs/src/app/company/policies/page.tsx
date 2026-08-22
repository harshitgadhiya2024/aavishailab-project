import { DocPage, Callout, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/policies"
      title="Policies Overview"
      description="How the individual controls — Web Gateway, DLP, App Control, and the rest — come together into enforceable policies."
      audience="Company"
    >
      <p>
        The Policies page is where individual rules become an enforced policy. A policy has a type
        (network/website blocking, or DLP), a set of conditions, and a scope.
      </p>

      <h2>Condition types</h2>
      <FeatureTable
        rows={[
          { name: "Domain", desc: "Match a specific website." },
          { name: "Category", desc: "Match an entire category of sites (see Policy Categories, under Web Security)." },
          { name: "URL pattern", desc: "Match a URL by pattern rather than exact domain." },
          { name: "Application", desc: "Match a specific installed application/process." },
          { name: "Time range", desc: "Only apply during specific hours." },
          { name: "User group", desc: "Only apply to a specific team." },
        ]}
      />

      <h2>Scope</h2>
      <p>
        Every policy applies to one of: your whole organization, one or more specific Teams, or one or
        more specific Employees. Start broad (whole org) and narrow down with team/employee-scoped
        exceptions as you learn what your company actually needs.
      </p>

      <h2>What you can do with a policy</h2>
      <p>
        Create, edit, enable/disable (toggle) without deleting, duplicate an existing policy as a
        starting point for a new one, and export/import policy sets — useful for replicating a working
        configuration across a second organization or keeping an offline backup of your rules.
      </p>

      <Callout type="note" title="Where the actual controls live">
        This page is the assembly point. The individual protection areas — Web Gateway, DLP,
        Application Control, CASB, Shadow IT — each have their own page, linked from the sidebar, where
        you configure what a policy can actually reference.
      </Callout>
    </DocPage>
  );
}

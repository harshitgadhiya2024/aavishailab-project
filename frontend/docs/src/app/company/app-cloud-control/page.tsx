import { DocPage, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/app-cloud-control"
      title="Application & Cloud Control"
      description="Controlling installed software and SaaS app usage — not just websites."
      audience="Company"
    >
      <h2>Application Control</h2>
      <p>
        This covers software running on the device itself, not just what's browsed to. The
        Application Control page has a catalog of known applications plus your own rules to allow or
        block specific software by process — and an events feed showing every time a launch was
        blocked, so you can see what's actually being attempted.
      </p>

      <h2>CASB</h2>
      <p>
        CASB (Cloud Access Security Broker) controls activity inside sanctioned SaaS apps —
        uploading, downloading, or sharing within apps like Google Drive or Slack, not just whether the
        app can be reached at all. Rules you write here are evaluated before the built-in defaults, so
        your own policy always takes precedence.
      </p>

      <h2>What each is for</h2>
      <FeatureTable
        rows={[
          { name: "Web Gateway", desc: "\"Can this domain be reached at all?\"" },
          { name: "Application Control", desc: "\"Can this software run on the device?\"" },
          { name: "CASB", desc: "\"What can happen inside this SaaS app once it's reached?\"" },
        ]}
      />
    </DocPage>
  );
}

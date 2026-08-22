import { DocPage, Callout, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/getting-started/overview"
      title="What is Aavishield"
      description="A Zero Trust security platform that protects every company device — web traffic, file uploads/downloads, and installed applications — from one console."
    >
      <p>
        Aavishield runs a lightweight agent on every employee device. That agent acts as a local
        enforcement point: it pulls your organization's rules from the cloud, then blocks or allows
        web traffic, scans downloads for malware, scans uploads for sensitive data, and can inspect
        HTTPS traffic when you turn that on. Every event it sees is reported back, so your dashboard
        shows what's actually happening across the company in real time — not a sample, not a delayed
        batch.
      </p>

      <h2>The two consoles</h2>
      <p>Aavishield is two separate applications, each for a different audience:</p>
      <FeatureTable
        rows={[
          { name: "Company Dashboard", desc: "Where you, the company admin, configure policies, manage employees and devices, and review activity and reports." },
          { name: "Employee Portal", desc: "Where each employee activates their account, downloads the agent, and sees their own blocked activity." },
        ]}
      />

      <h2>How enforcement actually works</h2>
      <p>
        The agent is a local proxy on the employee's device. When they browse, upload a file, or try
        to run an application, the agent checks it against your organization's current rules — pulled
        from the cloud on a short interval — before deciding to allow, block, or alert. This is
        different from a traditional cloud-proxy model (traffic never has to route through a distant
        data center first), and it means enforcement keeps working even if the device is off your
        office network.
      </p>

      <Callout type="note" title="Where to go next">
        If you're setting this up for the first time, go to <strong>Quick Start</strong> next — it walks
        through account creation, adding your team, and getting your first policy live.
      </Callout>
    </DocPage>
  );
}

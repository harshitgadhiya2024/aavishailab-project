import { DocPage, FeatureTable, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/employee/devices-activity"
      title="Your Devices & Activity"
      description="Seeing what's enrolled under your name, and what's actually being blocked."
      audience="Employee"
    >
      <h2>My Devices</h2>
      <p>Lists every device enrolled under your account:</p>
      <FeatureTable
        rows={[
          { name: "Hostname & OS", desc: "Which machine, and what platform." },
          { name: "Status", desc: "Online, offline, or revoked." },
          { name: "IP, agent version, last seen, enrolled date", desc: "Basic health/recency info." },
        ]}
      />
      <p>
        You can remove your own device with the trash icon — this revokes its agent credential, so if
        it's still running, it stops reporting. Use this when you retire a device or reinstall from
        scratch.
      </p>

      <h2>Blocked Activity</h2>
      <p>
        Shows your own blocked and alerted events, filterable by time range (24h/7d/30d) and by
        blocked/alerted/all. It updates live while you have the page open.
      </p>
      <p>Each row shows the domain or app, why it was blocked, its category, and a risk score.</p>

      <Callout type="note" title="This is also where you ask for an exception">
        If something you need for work is blocked, look for the Request Access action on that row —
        it opens a small form for an optional reason and sends the request straight to your admin. You
        can see the status right there afterward: Requested, Access Granted, or Denied.
      </Callout>
    </DocPage>
  );
}

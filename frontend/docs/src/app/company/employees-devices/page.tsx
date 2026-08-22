import { DocPage, Steps, Step, Callout, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/employees-devices"
      title="Employees & Devices"
      description="Adding the people you're protecting, and managing the devices their agents run on."
      audience="Company"
    >
      <h2>Adding employees</h2>
      <p>
        The Employees page is where you create a record for each person — name, email, department.
        You can add them one at a time or bulk-import with a CSV (there's an export option too, for
        keeping your own records in sync).
      </p>
      <Callout type="note" title="This is a prerequisite, not activation">
        Adding an employee record here doesn't give them portal access by itself — it's what the
        Employee Portal's activation step checks against (see the Employee Guide's <em>Activating Your
        Account</em>). Add the record first, then have them activate.
      </Callout>

      <h2>Managing devices</h2>
      <p>The Devices page lists every enrolled device with:</p>
      <FeatureTable
        rows={[
          { name: "Device & Employee", desc: "Hostname, MAC address, and who it's assigned to." },
          { name: "OS / Agent version", desc: "What platform and how current the installed agent is." },
          { name: "Status", desc: "Online, offline, or a warning state." },
          { name: "Ownership", desc: "Company-owned or Personal (BYOD) — you can change this per device." },
          { name: "Enforcement", desc: "The device's working-hours schedule, editable per device." },
          { name: "Posture score", desc: "A 0–100 health score for the device." },
          { name: "IP / Geo", desc: "Last-seen location, from the device's reported IP." },
        ]}
      />

      <h3>Revoking a device</h3>
      <p>
        Each row has a Revoke action (with a confirmation prompt) that stops the device's agent
        credential from working — the agent can no longer authenticate or report in. This isn't a
        remote wipe or lock; it just cuts the device off from your organization's policies and
        reporting. Use it when a device is lost, an employee leaves, or you suspect a credential was
        compromised.
      </p>

      <Callout type="warning" title="Watch BYOD devices without a schedule">
        A personal device with no working-hours schedule configured is monitored around the clock,
        same as a company device — the page flags this explicitly. If that's not what you intend for
        BYOD, set an enforcement schedule for it.
      </Callout>
    </DocPage>
  );
}

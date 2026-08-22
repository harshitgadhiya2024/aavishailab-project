import { DocPage, Steps, Step, Callout, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/team-access"
      title="Team & Access (RBAC)"
      description="Giving other people dashboard access, and controlling exactly what each of them can do."
      audience="Company"
    >
      <p>
        Not everyone who needs to sign into the dashboard needs the same access. The Team &amp; Access
        page lets you invite people at the right level for their job.
      </p>

      <h2>Roles</h2>
      <FeatureTable
        rows={[
          { name: "Org Admin", desc: "Full access to every feature and setting." },
          { name: "Manager", desc: "Scoped to specific teams — sees and manages only the employees/devices assigned to their teams." },
          { name: "Analyst", desc: "Day-to-day operational access (policies, activity, reports) without account-management or billing-level control." },
          { name: "Read Only", desc: "View everything, change nothing — useful for auditors or leadership who just need visibility." },
        ]}
      />

      <h2>Inviting someone</h2>
      <Steps>
        <Step n={1} title="Open Team & Access and start an invite">
          Enter their email and pick a role.
        </Step>
        <Step n={2} title="Set a password, or let the system generate one">
          If you leave it blank, a temporary password is generated for them.
        </Step>
        <Step n={3} title="Share the password yourself">
          It's shown to you exactly once, in a copyable banner — there's no emailed invite link, so
          you'll need to send it to them directly (Slack, in person, however your team normally shares
          a one-time credential).
        </Step>
      </Steps>

      <h2>Teams</h2>
      <p>
        The separate Teams page groups employees together. Teams matter for two things: scoping a
        Manager's visibility to only their team, and setting per-team working-hours enforcement
        schedules that differ from the org default.
      </p>
    </DocPage>
  );
}

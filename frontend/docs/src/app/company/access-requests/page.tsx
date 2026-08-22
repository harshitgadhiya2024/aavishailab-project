import { DocPage, Steps, Step, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/access-requests"
      title="Access Requests"
      description="What happens when an employee needs an exception to a block — and how you decide it."
      audience="Company"
    >
      <p>
        When an employee is blocked from a site they need for work, they can request an exception
        directly from their own Activity page (see the Employee Guide) instead of having to contact IT
        separately. The request only exists if they were genuinely blocked on that domain — the
        backend checks their real activity history before allowing the request, so this can't be used
        to fish for access to sites never actually hit.
      </p>

      <h2>Reviewing a request</h2>
      <Steps>
        <Step n={1} title="You get notified">
          An email goes to org admins the moment a request is submitted (if notifications for access
          requests are enabled in Settings).
        </Step>
        <Step n={2} title="Open Access Requests">
          Filter by status (pending/approved/denied) or search by domain, employee, or policy.
        </Step>
        <Step n={3} title="Approve or deny">
          Either action is logged to the audit trail, and the employee is emailed the outcome.
        </Step>
      </Steps>

      <Callout type="note" title="Approval is permanent, not time-limited">
        There's no expiry field — an approved request directly becomes the exception the agent checks
        against going forward. If you want to revisit it later, you'll need to change the underlying
        policy rather than expect it to lapse on its own.
      </Callout>
    </DocPage>
  );
}

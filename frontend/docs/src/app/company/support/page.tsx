import { DocPage, Steps, Step } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/support"
      title="Support"
      description="Raising and following up on an issue — built into the dashboard, no external tool needed."
      audience="Company"
    >
      <p>
        Every signed-in dashboard user can reach Help → Support — there's no special permission
        required, so anyone on your team can ask for help without needing an admin to do it for them.
      </p>

      <Steps>
        <Step n={1} title="Open a ticket">
          Give it a subject, describe the issue, and set a priority.
        </Step>
        <Step n={2} title="Follow the thread">
          Replies from Aavishield's team show up in the same thread — reply back and forth like any
          support conversation.
        </Step>
        <Step n={3} title="Resolved tickets reopen automatically">
          If a ticket is marked resolved and you reply again, it reopens on its own — you don't have to
          find a "reopen" button.
        </Step>
      </Steps>
    </DocPage>
  );
}

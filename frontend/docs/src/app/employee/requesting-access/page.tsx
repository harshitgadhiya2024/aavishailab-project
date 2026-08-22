import { DocPage, Steps, Step, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/employee/requesting-access"
      title="Requesting Access"
      description="What to do when something you need for work is blocked."
      audience="Employee"
    >
      <p>
        If you hit a block on something you genuinely need, you don't have to email IT and wait — you
        can ask directly from the same place you saw the block.
      </p>

      <Steps>
        <Step n={1} title="Go to Blocked Activity">
          Find the row for the site or app that got blocked.
        </Step>
        <Step n={2} title="Click Request Access">
          You can add an optional reason to help your admin decide faster.
        </Step>
        <Step n={3} title="Wait for a decision">
          Your admin gets notified. You'll see the status update on the same row: Requested → Access
          Granted or Denied. You'll also get an email either way.
        </Step>
      </Steps>

      <Callout type="note" title="You can only request what actually blocked you">
        This only works for something you were genuinely blocked on — it's tied to your real activity,
        not a general request form.
      </Callout>
    </DocPage>
  );
}

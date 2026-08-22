import { DocPage, Steps, Step } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/shadow-it"
      title="Shadow IT Discovery"
      description="Finding the SaaS apps your employees are already using that you never approved."
      audience="Company"
    >
      <p>
        Shadow IT discovery works off the traffic your agents already report — it surfaces domains
        employees are actively using that don't have an explicit sanction decision yet, along with how
        many people are using it and how often.
      </p>

      <h2>Turning a discovery into a decision</h2>
      <Steps>
        <Step n={1} title="Review what's been discovered">
          The Shadow IT page lists domains by usage, with event and user counts.
        </Step>
        <Step n={2} title="Sanction, unsanction, or leave it">
          Click into a discovered app and mark it Sanctioned (officially approved), Unsanctioned
          (flagged as risky/unapproved), or leave it unreviewed for now.
        </Step>
        <Step n={3} title="It becomes an enforced rule">
          Sanctioning turns the discovery into an actual domain rule, the same enforcement path as
          anything configured directly in Web Gateway — it's not just a label.
        </Step>
      </Steps>
    </DocPage>
  );
}

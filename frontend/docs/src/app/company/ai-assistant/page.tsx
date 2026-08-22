import { DocPage, Callout, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/ai-assistant"
      title="AI Assistant"
      description="A chat assistant that can actually query and change your organization's data — with guardrails on anything destructive."
      audience="Company"
    >
      <p>
        The AI Assistant is a chat interface, not just a Q&amp;A bot — it can look things up and take
        real actions in your organization on your behalf. You'll see suggested prompts to start (e.g.
        "Create a policy blocking file-sharing sites", "Show pending access requests"), and tool calls
        it makes along the way show up as small status pills so you can see what it's actually doing.
      </p>

      <h2>What it can do</h2>
      <FeatureTable
        rows={[
          { name: "Look things up", desc: "Activity logs and stats, policies, employees and their activity, SWG/SSL stats, teams, access requests, shadow-IT apps, categories, devices, CASB rules, dashboard overview." },
          { name: "Generate reports", desc: "Kick off and fetch any of the report types on demand." },
          { name: "Manage policies", desc: "Create, update, toggle, and delete policies, and look up which domains a policy covers." },
          { name: "Resolve access requests", desc: "Approve or deny a pending request." },
          { name: "Manage shadow IT", desc: "Sanction, unsanction, or reset an app's status." },
          { name: "Manage categories", desc: "Add domains to a category." },
        ]}
      />

      <h2>Guardrails</h2>
      <p>
        Destructive actions — deleting a policy, disabling an active one, denying or blocking a
        widely-used app — require you to actually confirm in the conversation itself. This is checked
        against your real message history server-side, not just taken from what the model claims you
        said, which closes off a class of prompt-injection tricks where malicious data the assistant
        reads (like an activity log entry) tries to talk it into a destructive action on its own.
      </p>
      <p>
        The assistant never invents values when creating or updating something — it asks a follow-up
        question instead of guessing. It only ever sees your organization's own data, and it's
        instructed never to reveal its own prompts, internal schemas, or tokens.
      </p>

      <Callout type="note" title="Tool-result data is treated as untrusted">
        Anything the assistant reads back from your data (activity logs, discovered domains) is
        wrapped and treated as data to reason about, not as instructions to follow — so content someone
        else put into your logs can't hijack what the assistant does next.
      </Callout>
    </DocPage>
  );
}

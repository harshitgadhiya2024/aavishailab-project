import { DocPage, Steps, Step, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/getting-started/quick-start"
      title="Quick Start"
      description="From a brand-new account to your first protected device — every step, in order."
    >
      <p>
        This is the complete path from nothing to a working setup. Each step links to the full guide
        for that area if you want more detail.
      </p>

      <Steps>
        <Step n={1} title="Create your account">
          Go to the Company Dashboard's Register page. Enter your company name, your name, email, and
          password. You'll get a 6-digit code by email — nothing is saved until you verify it. Once
          verified, your organization and admin account are created together and you land straight in
          the dashboard.
        </Step>
        <Step n={2} title="Complete your company profile">
          Fill in your company identity, tax/registration details, and security contact from the
          Profile page. See <em>Organization Setup</em>.
        </Step>
        <Step n={3} title="Invite your team (optional)">
          If other people need dashboard access, invite them from Team &amp; Access with a role. See
          <em> Team &amp; Access</em>.
        </Step>
        <Step n={4} title="Add your employees">
          Add a record for each employee (individually or by CSV import) from the Employees page. See
          <em> Employees &amp; Devices</em>.
        </Step>
        <Step n={5} title="Have employees activate their portal account">
          Each employee registers on the Employee Portal with your company code, their work email, and
          a password they choose. See <em>Activating Your Account</em>.
        </Step>
        <Step n={6} title="Install the agent on every device">
          From the portal's Download page, each employee gets an installer and a one-time enrollment
          code for their OS. See <em>Installing the Agent</em>.
        </Step>
        <Step n={7} title="Turn on your first policies">
          Start with Web Gateway (domain rules) and DLP (sensitive-data protection) — the two most
          commonly needed controls. See <em>Web Security</em> and <em>Data Loss Prevention</em>.
        </Step>
        <Step n={8} title="Enable MFA">
          Turn on your own two-factor authentication, then decide whether to require it organization-wide.
          See <em>Security &amp; MFA</em>.
        </Step>
      </Steps>

      <Callout type="gap" title="One thing to know now">
        Your organization's <strong>company code</strong> (needed by every employee in step 5) isn't
        shown anywhere in the dashboard UI yet. Note it down right after step 1 — if you don't have it,
        raise a Support ticket and it'll be shared with you.
      </Callout>
    </DocPage>
  );
}

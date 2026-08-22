import { DocPage, Steps, Step, Callout, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/organization-setup"
      title="Organization Setup"
      description="Creating your account and filling in your company's profile — the first thing every admin does."
      audience="Company"
    >
      <h2>Creating your account</h2>
      <p>
        Registration is fully self-serve — nobody needs to create anything for you first. Go to the
        Company Dashboard's Register page and provide your company name, your name, your email, and a
        password.
      </p>
      <Steps>
        <Step n={1} title="Submit the sign-up form">
          Nothing is written to the database yet at this point — your details ride on a pending,
          unverified record until the next step.
        </Step>
        <Step n={2} title="Enter the 6-digit code emailed to you">
          A "Resend" option is available (45-second cooldown) if it doesn't arrive.
        </Step>
        <Step n={3} title="You're in">
          Verifying the code creates your Organization (on a 14-day trial, 50 seats) and your Admin
          account together, and signs you straight into the dashboard — no separate login step.
        </Step>
      </Steps>

      <h2>Completing your Company Profile</h2>
      <p>The Profile page (labeled "Company Profile" in the product) covers:</p>
      <FeatureTable
        rows={[
          { name: "Identity", desc: "Company name, legal name, industry, company size, logo." },
          { name: "Registration & tax", desc: "GSTIN, PAN, CIN, and other tax identifiers." },
          { name: "Security contact", desc: "Name, email, phone — who Aavishield or your own team should reach for a security incident." },
          { name: "Address", desc: "Your registered business address." },
        ]}
      />
      <p>The page shows a profile-completeness percentage so you can see what's left to fill in.</p>

      <Callout type="gap" title="Your company code isn't shown in the UI yet">
        Every employee needs your organization's internal "slug" (company code) to activate their
        portal account — but it currently has no display anywhere in the dashboard. Ask Aavishield
        Support for it once, right after you register, and keep it somewhere you can share with new
        hires.
      </Callout>
    </DocPage>
  );
}

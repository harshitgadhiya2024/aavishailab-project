import { DocPage, Steps, Step, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/security-mfa"
      title="Security & MFA"
      description="Enabling your own two-factor authentication, and requiring it across your whole organization."
      audience="Company"
    >
      <h2>Your own MFA</h2>
      <p>
        From Settings → Two-factor, you can enroll an authenticator app for your own account and get a
        set of one-time recovery codes in case you lose the device.
      </p>

      <h2>Organization-wide requirement</h2>
      <Steps>
        <Step n={1} title="Go to Settings → Organization security" />
        <Step n={2} title="Turn on the MFA requirement">
          Every account in your organization will now need a second factor to sign in.
        </Step>
        <Step n={3} title="Accounts without an authenticator use email codes">
          Anyone who hasn't set up an authenticator app falls back to a 6-digit code emailed at login
          time — nobody gets locked out, they just get a different second step.
        </Step>
      </Steps>

      <Callout type="note" title="Every login gets a second step, always">
        Even with the org-wide requirement off, an account without an authenticator still gets an
        emailed login code on every sign-in — there's no such thing as a single-factor login for a real
        account in this platform.
      </Callout>
    </DocPage>
  );
}

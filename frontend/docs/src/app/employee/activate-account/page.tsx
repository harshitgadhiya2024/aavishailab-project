import { DocPage, Steps, Step, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/employee/activate-account"
      title="Activating Your Account"
      description="Turning the record your admin created for you into an account you can actually log in with."
      audience="Employee"
    >
      <p>
        Before you can register, your company's admin needs to have added you as an employee — if
        registration says it can't find your record, that's the reason; ask your IT admin to add you
        first.
      </p>

      <Steps>
        <Step n={1} title="Get your company code from your admin">
          Every organization has one — your admin will share it with you.
        </Step>
        <Step n={2} title="Go to the Employee Portal's Register page" />
        <Step n={3} title="Enter the company code, your work email, and a new password">
          The email must match the one your admin used when adding your employee record.
        </Step>
        <Step n={4} title="You're activated">
          This sets your portal password — it's separate from any dashboard password, since employees
          and dashboard admins are different account types.
        </Step>
      </Steps>

      <Callout type="note" title="Forgot your password later?">
        Use the Forgot Password link on the login page — there's no in-portal password change, so this
        is the way to reset it if you ever need to.
      </Callout>
    </DocPage>
  );
}

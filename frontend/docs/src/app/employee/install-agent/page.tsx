import { DocPage, Steps, Step, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/employee/install-agent"
      title="Installing the Agent"
      description="Getting protection running on your device — one install per device, a few minutes each."
      audience="Employee"
    >
      <Steps>
        <Step n={1} title="Sign in to the Employee Portal" />
        <Step n={2} title="Go to Download Agent">
          Pick your operating system — macOS, Windows, or Linux.
        </Step>
        <Step n={3} title="Download the installer and note your enrollment code">
          The code is shown on the same page and stays valid for 2 hours.
        </Step>
        <Step n={4} title="Run the installer">
          Normal install process for your OS — no special steps needed for a single device.
        </Step>
        <Step n={5} title="First-run setup completes automatically">
          The agent opens a local setup page the first time it runs. As long as you're logged into the
          portal, it finishes enrolling your device on its own.
        </Step>
      </Steps>

      <Callout type="note" title="Once it's done">
        Your device shows up on the portal's My Devices page and starts reporting to your company's
        dashboard.
      </Callout>
    </DocPage>
  );
}

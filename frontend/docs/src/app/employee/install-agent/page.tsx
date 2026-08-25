import { DocPage, Steps, Step, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/employee/install-agent"
      title="Installing the Agent"
      description="Getting protection running on your device — one install per device, a few minutes each."
      audience="Employee"
    >
      <Callout type="note" title="No code to copy or type">
        The recommended installer (the <code>.pkg</code> / <code>.msi</code> / <code>.deb</code> button on the
        Download page) auto-enrolls your device through your browser the first time it runs — as long as
        you're signed in to the portal, there's nothing to copy or paste. The steps below also cover the
        one permission prompt each OS shows for a new installer, since our packages aren't code-signed yet.
      </Callout>

      <h2>macOS</h2>
      <Steps>
        <Step n={1} title="Download the installer">
          Sign in to the Employee Portal → Download Agent → macOS → download the <code>.pkg</code>.
        </Step>
        <Step n={2} title="Allow it past Gatekeeper">
          Since the package isn't code-signed yet, macOS blocks it on first open. Control-click (or
          right-click) the downloaded <code>.pkg</code> → <strong>Open</strong> → click <strong>Open</strong> again
          in the dialog. If macOS still refuses, go to <strong>System Settings → Privacy &amp; Security</strong>,
          scroll down, and click <strong>Open Anyway</strong> next to the Aavishield message.
        </Step>
        <Step n={3} title="Run the installer">
          Follow the on-screen steps. It installs to <code>/Applications/Aavishield.app</code> and starts
          automatically — no reboot needed.
        </Step>
        <Step n={4} title="Finish enrolling in the browser">
          A browser tab opens on its own to connect this device to your account. Stay signed in and it
          completes by itself.
        </Step>
        <Step n={5} title="Check it's running">
          Look for the Aavishield icon in the menu bar (top-right, near the clock) — green means it's
          monitoring. Click it for status, or check the portal's My Devices page for this device.
        </Step>
      </Steps>

      <h2>Windows</h2>
      <Steps>
        <Step n={1} title="Download the installer">
          Employee Portal → Download Agent → Windows → download the <code>.msi</code>.
        </Step>
        <Step n={2} title="Allow it past SmartScreen">
          Since the package isn't code-signed yet, Windows shows "Windows protected your PC" on first run.
          Click <strong>More info</strong>, then <strong>Run anyway</strong>.
        </Step>
        <Step n={3} title="Run the installer">
          Follow the setup wizard. The agent installs under Program Files and starts at your next login
          (or immediately, via the Run key).
        </Step>
        <Step n={4} title="Finish enrolling in the browser">
          A browser tab opens automatically to connect this device to your account. Stay signed in and it
          finishes on its own.
        </Step>
        <Step n={5} title="Check it's running">
          Look for the Aavishield icon in the system tray (bottom-right, click the ^ to show hidden icons).
          It also appears in <strong>Settings → Apps → Installed apps</strong> as "Aavishield Agent". Check
          the portal's My Devices page to confirm it's reporting in.
        </Step>
      </Steps>

      <h2>Linux (Ubuntu / Debian)</h2>
      <Steps>
        <Step n={1} title="Download the installer">
          Employee Portal → Download Agent → Linux → download the <code>.deb</code>.
        </Step>
        <Step n={2} title="No permission prompt needed">
          Linux has no Gatekeeper/SmartScreen equivalent — installing just needs <code>sudo</code>.
        </Step>
        <Step n={3} title="Install it">
          Double-click the <code>.deb</code> to open it in your distro's package installer, or from a
          terminal: <code>sudo dpkg -i aavishield-agent-*.deb</code>
        </Step>
        <Step n={4} title="Finish enrolling in the browser">
          A browser tab opens automatically to connect this device to your account. Stay signed in and it
          finishes on its own.
        </Step>
        <Step n={5} title="Check it's running">
          On desktops with tray-icon support you'll see the Aavishield icon. Otherwise, confirm from a
          terminal: <code>systemctl --user status aavishield-agent</code> — or check the portal's My
          Devices page for this device.
        </Step>
      </Steps>

      <h2>Uninstalling the agent</h2>
      <p>Any of these work — pick whichever is easiest to reach:</p>

      <h3>From the running agent (any OS)</h3>
      <p>
        Right-click (or click) the Aavishield tray icon → <strong>Uninstall Aavishield...</strong> This opens
        the portal's Download page, where a per-OS uninstaller is one click away.
      </p>

      <h3>macOS</h3>
      <p>
        Open <strong>Applications</strong> in Finder and double-click <strong>Aavishield Uninstaller</strong> —
        it's installed alongside the agent, so it's there even without opening the portal. It'll ask for
        your Mac login password to remove system files.
      </p>

      <h3>Windows</h3>
      <p>
        <strong>Settings → Apps → Installed apps</strong> → find "Aavishield Agent" → <strong>Uninstall</strong>.
        This is the same MSI uninstall Windows uses for any app, so it's exactly where you'd expect it.
      </p>

      <h3>Linux</h3>
      <p>
        From a terminal: <code>sudo apt remove aavishield-agent</code> (or <code>sudo dpkg -r
        aavishield-agent</code>). Standard package removal — no separate uninstaller needed.
      </p>

      <Callout type="note" title="Also available from the portal">
        The Download page (Employee Portal → Download Agent) has a "Download Uninstaller" button for every
        OS if none of the above are handy — useful if you're helping someone else's device, or the agent
        itself isn't responding.
      </Callout>
    </DocPage>
  );
}

import { DocPage, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/dlp"
      title="Data Loss Prevention"
      description="Stopping sensitive company data — credentials, card numbers, confidential files — from leaving through upload or paste."
      audience="Company"
    >
      <p>
        DLP inspects outbound content — file uploads and pasted text — for patterns that indicate
        sensitive data (things like API keys, access tokens, card numbers, and similar
        detector-defined patterns), then blocks or alerts based on how confident the match is and what
        your policy says to do about it.
      </p>

      <h2>Testing before you enforce</h2>
      <p>
        The DLP page includes a "test a sample" tool — paste in a piece of text and see how it would
        score, without it ever being enforced or logged as a real event. Use this to tune what counts
        as sensitive for your company before turning a rule on for real traffic.
      </p>

      <Callout type="warning" title="DLP needs HTTPS inspection to see most traffic">
        Almost all upload/paste activity today happens over HTTPS. Turn on SSL Inspection (see
        <em> Web Security</em>) or DLP will only catch a small fraction of what actually happens.
      </Callout>

      <h2>Where DLP shows up elsewhere</h2>
      <p>
        Every DLP block or alert is logged as an activity event, and rolls up into the dedicated
        <strong> Data Loss Prevention</strong> report (see <em>Activity &amp; Reports</em>), which lists
        every incident with the file, destination, action taken, and which detector triggered it.
      </p>
    </DocPage>
  );
}

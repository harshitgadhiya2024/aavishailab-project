import { DocPage, FeatureTable, Callout } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/reports"
      title="Activity & Reports"
      description="Nine report types covering everything from an executive summary to policy effectiveness — viewable, exportable, and AI-summarized."
      audience="Company"
    >
      <p>
        Pick a report type and a time window (7 to 365 days) to see it as charts and a data table.
        Every report can be exported as CSV; the on-screen data can also be exported as JSON. There's
        no PDF export.
      </p>

      <FeatureTable
        rows={[
          { name: "Executive Summary", desc: "Headline posture with period-over-period change, employee/device/pending-request counts, daily trend and incidents-by-category charts." },
          { name: "Security Incidents", desc: "Every blocked/alerted event — employee, destination, operation, category, action, policy, risk score." },
          { name: "Data Loss Prevention", desc: "DLP incidents — file, destination, operation, action, policy, score, which detector triggered." },
          { name: "Threats & Malware", desc: "Malware and threat-intel detections, plus high-risk events, sorted by risk." },
          { name: "Shadow IT & SaaS", desc: "Discovered domains with sanction status, usage counts, first/last seen." },
          { name: "Employee Risk", desc: "Incidents ranked per employee, with blocked/DLP counts and their highest risk score." },
          { name: "Device & Agent Coverage", desc: "Every device's OS/version/status/posture, plus employees with no device at all." },
          { name: "Policy Effectiveness", desc: "Every policy with how many times it actually fired — surfaces rules that never trigger." },
          { name: "Access Requests", desc: "Every request with employee, domain, reason, and status." },
        ]}
      />

      <h2>AI briefing</h2>
      <p>
        Each report has an "AI briefing" panel that generates a short narrative summary and
        recommended actions from the report's own aggregate numbers.
      </p>
      <Callout type="note" title="No raw data leaves your report scope">
        The briefing only ever sends aggregate counts and chart data to generate its summary — never
        raw event rows, filenames, or employee identifiers.
      </Callout>
    </DocPage>
  );
}

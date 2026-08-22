import { DocPage, Callout, FeatureTable } from "@/components/DocPage";

export default function Page() {
  return (
    <DocPage
      path="/company/monitoring"
      title="Monitoring & Screenshots"
      description="Optional time and activity tracking — periodic screenshots plus keyboard/mouse activity, grouped into work sessions."
      audience="Company"
    >
      <Callout type="note" title="Off by default">
        This is a deliberate opt-in per organization — installing the agent does not turn on screenshot
        capture by itself. You choose whether to enable it.
      </Callout>

      <h2>How capture works</h2>
      <p>
        When enabled, a screenshot is taken at a random point within a configurable window (default
        1–7 minutes) rather than a fixed interval, so it can't be predicted or timed around. Each
        capture also records keyboard, mouse, and scroll activity for that interval, which rolls up
        into an activity percentage.
      </p>

      <h2>Settings you control</h2>
      <FeatureTable
        rows={[
          { name: "Enabled", desc: "Turns capture on/off for the organization." },
          { name: "Capture interval", desc: "Min/max seconds between screenshots (default 60–420s, minimum 20s)." },
          { name: "Idle threshold", desc: "The activity percentage below which an interval is shown as idle." },
          { name: "Blur", desc: "A lighter-touch mode that proves presence without capturing readable screen content." },
          { name: "Retention", desc: "Days to keep screenshots (default 90; set to 0 to keep forever). A background job enforces this automatically." },
        ]}
      />

      <h2>Reviewing activity</h2>
      <p>
        Pick an employee, a date, and a "day reset" hour (so late-night work lands on the right
        calendar day) to see day totals, an hour-by-hour activity timeline, and session cards with
        screenshot thumbnails you can click to zoom in on.
      </p>

      <Callout type="warning" title="This is admin-only visibility">
        Employees don't see this in their own portal — there's no self-view of screenshot data. Deleting
        a session or an individual screenshot is gated by specific permissions, and the dashboard shows
        you exactly what your own account is allowed to delete.
      </Callout>
    </DocPage>
  );
}

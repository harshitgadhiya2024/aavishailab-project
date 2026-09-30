/**
 * Re-mounts on every navigation, so the CSS fade replays per page. Kept in
 * CSS (not Motion) so the first paint never waits for hydration.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}

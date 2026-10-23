/**
 * A card surface for linked tiles. Hover only warms the border to the brand
 * colour: no cursor-tracking wash and no darkening, anywhere on the site.
 */
export function Spotlight({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`group relative isolate overflow-hidden rounded-[20px] border border-line bg-surface transition-colors duration-300 hover:border-brand/40 ${className}`}>
      {children}
    </div>
  );
}

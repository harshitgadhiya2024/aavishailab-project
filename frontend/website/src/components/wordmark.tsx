import Link from "next/link";

/** Type-only wordmark until the real logo exists. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="DelSecure home" className={`inline-flex items-center gap-2 text-[17px] font-semibold tracking-tight text-fg ${className}`}>
      <span className="relative grid size-6 place-items-center rounded-[7px] bg-invert-bg text-[11px] font-bold text-invert-fg">D</span>
      DelSecure
    </Link>
  );
}

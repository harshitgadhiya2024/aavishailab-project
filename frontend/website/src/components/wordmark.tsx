import Link from "next/link";

/** Type-only wordmark until the real logo exists. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 text-[17px] font-semibold tracking-tight text-fg ${className}`}>
      <span aria-hidden className="relative grid size-6 place-items-center rounded-[7px] bg-brand text-[11px] font-bold text-on-brand">D</span>
      DelSecure
    </Link>
  );
}

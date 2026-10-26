import { cn } from "@/lib/utils";
import { STATUS } from "@/lib/support";

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.open;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-0.5 text-xs font-medium", s.tone, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

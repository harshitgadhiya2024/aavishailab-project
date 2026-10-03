"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PERIOD_LABELS, periodFor, periodText, validateRange, ymd, type Period, type PeriodId } from "@/lib/report-period";

export function PeriodPicker({
  value, onChange, options, allowCustom = true,
}: {
  value: Period;
  onChange: (p: Period) => void;
  options: PeriodId[];
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(value.start);
  const [end, setEnd] = useState(value.end);
  const ref = useRef<HTMLDivElement>(null);
  const error = validateRange(start, end);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const choose = (id: PeriodId) => {
    onChange(periodFor(id));
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setStart(value.start); setEnd(value.end); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground hover:bg-elevated"
      >
        <Calendar className="w-4 h-4 text-subtle" />
        <span className="font-medium">{PERIOD_LABELS[value.id]}</span>
        <span className="text-muted-foreground hidden sm:inline">{periodText(value)}</span>
        <ChevronDown className="w-4 h-4 text-subtle" />
      </button>

      {open && (
        <div role="dialog" className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-border bg-card p-2 shadow-xl">
          {options.map((id) => (
            <button
              key={id}
              onClick={() => choose(id)}
              className={cn(
                "w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-left",
                value.id === id ? "bg-brand-500/10 text-brand-500" : "text-body hover:bg-elevated"
              )}
            >
              <span>{PERIOD_LABELS[id]}</span>
              <span className="flex items-center gap-2 text-xs text-subtle">
                {periodText(periodFor(id))}
                {value.id === id && <Check className="w-3.5 h-3.5 text-brand-500" />}
              </span>
            </button>
          ))}
          {allowCustom && (
            <div className="mt-2 border-t border-border pt-3 px-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">Custom range</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-subtle">
                  From
                  <input type="date" value={start} max={ymd(new Date())} onChange={(e) => setStart(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                </label>
                <label className="text-[11px] text-subtle">
                  To
                  <input type="date" value={end} max={ymd(new Date())} onChange={(e) => setEnd(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
                </label>
              </div>
              {error && start && end && <p className="mt-2 text-xs text-danger">{error}</p>}
              <button
                disabled={!!error}
                onClick={() => { onChange(periodFor("custom", { start, end })); setOpen(false); }}
                className="mt-3 w-full rounded-lg bg-brand-500 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Apply range
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

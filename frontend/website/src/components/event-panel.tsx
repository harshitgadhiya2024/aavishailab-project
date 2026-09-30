"use client";

import { CheckCircle, Prohibit, WarningCircle } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { Module } from "@/lib/content";

const STATE = {
  blocked: { I: Prohibit, cls: "text-danger", label: "Blocked" },
  flagged: { I: WarningCircle, cls: "text-brand-ink", label: "Flagged" },
  allowed: { I: CheckCircle, cls: "text-muted", label: "Allowed" },
} as const;

/** Example events for a module, arriving one after another. */
export function EventPanel({ title, events }: { title: string; events: Module["events"] }) {
  const reduce = useReducedMotion();
  return (
    <div className="glass rounded-[24px] p-4 md:p-5" aria-label={`Example ${title} events`}>
      <div className="flex items-center justify-between px-2 pb-4">
        <span className="text-sm font-medium text-fg">{title}</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-signal">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-signal" />
            <span className="relative size-1.5 rounded-full bg-signal" />
          </span>
          example events
        </span>
      </div>
      <ul className="grid gap-2">
        {events.map((e, i) => {
          const s = STATE[e.state];
          return (
            <motion.li
              key={e.label}
              initial={reduce ? false : { opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 180, damping: 22, delay: 0.5 + i * 0.35 }}
              className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-3.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-fg">{e.label}</span>
                <span className="block truncate text-[12.5px] text-muted">{e.detail}</span>
              </span>
              <span className={`flex shrink-0 items-center gap-1.5 text-[12px] font-medium ${s.cls}`}>
                <s.I size={15} weight="fill" />
                {s.label}
              </span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

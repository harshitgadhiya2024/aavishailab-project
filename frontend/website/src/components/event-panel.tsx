"use client";

import { motion, useReducedMotion } from "motion/react";
import type { Module } from "@/lib/content";
import { LiveDot, StatePill, UiCard } from "./landing/visuals";

/** Example events for a module, arriving one after another, as a landing-page UI card. */
export function EventPanel({ title, events, className = "" }: { title: string; events: Module["events"]; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <UiCard
      title={title}
      meta={
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
          <LiveDot /> Example events
        </span>
      }
      className={className}
    >
      <ul className="grid">
        {events.map((e, i) => (
          <motion.li
            key={e.label}
            initial={reduce ? false : { opacity: 0, x: 16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ type: "spring", stiffness: 200, damping: 24, delay: 0.3 + i * 0.25 }}
            className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-fg">{e.label}</span>
              <span className="block truncate text-[11.5px] text-muted">{e.detail}</span>
            </span>
            <StatePill state={e.state} />
          </motion.li>
        ))}
      </ul>
    </UiCard>
  );
}

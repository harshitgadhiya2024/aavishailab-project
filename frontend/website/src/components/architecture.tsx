"use client";

import { Cpu, Desktop, HardDrives, ShieldCheck } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";

const nodes = [
  { I: Desktop, title: "Agent on the device", body: "Local HTTPS proxy enforces policy on every request, upload and download." },
  { I: ShieldCheck, title: "Control plane", body: "Holds your policy, signs it, and receives every event the agents report." },
  { I: Cpu, title: "Scanning services", body: "Dedicated DLP and malware services inspect files as they stream." },
  { I: HardDrives, title: "Admin console", body: "One place to set policy and review what happened, per person and device." },
];

/** Four-stage flow whose connectors draw themselves as the row enters view. */
export function Architecture() {
  const reduce = useReducedMotion();
  return (
    <div className="relative grid gap-4 md:grid-cols-4 md:gap-6">
      <svg className="pointer-events-none absolute left-0 right-0 top-[44px] hidden h-2 w-full md:block" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden>
        <motion.line
          x1="12" y1="1" x2="88" y2="1"
          stroke="var(--brand)" strokeWidth="0.3" strokeDasharray="0.8 0.8"
          initial={reduce ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 1.6, ease: [0.65, 0, 0.35, 1] }}
        />
      </svg>
      {nodes.map(({ I, title, body }, i) => (
        <motion.div
          key={title}
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.8, delay: 0.2 + i * 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <div className={`relative z-[1] grid size-[88px] place-items-center rounded-full border ${i === 0 ? "border-transparent bg-brand text-on-brand shadow-[0_20px_50px_-15px_rgb(255_112_0/0.7)]" : "border-line bg-surface text-fg"}`}>
            <I size={30} weight="light" />
          </div>
          <h3 className="mt-6 text-lg font-semibold tracking-tight text-fg">{title}</h3>
          <p className="mt-2 max-w-[30ch] text-sm leading-relaxed text-muted">{body}</p>
        </motion.div>
      ))}
    </div>
  );
}

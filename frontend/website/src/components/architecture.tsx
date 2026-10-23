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
      {nodes.map(({ I, title, body }, i) => (
        <motion.div
          key={title}
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.8, delay: 0.2 + i * 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          {i < nodes.length - 1 && (
            // Connector from this icon's right edge to the next icon's left edge (across the 1.5rem gap).
            <span aria-hidden className="pointer-events-none absolute left-[88px] top-[44px] hidden h-px w-[calc(100%-88px+1.5rem)] md:block">
              <motion.span
                className="absolute inset-0 origin-left bg-brand/50"
                initial={reduce ? false : { scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.7, delay: 0.5 + i * 0.35, ease: [0.65, 0, 0.35, 1] }}
              />
              {!reduce && (
                <motion.span
                  className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-brand"
                  initial={{ left: "0%", opacity: 0 }}
                  animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 2.2, delay: 1.6 + i * 0.5, repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut" }}
                />
              )}
            </span>
          )}
          <div className={`relative z-[1] grid size-[88px] place-items-center rounded-[6px] border ${i === 0 ? "border-transparent bg-brand text-on-brand" : "border-line bg-surface text-fg"}`}>
            <I size={30} weight="light" />
          </div>
          <h3 className="mt-6 text-lg font-normal tracking-tight text-fg">{title}</h3>
          <p className="mt-2 max-w-[30ch] text-sm leading-relaxed text-muted">{body}</p>
        </motion.div>
      ))}
    </div>
  );
}

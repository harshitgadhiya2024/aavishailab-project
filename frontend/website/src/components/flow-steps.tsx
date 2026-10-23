"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ModuleSlug } from "@/lib/content";
import { Label } from "./landing/grid";
import { StepArt } from "./step-art";

export type ArtItem = { title: string; body?: string; list?: string[]; muted?: boolean; art: { slug: ModuleSlug; kind: number } };

const COLS: Record<number, string> = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 lg:grid-cols-4" };

/**
 * A full-width black band (like Early Access on the landing page) in the
 * site's hairline-grid style: a heading, then one bordered block of cells,
 * each with a line-art animation (see StepArt), a number, a title and a line
 * of text. The animations run continuously while on screen.
 */
export function ArtBand({ label, title, accent, aside, items }: { label: string; title: string; accent?: string; aside?: string; items: ArtItem[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="bg-ink px-5 py-16 text-ink-fg sm:px-8 md:px-12 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Label invert>{label}</Label>
          <h2 className="mt-5 max-w-[22ch] text-[2rem] font-normal leading-[1.08] tracking-[-0.03em] md:text-[2.6rem]">
            {title}
            {accent && <span className="text-brand"> {accent}</span>}
          </h2>
        </div>
        {aside && <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-fg/45">{aside}</p>}
      </div>

      <ol className={`mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-white/10 bg-white/10 ${COLS[items.length] ?? "md:grid-cols-3"}`}>
        {items.map((s, i) => (
          // The cell stays solid black; only its contents fade in, so the grid lines never flash grey.
          <li key={s.title} className="relative bg-ink p-7 md:p-9">
            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, delay: i * 0.12 }}
            >
            <div className="mx-auto mb-8 aspect-square w-full max-w-[200px]">
              <StepArt slug={s.art.slug} kind={s.art.kind} />
            </div>
            <span className="font-mono text-[11px] text-brand">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-5 text-[1.5rem] font-normal tracking-[-0.02em] text-ink-fg">{s.title}</h3>
            {s.body && <p className="mt-3 max-w-[38ch] text-[15px] leading-relaxed text-ink-fg/55">{s.body}</p>}
            {s.list && (
              <ul className="mt-4 grid gap-2.5">
                {s.list.map((x) => (
                  <li key={x} className="flex gap-3 text-[15px] leading-relaxed text-ink-fg/70">
                    <span className={`mt-[9px] size-1.5 shrink-0 ${s.muted ? "bg-ink-fg/35" : "bg-brand"}`} />
                    {x}
                  </li>
                ))}
              </ul>
            )}
            </motion.div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** "Under the hood" on the feature pages: the control's own three steps, each with its own art. */
export function FlowSteps({ slug, name, steps }: { slug: ModuleSlug; name: string; steps: { verb: string; body: string }[] }) {
  return (
    <ArtBand
      label="Under the hood"
      title={`How ${name}`}
      accent="works."
      aside="On the device · against signed policy"
      items={steps.map((s, i) => ({ title: s.verb, body: s.body, art: { slug, kind: i } }))}
    />
  );
}

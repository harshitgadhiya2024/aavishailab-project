"use client";

import { Check, Info } from "@phosphor-icons/react";
import { useState } from "react";
import { GridButton } from "./landing/grid-button";
import { Label } from "./landing/grid";

import { SMALL_PLAN_MAX, plans } from "@/lib/pricing";

const SLIDER_MAX = 100;

export function PricingPlans() {
  const [devices, setDevices] = useState(25);
  const large = devices > SMALL_PLAN_MAX;
  // The plan we point to: Business for up to 50 devices, Enterprise above.
  const pick = large ? "Enterprise" : "Business";
  const label = devices >= SLIDER_MAX ? `${SLIDER_MAX}+` : String(devices);

  return (
    <div>
      {/* Device count */}
      <div className="pixel-grid rounded-[6px] border border-brand/20 bg-brand-soft p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Label>How many devices?</Label>
            <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-fg-2">
              Count every laptop and desktop that will run the agent: Mac, Windows or Linux. Plans for up to {SMALL_PLAN_MAX} devices; Enterprise above that.
            </p>
          </div>
          <label className="flex items-baseline gap-3">
            <span className="sr-only">Number of devices</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              value={devices}
              onChange={(e) => setDevices(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))}
              className="w-28 rounded-[6px] border border-line-strong bg-surface px-3 py-2 text-right font-mono text-3xl tabular-nums text-fg focus:border-brand focus:outline-none"
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">devices</span>
          </label>
        </div>
        <input
          type="range"
          min={1}
          max={SLIDER_MAX}
          value={Math.min(devices, SLIDER_MAX)}
          onChange={(e) => setDevices(Number(e.target.value))}
          aria-label="Number of devices"
          className="mt-6 w-full accent-[var(--brand)]"
        />
        <div className="mt-2 flex justify-between font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">
          <span>1</span>
          <span className={large ? "text-muted" : "text-brand-ink"}>Up to {SMALL_PLAN_MAX} · Essentials or Business</span>
          <span className={large ? "text-brand-ink" : "text-muted"}>{SMALL_PLAN_MAX + 1}+ · Enterprise</span>
        </div>
      </div>

      {/* Plans */}
      <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-line bg-line lg:grid-cols-3">
        {plans.map((p) => {
          const fits = "max" in p ? devices <= p.max : devices >= p.min;
          const chosen = p.name === pick;
          return (
            <div key={p.name} className={`relative flex flex-col p-7 transition-colors duration-300 md:p-8 ${chosen ? "bg-surface" : "bg-bg"} ${fits ? "" : "opacity-55"}`}>
              {chosen && <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-brand" />}
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-normal tracking-[-0.02em] text-fg">{p.name}</h2>
                {chosen && <span className="rounded-[4px] bg-brand px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-on-brand">For {label} devices</span>}
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-brand-ink">{p.range}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{p.for}</p>
              <p className="mt-8 font-display text-3xl tracking-[-0.02em] text-fg">Custom quote</p>
              <p className="mt-1 text-sm text-muted">per device, billed annually</p>
              <ul className="mb-10 mt-8 grid gap-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-[15px] text-fg-2">
                    <Check size={15} weight="bold" className="shrink-0 text-brand" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                {fits ? (
                  <GridButton href="/contact" variant={chosen ? "solid" : "ghost"} className="w-full justify-center">
                    Get a quote for {label} devices
                  </GridButton>
                ) : (
                  <p className="flex items-start gap-2 rounded-[4px] border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">
                    <Info size={15} className="mt-0.5 shrink-0" />
                    {"max" in p ? `More than ${SMALL_PLAN_MAX} devices? Choose Enterprise.` : `Enterprise starts at ${SMALL_PLAN_MAX + 1} devices.`}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

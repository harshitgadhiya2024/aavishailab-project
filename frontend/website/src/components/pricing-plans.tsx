"use client";

import { Check, Info } from "@phosphor-icons/react";
import { type CSSProperties, useState } from "react";
import { GridButton } from "./landing/grid-button";
import { Label } from "./landing/grid";

import { trialHref } from "@/lib/content";
import { CURRENCIES, type Currency, type Pricing, TAX_NOTE, formatPrice, minDevices, monthlyPrice, rangeLabel } from "@/lib/pricing";

const SLIDER_MAX = 100;

/**
 * Plan cards with a device picker. `pricing` comes from the superadmin panel;
 * `currency` is chosen on the server from the visitor's country, and the
 * toggle lets anyone switch.
 */
export function PricingPlans({ pricing, currency: initial }: { pricing: Pricing; currency: Currency }) {
  const { plans, settings } = pricing;
  const [devices, setDevices] = useState(25);
  const [currency, setCurrency] = useState<Currency>(initial);
  const fmt = (n: number) => formatPrice(n, currency);

  const minAll = minDevices(plans);
  const limited = plans.filter((p) => p.max);
  const open = plans.find((p) => !p.max);
  const smallMax = Math.max(0, ...limited.map((p) => p.max ?? 0));
  const large = smallMax > 0 && devices > smallMax;
  const label = devices >= SLIDER_MAX ? `${SLIDER_MAX}+` : String(devices);
  // Fewer than the minimum are billed as the minimum.
  const billed = Math.max(devices, minAll);

  // A plan fits when the device count is inside its range. Below the smallest
  // minimum, the entry plans still fit (they are billed at their minimum).
  const fitsPlan = (p: (typeof plans)[number]) => (p.max === null || devices <= p.max) && (devices >= p.min || p.min <= minAll);
  const fitting = plans.filter(fitsPlan);
  // The plan we point to: the popular one when it fits, otherwise the plan built for the largest fleets that fits.
  const pick = fitting.find((p) => p.popular) ?? fitting.reduce<(typeof plans)[number] | undefined>((a, b) => (!a || b.min > a.min ? b : a), undefined);

  return (
    <div>
      {/* Device count */}
      <div className="pixel-grid rounded-[6px] border border-brand/20 bg-brand-soft p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Label>How many devices?</Label>
            <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-fg-2">
              Count every laptop and desktop that will run the agent: Mac, Windows or Linux. Plans start at {minAll} devices
              {open && smallMax > 0 ? `; ${open.name} is for more than ${smallMax}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div role="group" aria-label="Currency" className="flex rounded-[6px] border border-line-strong bg-surface p-0.5 font-mono text-[12px]">
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  onClick={() => setCurrency(c)}
                  className={`rounded-[4px] px-3 py-1.5 transition-colors ${currency === c ? "bg-brand text-on-brand" : "text-muted hover:text-fg"}`}
                >
                  {c === "INR" ? "₹ INR" : "$ USD"}
                </button>
              ))}
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
          {limited.length > 0 && (
            <span className={large ? "text-muted" : "text-brand-ink"}>
              {minAll} to {smallMax} · {limited.map((p) => p.name).join(" or ")}
            </span>
          )}
          {open && smallMax > 0 && (
            <span className={large ? "text-brand-ink" : "text-muted"}>
              {smallMax + 1}+ · {open.name}
            </span>
          )}
        </div>
      </div>

      {/* Plans. On wide screens each card spans 6 shared rows (subgrid), so the
          name, price, estimate, features and button line up across every card. */}
      <div
        style={{ "--cols": plans.length } as CSSProperties}
        className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-line bg-line lg:grid-rows-[repeat(6,auto)] lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
      >
        {plans.map((p) => {
          const fits = fitsPlan(p);
          const chosen = p.key === pick?.key;
          const dim = fits ? "" : "opacity-60";
          // The yearly estimate uses the nearest device count this plan is sold for.
          const n = Math.min(p.max ?? Infinity, Math.max(p.min, billed));
          return (
            <div
              key={p.key}
              className={`relative flex flex-col p-7 transition-colors duration-300 md:p-8 lg:row-span-6 lg:grid lg:grid-rows-subgrid lg:gap-0 ${chosen ? "bg-surface" : "bg-bg"}`}
            >
              {chosen && <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-brand" />}

              {/* 1. Tags (a fixed-height row, empty when there are none) and name */}
              <div>
                <div className="flex h-6 flex-wrap gap-1.5">
                  {p.popular && <span className="rounded-[4px] border border-brand/30 px-2 py-1 font-mono text-[10.5px] uppercase leading-none tracking-[0.06em] text-brand-ink">Most popular</span>}
                  {chosen && <span className="rounded-[4px] bg-brand px-2 py-1 font-mono text-[10.5px] uppercase leading-none tracking-[0.06em] text-on-brand">For {label} devices</span>}
                </div>
                <h2 className={`mt-3 text-2xl font-normal tracking-[-0.02em] text-fg ${dim}`}>{p.name}</h2>
              </div>

              {/* 2. Who it is for */}
              <div className={`mt-2 ${dim}`}>
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-brand-ink">{rangeLabel(p)}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted">{p.for}</p>
              </div>

              {/* 3. Price */}
              <div className={`mt-8 ${dim}`}>
                <p className="flex items-baseline gap-2 text-fg">
                  {p.from && <span className="text-sm text-muted">From</span>}
                  <span className="font-display text-4xl tracking-[-0.02em]">{fmt(p.price[currency])}</span>
                  <span className="text-sm text-muted">/ device / year</span>
                </p>
                <p className="mt-1.5 text-sm text-muted">Billed annually, {TAX_NOTE[currency]}</p>
                <p className="mt-0.5 text-[13px] text-muted">or {fmt(monthlyPrice(p.price[currency], currency, settings))} / device / month, billed monthly</p>
              </div>

              {/* 4. Yearly estimate, always shown */}
              <p className={`mt-4 rounded-[4px] px-3 py-2.5 text-[13px] leading-relaxed ${fits ? "bg-bg-2 text-fg-2" : "border border-dashed border-line-strong text-muted"}`}>
                {p.from ? "From " : ""}
                <span className="font-medium text-fg">{fmt(p.price[currency] * n)}</span> a year for {n} devices
                <span className="block text-muted">
                  {currency === "INR" ? `${fmt(p.price.INR * n * (1 + settings.gstPercent / 100))} including ${settings.gstPercent}% GST` : "Before any applicable taxes"}
                  {fits && devices < p.min ? ` · minimum ${p.min} devices` : ""}
                </span>
              </p>

              {/* 5. Features */}
              <ul className={`mb-10 mt-8 grid content-start gap-3 ${dim}`}>
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-[15px] text-fg-2">
                    <Check size={15} weight="bold" className="shrink-0 text-brand" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* 6. Action, pinned to the bottom */}
              <div className="mt-auto lg:self-end">
                {fits ? (
                  // Essentials and Business sign up on their own; Enterprise talks to sales.
                  p.key === "starter" || p.key === "professional" ? (
                    <GridButton href={trialHref(p.key === "starter" ? "essentials" : "business")} variant={chosen ? "solid" : "ghost"} className="w-full justify-center">
                      Start 14-day free trial
                    </GridButton>
                  ) : (
                    <GridButton href="/contact" variant={chosen ? "solid" : "ghost"} className="w-full justify-center">
                      {p.from ? `Get a quote for ${label} devices` : settings.pilotDays > 0 ? `Start a free ${settings.pilotDays}-day pilot` : "Get started"}
                    </GridButton>
                  )
                ) : (
                  <p className="flex items-start gap-2 rounded-[4px] border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">
                    <Info size={15} className="mt-0.5 shrink-0" />
                    {p.max !== null && devices > p.max ? `More than ${p.max} devices? Choose ${open?.name ?? "a larger plan"}.` : `${p.name} starts at ${p.min} devices.`}
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

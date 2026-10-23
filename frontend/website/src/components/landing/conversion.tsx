import {
  ArrowRight,
  ChatsCircle,
  CheckCircle,
  Database,
  Eye,
  Fingerprint,
  LinkSimple,
  Signature,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { CTA } from "@/lib/content";
import { Reveal } from "../motion/reveal";
import { EarlyArt } from "./early-art";
import { GridButton } from "./grid-button";
import { GridHeading, Label } from "./grid";

/*
 * Conversion blocks for the landing page. Aavishield is newly launched, so
 * trust comes from the product, the way it is built, and the team rather
 * than customer logos. Every statement here is already on the public FAQ
 * or Security pages; keep it that way when editing.
 */

/** One line of risk reducers under a call to action. */
export function Reassurance({ className = "", invert = false }: { className?: string; invert?: boolean }) {
  const items = ["Start with a small pilot group", "No hardware or network changes", "macOS, Windows and Linux"];
  return (
    <ul className={`flex flex-wrap gap-x-5 gap-y-2 text-[13px] ${invert ? "text-ink-fg/70" : "text-fg-2"} ${className}`}>
      {items.map((t) => (
        <li key={t} className="flex items-center gap-1.5">
          <CheckCircle size={14} weight="fill" className="text-brand" />
          {t}
        </li>
      ))}
    </ul>
  );
}

/** A slim call to action between long sections. */
export function MidCta({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-6 bg-brand-soft px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between md:px-12">
      <div>
        <p className="font-display text-[1.6rem] leading-tight tracking-[-0.025em] text-fg md:text-[1.9rem]">{title}</p>
        <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">{body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-3">
        <GridButton href="/contact">{CTA.demo}</GridButton>
        <GridButton href="/pricing" variant="ghost">See pricing</GridButton>
      </div>
    </div>
  );
}

const SAFEGUARDS = [
  { I: Signature, title: "Signed policy", body: "Policy bundles are signed with Ed25519 and verified on the device before they are enforced." },
  { I: UsersThree, title: "Isolated per company", body: "Every organisation's policy, devices and findings are scoped to that organisation and never mixed." },
  { I: Database, title: "Data residency", body: "Keep employee data in your own database and storage bucket, set from Settings." },
  { I: Eye, title: "Monitor-only DLP", body: "Data loss prevention records findings and never blocks anyone's work." },
  { I: Fingerprint, title: "Two-factor for every admin", body: "Every sign-in needs a second factor: an emailed code or an authenticator app." },
  { I: LinkSimple, title: "Short-lived signed links", body: "Screenshots and files are only served through expiring links, to admins of the same organisation." },
];

/** "How we protect your data": the safeguards a buyer will ask about. */
export function TrustSection() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6 px-5 py-16 sm:px-8 md:px-12 md:pb-12 md:pt-20">
        <GridHeading
          label="Security of our own"
          title="How We Protect Your Data"
          body="A security product has to earn trust first. These safeguards are built into Aavishield from day one."
        />
        <Reveal>
          <GridButton href="/security" variant="ghost">Read the security overview</GridButton>
        </Reveal>
      </div>
      <div className="grid grid-cols-1 border-t border-line sm:grid-cols-2 lg:grid-cols-3">
        {SAFEGUARDS.map(({ I, title, body }, i) => (
          <Reveal
            key={title}
            delay={(i % 3) * 0.06}
            className={`border-line px-5 py-8 sm:px-8 md:px-10 ${i < SAFEGUARDS.length - 1 ? "border-b" : ""} sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0 sm:[&:nth-child(odd)]:border-r lg:[&:nth-child(odd)]:border-r-0 lg:[&:not(:nth-child(3n))]:border-r`}
          >
            <span className="grid size-9 place-items-center rounded-[4px] border border-brand/30 bg-brand-soft text-brand-ink">
              <I size={18} />
            </span>
            <h3 className="mt-5 text-lg font-normal tracking-[-0.015em] text-fg">{title}</h3>
            <p className="mt-2 max-w-[38ch] text-sm leading-relaxed text-muted">{body}</p>
          </Reveal>
        ))}
      </div>
    </>
  );
}

/** Early access: being new framed as direct access to the team. */
export function EarlyAccess() {
  const points = [
    "A direct line to the engineers who build Aavishield",
    "Your feedback shapes what we build next",
    "Start with a small pilot group before rolling out",
    "Everything shown is something the product does today",
  ];
  return (
    <div className="grid items-center gap-10 bg-ink px-5 py-16 text-ink-fg sm:px-8 md:grid-cols-[1fr_1.1fr] md:gap-16 md:px-12 md:py-20">
      <Reveal>
        <Label invert>Early access</Label>
        <h2 className="mt-6 max-w-[16ch] text-[2rem] font-normal leading-[1.08] tracking-[-0.03em] md:text-[2.6rem]">
          Be One Of Our <span className="text-brand">First Customers</span>
        </h2>
        <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-ink-fg/65">
          Aavishield has just launched. Early customers work directly with the team at Aavish AI Lab that builds it, from the first pilot onward.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <GridButton href="/contact" icon={ChatsCircle}>Talk to the team</GridButton>
          <GridButton href="/faq" variant="ghost" invert>Read the FAQ</GridButton>
        </div>
      </Reveal>
      <Reveal delay={0.1}>
        {/* Same hairline grid and line art as "Under the hood" on the feature pages. */}
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-white/10 bg-white/10 sm:grid-cols-2">
          {points.map((p, i) => (
            <li key={p} className="flex flex-col bg-ink p-6 md:p-7">
              <span className="size-16">
                <EarlyArt kind={i} />
              </span>
              <span className="mt-6 font-mono text-[11px] text-brand">{String(i + 1).padStart(2, "0")}</span>
              <span className="mt-2 text-[16px] leading-snug text-ink-fg">{p}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

export const OBJECTIONS = [
  { q: "Do we need an appliance, VPN or network change?", a: "No. Enforcement happens on the device, so it works on any network with nothing to route." },
  { q: "How long does it take to get started?", a: "A pilot can be live in an afternoon. A company-wide rollout typically takes two to three weeks." },
  { q: "Will DLP block our employees' work?", a: "No. DLP is monitor-only. It records what sensitive data left and where, without interrupting work." },
  { q: "Is every employee screen-recorded?", a: "No. Aavishield takes periodic screenshots, not recordings, and only on devices your organisation chooses to monitor." },
  { q: "Who can see the data?", a: "Only authorised admins of your organisation. Data is never shared across organisations or sold." },
  { q: "How is Aavishield priced?", a: "Per enrolled device, billed annually. Essentials and Business cover up to 50 devices; Enterprise is for more than 50. Book a demo for a quote." },
];

/** The questions buyers ask before a pilot, answered side by side (no accordion). */
export function Objections() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6 px-5 py-16 sm:px-8 md:px-12 md:pb-12 md:pt-20">
        <GridHeading label="Before you roll out" title="Questions Teams Ask First" />
        <Reveal>
          <Link href="/faq" className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg underline decoration-fg/40 underline-offset-4 hover:text-brand-ink">
            All questions <ArrowRight size={12} />
          </Link>
        </Reveal>
      </div>
      <dl className="grid grid-cols-1 border-t border-line md:grid-cols-2">
        {OBJECTIONS.map((o, i) => (
          <Reveal key={o.q} delay={(i % 2) * 0.06} className={`border-line px-5 py-7 sm:px-8 md:px-12 ${i < OBJECTIONS.length - 1 ? "border-b" : ""} md:[&:nth-last-child(-n+2)]:border-b-0 md:[&:nth-child(odd)]:border-r`}>
            <dt className="flex gap-3 text-[17px] tracking-[-0.01em] text-fg">
              <span className="mt-0.5 font-mono text-[12px] text-brand-ink">{String(i + 1).padStart(2, "0")}</span>
              {o.q}
            </dt>
            <dd className="mt-2 pl-8 text-sm leading-relaxed text-muted">{o.a}</dd>
          </Reveal>
        ))}
      </dl>
    </>
  );
}

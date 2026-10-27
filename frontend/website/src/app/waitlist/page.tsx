import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { ArtBand } from "@/components/flow-steps";
import { DitherField } from "@/components/landing/dither-field";
import { EarlyArt } from "@/components/landing/early-art";
import { GridButton } from "@/components/landing/grid-button";
import { GridRow, H1Kicker, Label } from "@/components/landing/grid";
import { Enter } from "@/components/motion/enter";
import { Reveal } from "@/components/motion/reveal";
import { WaitlistForm } from "@/components/prelaunch/waitlist-form";
import { modules } from "@/lib/content";
import { Wordmark } from "@/components/wordmark";

/*
 * The prelaunch page: a one-page site of its own (no website menu or footer,
 * see components/site-chrome.tsx) built from the website's parts. Sign-ups go
 * to /api/waitlist -> admin-api, and the team manages them in the superadmin
 * panel under Waitlist. Product statements here are ones the website already
 * makes; keep it that way when editing.
 */

export const metadata: Metadata = {
  title: "Early Access Waitlist",
  description:
    "Join the Aavishield early access waitlist: endpoint security, web filtering, DLP and app control for every laptop, set up with the team that builds it.",
  alternates: { canonical: "/waitlist" },
};

const STEPS = [
  { title: "Join the waitlist", body: "Tell us about your team. It takes under a minute, and you get a confirmation by email." },
  { title: "We open your spot", body: "We bring teams on in small groups. When it's your turn, you get an invitation to create your organization." },
  { title: "Protect the first laptops", body: "Install the agent, switch on a policy and watch it work. A pilot can be live in an afternoon." },
];

const PERKS = [
  "A direct line to the engineers who build Aavishield",
  "Your feedback shapes what we build next",
  "Start with a small pilot group before rolling out",
  "Everything shown is something the product does today",
];

const FAQ = [
  { q: "When will I get access?", a: "We're opening Aavishield to teams in small groups so each one is set up properly. You'll get an email the moment your spot opens." },
  { q: "Does it cost anything to join?", a: "No. Joining the waitlist is free and doesn't commit you to anything." },
  { q: "What does Aavishield cover?", a: "One agent on macOS, Windows and Linux enforces web filtering, data loss prevention, app and VPN control, malware scanning and device posture." },
  { q: "Do we need an appliance or network change?", a: "No. Enforcement happens on the device, so it works on any network with nothing to route." },
  { q: "What happens to the details I share?", a: "We use them only to plan early access and to contact you about it. See our privacy policy for the details." },
];

export default function WaitlistPage() {
  return (
    <>
      <PrelaunchHeader />

      <div className="site-frame">
        {/* 1. Hero: the promise on the left, the sign-up form on the right, the
            pixel terrain as one full-width band underneath both. */}
        <GridRow className="overflow-hidden">
          <div className="relative">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[150px] md:h-[200px]" aria-hidden>
              <DitherField variant="band" />
            </div>
            {/* Three grid items: copy, form, stat tiles. On phones they stack in that
                order, so the form comes right after the promise; from lg the form
                takes the right column beside the copy and the tiles. */}
            <div className="relative z-10 grid gap-x-16 gap-y-10 px-5 pb-[170px] pt-14 sm:px-8 md:px-12 md:pb-[220px] md:pt-20 lg:grid-cols-[1.1fr_1fr] lg:grid-rows-[auto_auto] xl:pt-24">
              <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
                <h1 className="enter text-[2.6rem] font-normal leading-[1.02] tracking-[-0.04em] text-fg sm:text-[3.5rem] xl:text-[4.25rem]">
                  <H1Kicker>Prelaunch · Early access program</H1Kicker>
                  <span className="block">Security for every laptop.</span>
                  <span className="block text-brand">Opening soon.</span>
                </h1>
                <Enter delay={0.15}>
                  <p className="mt-8 max-w-[46ch] text-base leading-relaxed text-fg-2 [text-wrap:pretty] md:text-[17px]">
                    Aavishield enforces web, data and app policy on every device, on any network, and shows you everything it blocks.
                    Join the waitlist to be among the first teams to use it.
                  </p>
                </Enter>
              </div>
              <Enter delay={0.3} className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
                <WaitlistForm />
              </Enter>
              <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
                <Enter delay={0.25}>
                  <ul className="grid max-w-[520px] grid-cols-3 gap-px overflow-hidden rounded-[6px] border border-line bg-line">
                    {[
                      { k: "Free", v: "to join, no commitment" },
                      { k: "3 OS", v: "macOS, Windows, Linux" },
                      { k: "1:1", v: "onboarding with our team" },
                    ].map((t) => (
                      <li key={t.k} className="bg-bg px-3 py-3 sm:px-4 sm:py-3.5">
                        <span className="block font-display text-[1.35rem] font-medium tracking-[-0.02em] text-fg">{t.k}</span>
                        <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{t.v}</span>
                      </li>
                    ))}
                  </ul>
                </Enter>
              </div>
            </div>
          </div>
        </GridRow>

        {/* 1b. Everything the one agent covers, as a slow strip. */}
        <GridRow>
          <div className="group overflow-hidden py-6 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
            <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
              {[0, 1].map((copy) => (
                <ul key={copy} aria-hidden={copy === 1} className="flex shrink-0 items-center gap-12 pr-12">
                  {modules.map((m) => (
                    <li key={m.slug} className="flex items-center gap-3 whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.1em] text-fg-2">
                      <span className="size-1.5 bg-brand" />
                      {m.name}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </GridRow>

        {/* 2. What it does: the website's animated control stories. */}
        <GridRow>
          <ArtBand
            label="What you get"
            title="One agent."
            accent="Every control."
            aside="Live on macOS, Windows and Linux"
            items={[
              { title: "Web filtering", body: "Block risky and off-policy sites on any network, at home or in the office.", art: { slug: "web-gateway", kind: 1 } },
              { title: "Data loss prevention", body: "See where sensitive data goes, without getting in the way of work.", art: { slug: "data-loss-prevention", kind: 1 } },
              { title: "App and VPN control", body: "Stop unapproved apps and VPN bypasses right on the device.", art: { slug: "application-control", kind: 1 } },
              { title: "Device health", body: "Know every laptop's encryption, firewall and update status.", art: { slug: "device-posture", kind: 0 } },
            ]}
          />
        </GridRow>

        {/* 3. How early access works. */}
        <GridRow>
          <div className="px-5 py-16 sm:px-8 md:px-12 md:py-20">
            <Reveal>
              <Label>How early access works</Label>
              <h2 className="mt-5 max-w-[20ch] text-[2rem] font-normal leading-[1.08] tracking-[-0.03em] text-fg md:text-[2.6rem]">
                From the list to your first protected laptop.
              </h2>
            </Reveal>
            <ol className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-line bg-line md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="bg-bg p-7 md:p-9">
                  <Reveal delay={i * 0.08}>
                    <span className="font-mono text-[11px] text-brand-ink">{String(i + 1).padStart(2, "0")}</span>
                    <h3 className="mt-4 text-[1.35rem] font-normal tracking-[-0.02em] text-fg">{s.title}</h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-fg-2">{s.body}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </GridRow>

        {/* 4. Why join early: the same points as the website's Early access band. */}
        <GridRow>
          <div className="grid items-center gap-10 bg-ink px-5 py-16 text-ink-fg sm:px-8 md:grid-cols-[1fr_1.1fr] md:gap-16 md:px-12 md:py-20">
            <Reveal>
              <Label invert>Why join early</Label>
              <h2 className="mt-6 max-w-[16ch] text-[2rem] font-normal leading-[1.08] tracking-[-0.03em] md:text-[2.6rem]">
                Be one of our <span className="text-brand">first teams.</span>
              </h2>
              <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-ink-fg/65">
                Early access teams work directly with the people at Aavish AI Lab who build Aavishield, from the first pilot onward.
              </p>
              <div className="mt-8">
                <GridButton href="#join">Join the waitlist</GridButton>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-white/10 bg-white/10 sm:grid-cols-2">
                {PERKS.map((p, i) => (
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
        </GridRow>

        {/* 5. Questions. */}
        <GridRow>
          <div className="grid gap-10 px-5 py-16 sm:px-8 md:grid-cols-[0.8fr_1.2fr] md:gap-16 md:px-12 md:py-20">
            <Reveal>
              <Label>Questions</Label>
              <h2 className="mt-5 max-w-[14ch] text-[2rem] font-normal leading-[1.08] tracking-[-0.03em] text-fg md:text-[2.6rem]">
                Before you join.
              </h2>
            </Reveal>
            <dl className="divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <div key={f.q} className="py-6">
                  <dt className="text-[17px] font-medium text-fg">{f.q}</dt>
                  <dd className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-fg-2">
                    {f.a}
                    {f.q.startsWith("What happens") && (
                      <>
                        {" "}
                        <Link href="/privacy-policy" className="text-brand-ink underline underline-offset-2">Privacy policy</Link>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </GridRow>

        {/* 6. Closing call to action over the pixel terrain. */}
        <section className="grid-band overflow-hidden">
          <div className="relative min-h-[420px] md:min-h-[480px]">
            <div className="absolute inset-x-0 bottom-0 h-[55%]" aria-hidden>
              <DitherField variant="band" />
            </div>
            <div className="relative z-10 px-5 pb-12 pt-14 sm:px-8 md:px-12 md:pt-20">
              <Label>Early access</Label>
              <h2 className="mt-5 max-w-[18ch] text-[2.4rem] font-normal leading-[1] tracking-[-0.045em] text-fg md:text-[4rem]">
                Get Aavishield before everyone else.
              </h2>
              <div className="mt-8">
                <GridButton href="#join">Join the waitlist</GridButton>
              </div>
            </div>
          </div>
        </section>
      </div>

      <PrelaunchFooter />
    </>
  );
}

/** A minimal sticky header: the logo, an early-access tag and the join button. */
function PrelaunchHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="frame-w flex h-16 items-center justify-between gap-4 border-x border-line px-5 sm:px-8 md:px-12">
        <div className="flex items-center gap-4">
          <Wordmark />
          <span className="hidden rounded-[4px] border border-brand/25 bg-brand-soft px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-brand-ink sm:inline">
            Early access
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <GridButton href="#join" icon={ArrowRight}>Join waitlist</GridButton>
        </div>
      </div>
    </header>
  );
}

function PrelaunchFooter() {
  return (
    <footer>
      <div className="frame-w flex flex-col gap-4 border-x border-line px-5 py-8 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 md:px-12">
        <span>© 2026 Aavishield · An Aavish AI Lab product</span>
      </div>
    </footer>
  );
}

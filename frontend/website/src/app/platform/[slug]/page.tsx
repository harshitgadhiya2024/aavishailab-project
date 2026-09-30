import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { EventPanel } from "@/components/event-panel";
import { ModuleIcon } from "@/components/icons";
import { Float } from "@/components/motion/float";
import { Reveal, Stagger, StaggerItem, WordRise } from "@/components/motion/reveal";
import { CTA, getModule, modules } from "@/lib/content";

export function generateStaticParams() {
  return modules.map((m) => ({ slug: m.slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: PageProps<"/platform/[slug]">): Promise<Metadata> {
  const m = getModule((await props.params).slug);
  return m ? { title: m.name, description: m.short } : {};
}

export default async function ModulePage(props: PageProps<"/platform/[slug]">) {
  const m = getModule((await props.params).slug);
  if (!m) notFound();
  const idx = modules.indexOf(m);
  const related = [modules[(idx + 1) % modules.length], modules[(idx + 2) % modules.length]];

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="dot-field absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-32 md:px-6 md:pt-40 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <Reveal>
              <Link href="/platform" className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-fg">
                <ArrowLeft size={14} weight="bold" />
                Platform
              </Link>
            </Reveal>
            <Reveal delay={0.05} className="mt-8 flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-ink text-ink-fg">
                <ModuleIcon icon={m.icon} size={22} />
              </span>
              <span className="text-base font-medium text-fg">{m.name}</span>
            </Reveal>
            <h1 className="mt-6 text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.035em] text-fg md:text-6xl">
              <WordRise text={m.headline} />
            </h1>
            <Reveal delay={0.3}>
              <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-muted">{m.intro}</p>
            </Reveal>
            <Reveal delay={0.45} className="mt-9">
              <Button href="/contact" size="lg">{CTA.demo}</Button>
            </Reveal>
          </div>
          <Reveal delay={0.2} y={36}>
            <Float amplitude={8} duration={7}>
              <EventPanel title={m.name} events={m.events} />
            </Float>
          </Reveal>
        </div>
      </section>

      {/* Capabilities */}
      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <h2 className="mb-12 max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text="What you get." />
        </h2>
        <Stagger className="grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2">
          {m.capabilities.map((c) => (
            <StaggerItem key={c.title} className="bg-bg p-8 transition-colors duration-300 hover:bg-surface md:p-10">
              <h3 className="text-xl font-semibold tracking-tight text-fg">{c.title}</h3>
              <p className="mt-3 max-w-[44ch] leading-relaxed text-muted">{c.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Flow */}
      <section className="mx-auto mt-36 max-w-6xl px-4 md:px-6">
        <div className="relative ink-edge overflow-hidden rounded-[28px] bg-ink p-8 text-ink-fg md:p-14">
          <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
          <h2 className="relative text-3xl font-semibold tracking-tight md:text-4xl">Under the hood</h2>
          <Stagger className="relative mt-12 grid gap-10 md:grid-cols-3" gap={0.15}>
            {m.flow.map((f, i) => (
              <StaggerItem key={f.verb}>
                <div className="flex items-center gap-4">
                  <span className="size-2 rounded-full bg-ink-fg" />
                  <span className={`h-px flex-1 ${i === m.flow.length - 1 ? "bg-transparent" : "bg-ink-fg/20"}`} />
                </div>
                <h3 className="mt-6 text-2xl font-semibold">{f.verb}</h3>
                <p className="mt-3 leading-relaxed opacity-70">{f.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Related */}
      <section className="mx-auto mt-36 max-w-6xl px-4 md:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">Works well with</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
          {related.map((r) => (
            <Link key={r.slug} href={`/platform/${r.slug}`} className="group flex items-center gap-5 rounded-[20px] border border-line p-6 transition-colors duration-300 hover:bg-surface">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-line text-fg">
                <ModuleIcon icon={r.icon} size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-fg">{r.name}</span>
                <span className="mt-1 block truncate text-sm text-muted">{r.short}</span>
              </span>
              <ArrowUpRight size={18} className="shrink-0 text-muted transition-transform duration-300 ease-out-expo group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </section>

      <CtaBand />
    </>
  );
}

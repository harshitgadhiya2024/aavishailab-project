import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { Architecture } from "@/components/architecture";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { ModuleIcon } from "@/components/icons";
import { PageHero } from "@/components/page-hero";
import { Spotlight } from "@/components/motion/spotlight";
import { Stagger, StaggerItem, WordRise } from "@/components/motion/reveal";
import { CTA, modules } from "@/lib/content";

export const metadata: Metadata = {
  title: "Platform",
  description: "Web gateway, data loss prevention, application control, VPN control, malware scanning, device posture and activity monitoring in one agent.",
};

export default function PlatformPage() {
  return (
    <>
      <PageHero eyebrow="Platform" title="Every control your devices need, in one agent." body="Seven security controls share a single lightweight agent and a single console. Turn each one on when you are ready.">
        <Button href="/contact" size="lg">{CTA.demo}</Button>
      </PageHero>

      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <Stagger className="grid gap-4 md:grid-cols-2">
          {modules.map((m, i) => (
            <StaggerItem key={m.slug} className={i === modules.length - 1 ? "md:col-span-2" : ""}>
              <Spotlight className="h-full">
                <Link href={`/platform/${m.slug}`} className="flex h-full flex-col gap-10 p-7 md:p-9">
                  <div className="flex items-start justify-between">
                    <span className={`grid size-12 place-items-center rounded-2xl ${i === 1 ? "bg-invert-bg text-invert-fg" : "border border-line text-fg"}`}>
                      <ModuleIcon icon={m.icon} size={24} />
                    </span>
                    <ArrowUpRight size={20} className="text-muted transition-[transform,color] duration-300 ease-out-expo group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-fg" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-fg">{m.name}</h2>
                    <p className="mt-2 max-w-[48ch] leading-relaxed text-muted">{m.short}</p>
                  </div>
                </Link>
              </Spotlight>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="mx-auto mt-40 max-w-6xl px-4 md:px-6">
        <h2 className="mb-16 max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text="How the pieces fit together." />
        </h2>
        <Architecture />
      </section>

      <CtaBand />
    </>
  );
}

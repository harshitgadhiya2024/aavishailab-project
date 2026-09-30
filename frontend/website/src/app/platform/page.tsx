import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { Architecture } from "@/components/architecture";
import { Button } from "@/components/button";
import { CtaBand } from "@/components/cta-band";
import { ModuleIcon } from "@/components/icons";
import { PageHero } from "@/components/page-hero";
import { Spotlight } from "@/components/motion/spotlight";
import { Stagger, StaggerItem, WordRise } from "@/components/motion/reveal";
import { CTA, moduleExtras, modules } from "@/lib/content";
import { JsonLd, SITE_URL, breadcrumbLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Platform: Seven Endpoint Security Controls in One Agent",
  description:
    "Explore the DelSecure platform: secure web gateway, data loss prevention, application control, VPN control, malware scanning, device posture and activity monitoring in one lightweight agent.",
  alternates: { canonical: "/platform" },
  openGraph: { url: "/platform" },
};

export default function PlatformPage() {
  return (
    <>
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "" }, { name: "Platform", path: "/platform" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: modules.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.name, url: `${SITE_URL}/platform/${m.slug}` })),
        }}
      />
      <PageHero accent={["agent."]} eyebrow="Platform" title="Every control your devices need, in one agent." body="Seven security controls share a single lightweight agent and a single console. Turn each one on when you are ready.">
        <Button href="/contact" size="lg">{CTA.demo}</Button>
      </PageHero>

      <section className="mx-auto max-w-6xl px-4 md:px-6">
        <Stagger className="grid gap-4 md:grid-cols-2">
          {modules.map((m, i) => (
            <StaggerItem key={m.slug} className={i === modules.length - 1 ? "md:col-span-2" : ""}>
              <Spotlight className="h-full">
                <Link href={`/platform/${m.slug}`} className={`grid h-full ${i === modules.length - 1 ? "md:grid-cols-2" : ""}`}>
                  <div className={`relative m-2 overflow-hidden rounded-[14px] bg-ink ${i === modules.length - 1 ? "aspect-[16/9] md:aspect-auto md:min-h-[260px]" : "aspect-[16/9]"}`}>
                    <Image
                      src={moduleExtras[m.slug].image}
                      alt={moduleExtras[m.slug].alt}
                      fill
                      sizes="(max-width: 768px) 100vw, 560px"
                      className="object-cover transition-transform duration-[1.1s] ease-out-expo group-hover:scale-[1.06]"
                    />
                  </div>
                  <div className="flex flex-col justify-between gap-8 p-6 md:p-8">
                    <div className="flex items-start justify-between">
                      <span className="grid size-12 place-items-center rounded-2xl border border-line text-fg transition-colors duration-300 group-hover:border-brand group-hover:bg-brand group-hover:text-on-brand">
                        <ModuleIcon icon={m.icon} size={24} />
                      </span>
                      <ArrowUpRight size={20} className="text-muted transition-[transform,color] duration-300 ease-out-expo group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-brand-ink" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-fg">{m.name}</h2>
                      <p className="mt-2 max-w-[48ch] leading-relaxed text-muted">{m.short}</p>
                    </div>
                  </div>
                </Link>
              </Spotlight>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="mx-auto mt-40 max-w-6xl px-4 md:px-6">
        <h2 className="mb-16 max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
          <WordRise text="How the pieces fit together." accent={["together."]} />
        </h2>
        <Architecture />
      </section>

      <CtaBand />
    </>
  );
}

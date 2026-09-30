import { ArrowUpRight, CheckCircle, Prohibit, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getModule, type ModuleSlug } from "@/lib/content";
import { ModuleIcon } from "./icons";
import { Spotlight } from "./motion/spotlight";
import { Stagger, StaggerItem } from "./motion/reveal";

function CellHead({ slug, invert = false }: { slug: ModuleSlug; invert?: boolean }) {
  const m = getModule(slug)!;
  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        <span className={`grid size-10 place-items-center rounded-full border transition-colors duration-300 ${invert ? "border-brand/50 text-brand" : "border-line group-hover:border-brand group-hover:text-brand-ink"}`}>
          <ModuleIcon icon={m.icon} size={20} />
        </span>
        <ArrowUpRight size={18} className="opacity-40 transition-[opacity,transform] duration-300 ease-out-expo group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
      <h3 className="mt-6 text-xl font-semibold tracking-tight">{m.name}</h3>
      <p className={`mt-2 max-w-[42ch] text-sm leading-relaxed ${invert ? "opacity-70" : "text-muted"}`}>{m.short}</p>
    </div>
  );
}

const cell = "block h-full p-6 md:p-7";

export function ModulesBento() {
  return (
    <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-12">
      {/* DLP: the flagship, inverted */}
      <StaggerItem className="md:col-span-7 md:row-span-2">
        <Link href="/platform/data-loss-prevention" className="group relative block h-full ink-edge overflow-hidden rounded-[20px] bg-ink p-6 text-ink-fg md:p-8">
          <div className="dot-field-ink absolute inset-0 opacity-70" aria-hidden />
          <CellHead slug="data-loss-prevention" invert />
          <div className="relative mt-10 grid gap-2.5 font-mono text-[12.5px]" aria-hidden>
            {[
              ["Q3-salaries.xlsx", "chatgpt.com", "Salary data (AI)"],
              ["prod.env", "Microsoft Teams", "AWS secret key"],
              ["scan_0417.jpg", "Gmail", "Passport (OCR)"],
            ].map(([f, d, why], i) => (
              <div
                key={f}
                className="flex items-center justify-between gap-4 rounded-xl border border-ink-fg/15 bg-ink-fg/[0.04] px-4 py-3 transition-transform duration-500 ease-out-expo group-hover:translate-x-1"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <span className="min-w-0">
                  <span className="block truncate">{f}</span>
                  <span className="block truncate opacity-55">to {d}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <WarningCircle size={14} weight="fill" className="text-brand" />
                  {why}
                </span>
              </div>
            ))}
          </div>
        </Link>
      </StaggerItem>

      <StaggerItem className="md:col-span-5">
        <Spotlight className="h-full">
          <Link href="/platform/web-gateway" className={cell}>
            <CellHead slug="web-gateway" />
            <div className="mt-6 flex flex-wrap gap-2 text-[12px]" aria-hidden>
              {[
                ["Social media", true],
                ["AI tools", false],
                ["Gambling", true],
                ["Productivity", false],
              ].map(([c, blocked]) => (
                <span key={c as string} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${blocked ? "border-fg/25 text-fg" : "border-line text-muted"}`}>
                  {blocked ? <Prohibit size={12} weight="bold" className="text-brand-ink" /> : <CheckCircle size={12} weight="bold" />}
                  {c as string}
                </span>
              ))}
            </div>
          </Link>
        </Spotlight>
      </StaggerItem>

      <StaggerItem className="md:col-span-5">
        <Spotlight className="h-full">
          <Link href="/platform/vpn-control" className={cell}>
            <CellHead slug="vpn-control" />
            <p className="mt-6 font-mono text-[12px] text-muted" aria-hidden>
              default: <span className="text-brand-ink">blocked</span>
            </p>
          </Link>
        </Spotlight>
      </StaggerItem>

      <StaggerItem className="md:col-span-4">
        <Spotlight className="h-full">
          <Link href="/platform/application-control" className={cell}>
            <CellHead slug="application-control" />
          </Link>
        </Spotlight>
      </StaggerItem>

      {/* Malware: tinted with a scan sweep */}
      <StaggerItem className="md:col-span-4">
        <Link href="/platform/malware-scanning" className="group relative block h-full overflow-hidden rounded-[20px] border border-line bg-bg-2 p-6 md:p-7">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-10 animate-scan bg-gradient-to-b from-transparent via-fg/[0.07] to-transparent" />
          <CellHead slug="malware-scanning" />
        </Link>
      </StaggerItem>

      <StaggerItem className="md:col-span-4">
        <Spotlight className="h-full">
          <Link href="/platform/device-posture" className={cell}>
            <CellHead slug="device-posture" />
            <ul className="mt-6 grid grid-cols-2 gap-2 text-[12px] text-fg-2" aria-hidden>
              {["Disk encryption", "Firewall", "OS patches", "Antivirus"].map((c) => (
                <li key={c} className="flex items-center gap-1.5">
                  <CheckCircle size={14} weight="fill" className="text-brand-ink" />
                  {c}
                </li>
              ))}
            </ul>
          </Link>
        </Spotlight>
      </StaggerItem>

      {/* Activity: full width with usage columns */}
      <StaggerItem className="md:col-span-12">
        <Spotlight className="h-full">
          <Link href="/platform/activity-monitoring" className="grid gap-8 p-6 md:grid-cols-[1fr_1.2fr] md:items-end md:p-8">
            <CellHead slug="activity-monitoring" />
            <div className="flex h-32 items-end gap-2" aria-hidden>
              {[38, 62, 45, 80, 70, 92, 55, 66, 84, 48, 73, 58, 88, 64].map((h, i) => (
                <span
                  key={i}
                  className={`flex-1 origin-bottom rounded-t-md ${i === 5 ? "bg-brand" : "bg-fg/80"} transition-transform duration-700 ease-out-expo group-hover:scale-y-[1.08]`}
                  style={{ height: `${h}%`, opacity: i === 5 ? 1 : 0.25 + (h / 100) * 0.75, transitionDelay: `${i * 25}ms` }}
                />
              ))}
            </div>
          </Link>
        </Spotlight>
      </StaggerItem>
    </Stagger>
  );
}

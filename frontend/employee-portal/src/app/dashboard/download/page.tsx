"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Apple, Check, CheckCircle2, ChevronDown, Copy, Download, Loader2, Monitor, ShieldCheck, Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { portalApi } from "@/lib/api";
import { cn } from "@/lib/utils";

// One path for everyone: the signed native installer for their platform, and
// the few clicks to run it. The installed agent connects itself to the
// employee's account through the browser, so there is nothing to paste and
// nothing to type.

type OSType = "macos" | "windows" | "linux";
type Package = { filename: string; url: string; version: string; size: number; sha256: string };
type Installers = { version: string; packages: Record<OSType, Package | null> };
type Step = {
  title: string;
  detail: string;
  note?: string;
  // Clears the "downloaded from the internet" mark so the OS doesn't block
  // the installer — built from the real file name.
  allow?: { where: string; why: string; build: (filename: string) => string };
};

const PLATFORMS: Record<OSType, {
  label: string;
  icon: React.ElementType;
  supports: string;
  format: string;
  deviceOs: string[]; // os_type values the agent reports for this platform
  steps: Step[];
}> = {
  macos: {
    label: "macOS",
    icon: Apple,
    supports: "MacBook, iMac and Mac mini",
    format: "macOS installer (.pkg)",
    deviceOs: ["darwin", "macos", "mac"],
    steps: [
      {
        title: "Allow the installer, then open it",
        detail: "Then double-click the downloaded .pkg file in your Downloads folder.",
        allow: {
          where: "Terminal",
          why: "First, so macOS doesn't block it, open Terminal (Spotlight → Terminal) and run:",
          build: (f) => `xattr -c ~/Downloads/${f}`,
        },
        note: "Skipped this and macOS blocked it? Open System Settings → Privacy & Security, scroll down and click “Open Anyway”.",
      },
      { title: "Follow the installer", detail: "Click Continue, then Install, and enter your Mac password when asked." },
      { title: "Your device connects automatically", detail: "A browser tab opens and links this Mac to your account. You don't need to do anything there." },
      { title: "You're protected", detail: "The Aavishield icon appears in the menu bar, and this page shows your device as connected." },
    ],
  },
  windows: {
    label: "Windows",
    icon: Monitor,
    supports: "Windows 10 and 11",
    format: "Windows installer (.msi)",
    deviceOs: ["windows", "win32"],
    steps: [
      {
        title: "Allow the installer, then open it",
        detail: "Then double-click the downloaded .msi file in your Downloads folder.",
        allow: {
          where: "PowerShell",
          why: "First, so Windows doesn't block it, open PowerShell (Start → PowerShell) and run:",
          build: (f) => `Unblock-File "$env:USERPROFILE\\Downloads\\${f}"`,
        },
        note: "Skipped this and Windows showed “Windows protected your PC”? Click More info, then Run anyway.",
      },
      { title: "Follow the setup wizard", detail: "Click Next, then Install, and choose Yes when Windows asks for permission." },
      { title: "Your device connects automatically", detail: "A browser tab opens and links this PC to your account. You don't need to do anything there." },
      { title: "You're protected", detail: "The Aavishield icon appears in the system tray, and this page shows your device as connected." },
    ],
  },
  linux: {
    label: "Linux",
    icon: Terminal,
    supports: "Ubuntu, Debian and similar (64-bit)",
    format: "Debian package (.deb)",
    deviceOs: ["linux"],
    steps: [
      {
        title: "Open the installer",
        detail: "Double-click the downloaded .deb file. It opens in your software center (App Center or Software Install).",
      },
      { title: "Install it", detail: "Click Install and enter your password when asked." },
      { title: "Your device connects automatically", detail: "A browser tab opens and links this computer to your account. You don't need to do anything there." },
      { title: "You're protected", detail: "Aavishield starts on its own every time you sign in, and this page shows your device as connected." },
    ],
  },
};

const ORDER: OSType[] = ["macos", "windows", "linux"];

function detectOS(): OSType | null {
  if (typeof navigator === "undefined") return null;
  const p = ((navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent || "").toLowerCase();
  if (p.includes("mac")) return "macos";
  if (p.includes("win")) return "windows";
  if (p.includes("linux") && !/android/i.test(navigator.userAgent)) return "linux";
  return null;
}

function formatSize(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function timeAgo(iso?: string) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export default function DownloadPage() {
  const [detected, setDetected] = useState<OSType | null>(null);
  const [selected, setSelected] = useState<OSType>("macos");
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // Detect on the client only, so server and client render the same markup.
  useEffect(() => {
    const os = detectOS();
    setDetected(os);
    if (os) setSelected(os);
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portal-installers"],
    queryFn: () => portalApi.installers().then((r) => r.data as Installers),
    staleTime: 60_000,
  });

  // Watch for the device to connect: quickly once a download has started,
  // slowly otherwise.
  const { data: devicesData } = useQuery({
    queryKey: ["portal-devices"],
    queryFn: () => portalApi.devices().then((r) => r.data),
    refetchInterval: startedAt ? 5_000 : 60_000,
  });

  const platform = PLATFORMS[selected];
  const pkg = data?.packages?.[selected] ?? null;

  const devices: any[] = useMemo(() => {
    const all: any[] = Array.isArray(devicesData?.data) ? devicesData.data : [];
    return all
      .filter((d) => d.status !== "revoked" && platform.deviceOs.includes(String(d.os_type).toLowerCase()))
      .sort((a, b) => new Date(b.last_seen_at || b.enrolled_at || 0).getTime() - new Date(a.last_seen_at || a.enrolled_at || 0).getTime());
  }, [devicesData, platform]);
  const justConnected = devices.find((d) => startedAt && new Date(d.enrolled_at).getTime() >= startedAt - 60_000);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Install Aavishield</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Download the installer for your computer and open it. It takes about two minutes, and your device
          connects to your company on its own.
        </p>
      </div>

      {/* Platform picker */}
      <div role="tablist" aria-label="Choose your computer" className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-1.5">
        {ORDER.map((id) => {
          const p = PLATFORMS[id];
          const active = selected === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-sm font-medium transition-colors sm:flex-row sm:justify-center sm:gap-2",
                active ? "bg-brand-500/10 text-brand-500 ring-1 ring-brand-500/30" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <p.icon className="h-5 w-5" />
              <span>{p.label}</span>
              {detected === id && (
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", active ? "bg-brand-500 text-white" : "bg-muted text-muted-foreground")}>
                  This device
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="h-40 animate-pulse rounded-xl bg-card" />
          <div className="h-64 animate-pulse rounded-xl bg-card" />
        </div>
      ) : isError ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger" />
          <div className="text-sm text-body">
            We couldn&apos;t load the installers.{" "}
            <button onClick={() => refetch()} className="font-medium text-brand-500 hover:underline">Try again</button>
          </div>
        </div>
      ) : (
        <>
          {/* Download */}
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">
                  <platform.icon className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-foreground">Aavishield for {platform.label}</h2>
                  <p className="text-sm text-muted-foreground">{platform.supports}</p>
                  {pkg && (
                    <p className="mt-0.5 text-xs text-subtle">
                      Version {pkg.version} · {platform.format} · {formatSize(pkg.size)}
                    </p>
                  )}
                </div>
              </div>

              {pkg ? (
                <a
                  href={pkg.url}
                  download={pkg.filename}
                  onClick={() => setStartedAt(Date.now())}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-brand-600"
                >
                  <Download className="h-5 w-5" /> Download for {platform.label}
                </a>
              ) : null}
            </div>

            {pkg ? (
              <Checksum sha256={pkg.sha256} />
            ) : (
              <div className="mt-5 flex items-start gap-3 rounded-lg bg-muted p-4 text-sm text-body">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
                The {platform.label} installer isn&apos;t available right now. Please check back later or ask your IT administrator.
              </div>
            )}
          </section>

          {/* Steps */}
          {pkg && (
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-base font-semibold text-foreground">After downloading</h2>
              <ol className="mt-5 space-y-0">
                {platform.steps.map((step, i) => {
                  const last = i === platform.steps.length - 1;
                  return (
                    <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
                      {!last && <span className="absolute left-[15px] top-9 h-[calc(100%-2.25rem)] w-px bg-border" aria-hidden />}
                      <span className={cn(
                        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                        last ? "bg-green-500/10 text-success" : "bg-brand-500/10 text-brand-500",
                      )}>
                        {last ? <Check className="h-4 w-4" /> : i + 1}
                      </span>
                      <div className="min-w-0 pt-1">
                        <p className="text-sm font-medium text-foreground">{step.title}</p>
                        {step.allow && <AllowCommand why={step.allow.why} command={step.allow.build(pkg.filename)} />}
                        <p className={cn("text-sm text-muted-foreground", step.allow ? "mt-2" : "mt-0.5")}>{step.detail}</p>
                        {step.note && (
                          <p className="mt-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{step.note}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* Connection status */}
          <section
            aria-live="polite"
            className={cn(
              "flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between",
              devices.length > 0 ? "border-green-500/30 bg-green-500/5" : "border-border bg-card",
            )}
          >
            {devices.length > 0 ? (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    {justConnected ? `${justConnected.hostname} is connected. You're all set.` : `${platform.label} device connected`}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {devices.slice(0, 3).map((d) => `${d.hostname}${d.status === "online" ? " · online" : d.last_seen_at ? ` · last seen ${timeAgo(d.last_seen_at)}` : ""}`).join("  ·  ")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                {startedAt ? <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-brand-500" /> : <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-subtle" />}
                <div className="text-sm">
                  <p className="font-medium text-foreground">{startedAt ? "Waiting for your device to connect…" : `No ${platform.label} device connected yet`}</p>
                  <p className="mt-0.5 text-muted-foreground">This updates on its own once the installer finishes.</p>
                </div>
              </div>
            )}
            <Link href="/dashboard/devices" className="text-sm font-medium text-brand-500 hover:text-brand-400 sm:flex-shrink-0">
              My devices →
            </Link>
          </section>

          <p className="text-center text-xs text-subtle">
            Having trouble installing? Contact your IT administrator.
          </p>
        </>
      )}
    </div>
  );
}

function AllowCommand({ why, command }: { why: string; command: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Command copied");
    } catch {
      toast.error("Couldn't copy. Select it and copy manually.");
    }
  };
  return (
    <div className="mt-1">
      <p className="mb-1.5 text-sm text-muted-foreground">{why}</p>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-green-400">{command}</code>
        <button onClick={copy} aria-label="Copy command" className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Checksum({ sha256 }: { sha256: string }) {
  const [open, setOpen] = useState(false);
  if (!sha256) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sha256);
      toast.success("Checksum copied");
    } catch {
      toast.error("Couldn't copy. Select it and copy manually.");
    }
  };
  return (
    <div className="mt-5 border-t border-border pt-4">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ShieldCheck className="h-3.5 w-3.5" /> Verify this download
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground" title={sha256}>
            SHA-256 {sha256}
          </code>
          <button onClick={copy} aria-label="Copy checksum" className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

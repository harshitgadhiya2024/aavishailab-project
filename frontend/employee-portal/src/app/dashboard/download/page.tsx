"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { portalApi } from "@/lib/api";
import { Apple, Monitor, Terminal, Download, Loader2, CheckCircle2, Trash2, Copy, ShieldCheck, Package } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type OSType = "macos" | "windows" | "linux";

type NativePackage = { filename: string; url: string; version: string; size: number };
type InstallerInfo = {
  os: OSType;
  token: string;
  admin_url: string;
  expires_at: string;
  native: NativePackage | null;
};

/** Unattended-install one-liner: writes the enrollment drop the agent reads on first run. */
const enrollCommand = (os: OSType, info: InstallerInfo): string => {
  const t = info.token;
  const u = info.admin_url;
  if (os === "windows") {
    return `msiexec /i ${info.native?.filename ?? "aavishield-agent.msi"} /qn TOKEN=${t} ADMINURL=${u}`;
  }
  if (os === "linux") {
    return `sudo AAVISHIELD_ENROLL_TOKEN=${t} AAVISHIELD_ADMIN_URL=${u} dpkg -i ${info.native?.filename ?? "aavishield-agent.deb"}`;
  }
  // chown to the invoking (console) user: the agent later runs as that user
  // and needs write access to the directory to delete the drop file after
  // reading it — root creating it via `sudo tee` alone leaves it undeletable
  // by the agent, so the token sits on disk forever instead of being wiped.
  return `sudo mkdir -p /etc/aavishield && sudo chown "$(id -u):$(id -g)" /etc/aavishield && echo '{"token":"${t}","admin_url":"${u}"}' | sudo tee /etc/aavishield/enroll.json >/dev/null && sudo installer -pkg ~/Downloads/${info.native?.filename ?? "aavishield-agent.pkg"} -target /`;
};

const OS_OPTIONS: { id: OSType; label: string; icon: React.ElementType; desc: string; steps: string[] }[] = [
  {
    id: "macos",
    label: "macOS",
    icon: Apple,
    desc: "MacBook, iMac, Mac mini",
    steps: [
      "Download the .command file",
      "Open Terminal (Spotlight → Terminal)",
      "Run: chmod +x ~/Downloads/aavishield-install.command && xattr -d com.apple.quarantine ~/Downloads/aavishield-install.command",
      "Then run: bash ~/Downloads/aavishield-install.command",
      "Agent runs automatically in background",
    ],
  },
  {
    id: "windows",
    label: "Windows",
    icon: Monitor,
    desc: "Windows 10 / 11",
    steps: [
      "Download the .bat installer",
      "Right-click → Run as administrator",
      "Follow the on-screen prompts",
      "Agent runs automatically on login",
    ],
  },
  {
    id: "linux",
    label: "Linux",
    icon: Terminal,
    desc: "Ubuntu, Fedora, Debian",
    steps: [
      "Download the .sh installer",
      "Open terminal and run: bash aavishield-install.sh",
      "Follow the on-screen prompts",
      "Agent runs as a user systemd service",
    ],
  },
];

export default function DownloadPage() {
  const [selected, setSelected] = useState<OSType | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState<OSType | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  const handleDownload = async () => {
    if (!selected) return;
    setDownloading(true);
    try {
      await portalApi.downloadInstaller(selected);
      setDownloaded(selected);
      toast.success("Installer downloaded! Run it to complete setup.");
    } catch (err: any) {
      toast.error(err.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const handleUninstall = async () => {
    if (!selected) return;
    setUninstalling(true);
    try {
      await portalApi.downloadUninstaller(selected);
      toast.success("Uninstaller downloaded! Run it to remove the agent.");
    } catch (err: any) {
      toast.error(err.message || "Download failed");
    } finally {
      setUninstalling(false);
    }
  };

  // Tells us whether a signed native package exists for this OS, and carries the
  // enrollment token that pairs with it.
  const { data: infoData } = useQuery({
    queryKey: ["installer-info", selected],
    queryFn: () => portalApi.installerInfo(selected as OSType),
    enabled: !!selected,
  });
  const info: InstallerInfo | undefined = infoData?.data;
  const native = info?.native ?? null;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  };

  const selectedOS = OS_OPTIONS.find(o => o.id === selected);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Download Security Agent</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select your device type, download the installer, and run it once.
          No technical knowledge required.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {OS_OPTIONS.map((os) => (
          <button
            key={os.id}
            onClick={() => { setSelected(os.id); setDownloaded(null); }}
            className={cn(
              "bg-card rounded-xl border-2 p-5 text-left transition-all hover:shadow-md",
              selected === os.id
                ? "border-brand-500 shadow-md ring-2 ring-brand-500/20"
                : "border-border hover:border-border-strong"
            )}
          >
            <os.icon className={cn("w-8 h-8 mb-3", selected === os.id ? "text-brand-500" : "text-subtle")} />
            <p className="font-semibold text-foreground">{os.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{os.desc}</p>
            {downloaded === os.id && (
              <div className="flex items-center gap-1 mt-2 text-success text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Downloaded
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Native package: preferred when published — it bundles its own runtime,
          so there is no Python prerequisite and no quarantine workaround. */}
      {selectedOS && native && info && (
        <div className="bg-card rounded-xl border border-brand-500/30 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-brand-500" />
            <h3 className="font-semibold text-foreground">
              Recommended — {selectedOS.label} installer
            </h3>
            <span className="ml-auto text-xs text-subtle">v{native.version}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Standard {selectedOS.label} installer ({(native.size / 1048576).toFixed(1)} MB).
            Nothing else to install — it includes everything it needs.
          </p>

          <a
            href={native.url}
            className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand hover:text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            <Package className="w-5 h-5" />
            Download {native.filename.split(".").pop()?.toUpperCase()}
          </a>

          {/* Nothing to copy or type here on purpose — the installer opens
              your account in a browser on first run and finishes connecting
              this device on its own, as long as you're signed in here. */}
          <div className="mt-5 flex items-start gap-3 bg-elevated rounded-lg p-4">
            <ShieldCheck className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-body">Run it — that's the whole setup</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                When it starts, a browser tab opens automatically to finish connecting this device
                to your account. Stay signed in here and it completes on its own — nothing to copy
                or type.
              </p>
            </div>
          </div>

          <details className="mt-4 group">
            <summary className="text-xs text-brand-500 hover:text-brand-400 cursor-pointer select-none">
              IT / unattended install (for bulk or MDM deployment)
            </summary>
            <p className="text-xs text-subtle mt-2 mb-1">
              Not needed for a normal install — this bypasses the automatic browser step for
              scripted rollouts. The code below is single-use and expires in 2 hours.
            </p>
            <div className="flex items-start gap-2 mt-2">
              <pre className="flex-1 min-w-0 bg-black text-green-400 text-xs rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all font-mono border border-border">
                {enrollCommand(selectedOS.id, info)}
              </pre>
              <button
                onClick={() => copy(enrollCommand(selectedOS.id, info), "Command")}
                className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-elevated hover:text-foreground transition-colors"
                aria-label="Copy install command"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </details>
        </div>
      )}

      {selectedOS && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-6">
          <h3 className="font-semibold text-foreground mb-1">
            {native ? `Alternative — script installer` : `Setup steps for ${selectedOS.label}`}
          </h3>
          {native && (
            <p className="text-xs text-subtle mb-4">
              Requires Python 3 on the machine. Use this only if the installer above doesn&apos;t work.
            </p>
          )}
          <ol className="space-y-3 mb-6">
            {selectedOS.steps.map((step, i) => {
              const codeMatch = step.match(/^(Run:|Then run:)\s+(.+)$/);
              return (
                <li key={i} className="flex items-start gap-3 text-sm text-body">
                  <span className="w-6 h-6 rounded-full bg-brand-500/10 text-brand-500 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {codeMatch ? (
                    <div className="flex-1 min-w-0">
                      <span className="text-body">{codeMatch[1]}</span>
                      <pre className="mt-1.5 bg-black text-green-400 text-xs rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed border border-border">
                        {codeMatch[2]}
                      </pre>
                    </div>
                  ) : (
                    <span>{step}</span>
                  )}
                </li>
              );
            })}
          </ol>

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand hover:text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-60"
          >
            {downloading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Download className="w-5 h-5" />}
            {downloading ? "Generating installer..." : `Download for ${selectedOS.label}`}
          </button>

          <p className="text-xs text-subtle mt-3">
            Installer link expires in 2 hours. Download a new one if it expires.
          </p>

          <div className="mt-6 pt-5 border-t border-border">
            <p className="text-sm font-medium text-body mb-2">Need to remove the agent?</p>
            <button
              onClick={handleUninstall}
              disabled={uninstalling}
              className="flex items-center gap-2 border border-red-500/30 text-danger hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
            >
              {uninstalling
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Trash2 className="w-4 h-4" />}
              {uninstalling ? "Preparing..." : `Download Uninstaller for ${selectedOS?.label}`}
            </button>
            <p className="text-xs text-subtle mt-2">
              Stops the agent, clears system proxy, and removes all files.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

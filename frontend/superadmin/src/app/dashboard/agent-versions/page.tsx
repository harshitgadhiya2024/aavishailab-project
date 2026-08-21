"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentPackageApi } from "@/lib/api";
import {
  Download, Monitor, Apple, Terminal, Upload, RotateCcw, CheckCircle2,
  Users, X, Loader2, Play, ExternalLink, Clock, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";

type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string;
  ref: string;
  title: string;
  created_at: string;
  updated_at: string;
  url: string;
};

const PLATFORM_META: Record<string, { label: string; icon: React.ElementType; ext: string }> = {
  macos: { label: "macOS", icon: Apple, ext: ".pkg" },
  windows: { label: "Windows", icon: Monitor, ext: ".msi" },
  linux: { label: "Linux", icon: Terminal, ext: ".deb" },
};

function formatBytes(n: number): string {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatWhen(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AgentVersionsPage() {
  const qc = useQueryClient();
  const [uploadPlatform, setUploadPlatform] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<{ platform: string; filename: string; version: string } | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);

  const { data: manifestData, isLoading: manifestLoading } = useQuery({
    queryKey: ["agent-packages-manifest"],
    queryFn: agentPackageApi.manifest,
    refetchInterval: 30_000,
  });
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["agent-packages-history"],
    queryFn: agentPackageApi.history,
  });
  const { data: buildStatusData } = useQuery({
    queryKey: ["agent-packages-build-status"],
    queryFn: agentPackageApi.buildStatus,
    // Poll faster while something is actually running so "in progress"
    // doesn't sit stale for 30s — settle back down once nothing is active.
    refetchInterval: (query) => {
      const runs: WorkflowRun[] = query.state.data?.data?.runs ?? [];
      const active = runs.some((r) => r.status === "queued" || r.status === "in_progress");
      return active ? 10_000 : 60_000;
    },
  });

  const rollbackMut = useMutation({
    mutationFn: ({ platform, filename }: { platform: string; filename: string }) =>
      agentPackageApi.rollback(platform, filename),
    onSuccess: (_, vars) => {
      toast.success(`${PLATFORM_META[vars.platform]?.label ?? vars.platform} rolled back`);
      qc.invalidateQueries({ queryKey: ["agent-packages-manifest"] });
      qc.invalidateQueries({ queryKey: ["agent-packages-history"] });
      setRollbackTarget(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Rollback failed"),
  });

  const configured: boolean = buildStatusData?.data?.configured ?? false;
  const runs: WorkflowRun[] = buildStatusData?.data?.runs ?? [];

  const current = manifestData?.data?.current ?? {};
  const artifacts: Record<string, any> = current?.artifacts ?? {};
  const fleet = manifestData?.data?.fleet ?? {};
  const byVersion: { agent_version: string; count: number }[] = fleet.by_version ?? [];
  const byPlatform: { os_type: string; count: number }[] = fleet.by_platform ?? [];
  const totalDevices: number = fleet.total_devices ?? 0;
  const upToDate: number = fleet.up_to_date ?? 0;
  const packages: { platform: string; filename: string; version: string; size: number; sha256: string; modified_at: string; active: boolean }[] =
    historyData?.data?.packages ?? [];

  const historyByPlatform: Record<string, typeof packages> = {};
  for (const p of packages) {
    (historyByPlatform[p.platform] ??= []).push(p);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Agent Versions</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Endpoint connector rollout — what&apos;s published per platform, what the fleet is actually running, and rollback
          </p>
        </div>
        <button
          onClick={() => setTriggerOpen(true)}
          disabled={!configured}
          title={configured ? undefined : "Set GITHUB_REPOSITORY and GITHUB_ACTIONS_PAT to enable this"}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play className="w-4 h-4" /> Trigger new build
        </button>
      </div>

      {/* CI build status */}
      {configured && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h3 className="font-semibold text-foreground mb-3">Recent CI builds</h3>
          {runs.length === 0 ? (
            <p className="text-sm text-[#6B6B6B]">No runs yet — trigger one above.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <RunStatusIcon status={r.status} conclusion={r.conclusion} />
                    <span className="text-foreground truncate">{r.title || "Agent packages"}</span>
                    <span className="text-xs text-[#6B6B6B] font-mono flex-shrink-0">{r.ref}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">{formatWhen(r.updated_at)}</span>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-brand-500">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fleet adoption summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Devices reporting</p>
              <p className="text-3xl font-bold text-foreground mt-1">{totalDevices}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-brand-500/10 text-brand-500">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">On current version</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {upToDate}
                {totalDevices > 0 && <span className="text-sm text-muted-foreground font-normal"> / {totalDevices}</span>}
              </p>
              <p className="text-xs text-[#6B6B6B] mt-1">v{current?.version ?? "—"}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-green-500/10 text-green-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl p-5 border border-border shadow-sm">
          <p className="text-sm text-muted-foreground mb-2">By platform</p>
          <div className="flex flex-wrap gap-2">
            {byPlatform.length === 0 ? (
              <span className="text-xs text-[#6B6B6B]">No devices yet</span>
            ) : (
              byPlatform.map((p) => (
                <span key={p.os_type} className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground capitalize">
                  {p.os_type}: {p.count}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Version distribution */}
      {byVersion.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h3 className="font-semibold text-foreground mb-4">Fleet version distribution</h3>
          <div className="space-y-2">
            {byVersion.map((v) => {
              const pct = totalDevices > 0 ? (v.count / totalDevices) * 100 : 0;
              const isCurrent = v.agent_version === current?.version;
              return (
                <div key={v.agent_version} className="flex items-center gap-3 text-sm">
                  <span className={cn("w-24 flex-shrink-0 font-mono text-xs", isCurrent ? "text-green-400" : "text-muted-foreground")}>
                    {v.agent_version}
                  </span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", isCurrent ? "bg-green-500" : "bg-brand-500/60")} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 text-right text-xs text-muted-foreground">{v.count} ({pct.toFixed(0)}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Published packages per platform */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(["macos", "windows", "linux"] as const).map((platform) => {
          const meta = PLATFORM_META[platform];
          const Icon = meta.icon;
          const artifact = artifacts[platform];
          const history = historyByPlatform[platform] ?? [];
          const olderVersions = history.filter((p) => !p.active);

          return (
            <div key={platform} className="bg-card rounded-xl border border-border shadow-sm p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                  <h3 className="font-semibold text-foreground">{meta.label}</h3>
                </div>
                <button
                  onClick={() => setUploadPlatform(platform)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title={`Upload a new ${meta.label} package`}
                >
                  <Upload className="w-4 h-4" />
                </button>
              </div>

              {manifestLoading ? (
                <div className="h-16 bg-muted rounded-lg animate-pulse" />
              ) : artifact ? (
                <div className="space-y-1 mb-4">
                  <p className="text-2xl font-bold text-foreground">v{current.version}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate" title={artifact.filename}>{artifact.filename}</p>
                  <p className="text-xs text-[#6B6B6B]">{formatBytes(artifact.size)} · published {formatWhen(artifact.published_at)}</p>
                  <p className="text-xs text-[#6B6B6B] font-mono truncate" title={artifact.sha256}>sha256: {artifact.sha256?.slice(0, 16)}…</p>
                </div>
              ) : (
                <div className="mb-4 py-4 text-center text-xs text-[#6B6B6B] border border-dashed border-border rounded-lg">
                  Nothing published yet
                </div>
              )}

              {olderVersions.length > 0 && (
                <div className="mt-auto pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">Previous builds</p>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {olderVersions.map((p) => (
                      <div key={p.filename} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground truncate" title={p.filename}>v{p.version}</span>
                        <button
                          onClick={() => setRollbackTarget({ platform, filename: p.filename, version: p.version })}
                          className="flex items-center gap-1 text-[#6B6B6B] hover:text-brand-500 transition-colors flex-shrink-0"
                        >
                          <RotateCcw className="w-3 h-3" /> Roll back
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {historyLoading === false && packages.length === 0 && !manifestLoading && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <Download className="w-8 h-8 mx-auto mb-2 text-[#6B6B6B] opacity-30" />
          <p className="text-sm text-muted-foreground">
            No agent packages published yet. Push a tag matching <code className="text-xs bg-muted px-1.5 py-0.5 rounded">agent-v*</code>{" "}
            or run the &quot;Agent packages&quot; GitHub Actions workflow, or upload one directly here.
          </p>
        </div>
      )}

      {uploadPlatform && (
        <UploadModal
          platform={uploadPlatform}
          onClose={() => setUploadPlatform(null)}
          onDone={() => {
            setUploadPlatform(null);
            qc.invalidateQueries({ queryKey: ["agent-packages-manifest"] });
            qc.invalidateQueries({ queryKey: ["agent-packages-history"] });
          }}
        />
      )}

      <Modal open={!!rollbackTarget} onClose={() => setRollbackTarget(null)} className="max-w-md">
        {rollbackTarget && (
          <div className="p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">Roll back {PLATFORM_META[rollbackTarget.platform]?.label}?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Devices polling <code className="text-xs bg-muted px-1 py-0.5 rounded">/internal/agent/version</code> will be offered{" "}
              <span className="font-mono text-foreground">v{rollbackTarget.version}</span> instead, and self-update to it within their
              next 6-hour check.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRollbackTarget(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => rollbackMut.mutate(rollbackTarget)}
                disabled={rollbackMut.isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {rollbackMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Roll back
              </button>
            </div>
          </div>
        )}
      </Modal>

      {triggerOpen && (
        <TriggerBuildModal
          onClose={() => setTriggerOpen(false)}
          onDone={() => {
            setTriggerOpen(false);
            qc.invalidateQueries({ queryKey: ["agent-packages-build-status"] });
          }}
        />
      )}
    </div>
  );
}

function RunStatusIcon({ status, conclusion }: { status: string; conclusion: string }) {
  if (status !== "completed") {
    return <Loader2 className="w-4 h-4 text-brand-500 animate-spin flex-shrink-0" />;
  }
  if (conclusion === "success") {
    return <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />;
  }
  if (conclusion === "failure" || conclusion === "cancelled") {
    return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
  }
  return <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
}

function UploadModal({ platform, onClose, onDone }: { platform: string; onClose: () => void; onDone: () => void }) {
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const meta = PLATFORM_META[platform];

  const uploadMut = useMutation({
    mutationFn: () => agentPackageApi.upload(platform, version, file as File),
    onSuccess: () => {
      toast.success(`${meta.label} v${version} published`);
      onDone();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Upload failed"),
  });

  return (
    <Modal open onClose={onClose} className="max-w-md">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Publish {meta.label} package</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Same publish CI performs — for an out-of-band hotfix without waiting on a GitHub Actions run. Filename must match{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">aavishield-agent-&lt;version&gt;{platform === "linux" ? "-amd64" : ""}{meta.ext}</code>.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Version</label>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.6.0"
              className="w-full px-3 py-2 border border-border bg-background rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Package file ({meta.ext})</label>
            <input
              type="file"
              accept={meta.ext}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-brand-500/10 file:text-brand-500 file:text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={() => uploadMut.mutate()}
            disabled={!version || !file || uploadMut.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {uploadMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Publish
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TriggerBuildModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [version, setVersion] = useState("");
  const [ref, setRef] = useState("main");

  const triggerMut = useMutation({
    mutationFn: () => agentPackageApi.triggerBuild(version, ref || undefined),
    onSuccess: () => {
      toast.success(`Build triggered for v${version} — check status below in a few seconds`);
      onDone();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not trigger the build"),
  });

  return (
    <Modal open onClose={onClose} className="max-w-md">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Trigger a new build</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Fires the same <code className="text-xs bg-muted px-1 py-0.5 rounded">workflow_dispatch</code> event the &quot;Run
          workflow&quot; button on the Actions tab does — builds all three platforms in parallel and auto-publishes here when
          CI publishing secrets are set.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Version</label>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.6.0"
              className="w-full px-3 py-2 border border-border bg-background rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Branch / ref</label>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="main"
              className="w-full px-3 py-2 border border-border bg-background rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={() => triggerMut.mutate()}
            disabled={!version || triggerMut.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {triggerMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            <Play className="w-4 h-4" /> Trigger build
          </button>
        </div>
      </div>
    </Modal>
  );
}

"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appCatalogApi, AppCatalogInput } from "@/lib/api";
import { AppWindow, Plus, Pencil, Trash2, Upload, X, Loader2, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";

const CATEGORY_LABELS: Record<string, string> = {
  ai_tools: "AI tools",
  file_sharing: "File sharing",
  messaging: "Messaging",
  remote_access: "Remote access",
  anonymizer: "Anonymizer",
  p2p: "Peer-to-peer",
  vpn: "VPN",
  other: "Other",
};

function riskBadge(level: number) {
  if (level >= 85) return { label: "Critical", className: "bg-red-500/10 text-red-400" };
  if (level >= 65) return { label: "High", className: "bg-orange-500/10 text-orange-400" };
  if (level >= 40) return { label: "Medium", className: "bg-yellow-500/10 text-yellow-400" };
  return { label: "Low", className: "bg-green-500/10 text-green-400" };
}

type CatalogApp = {
  id: string;
  name: string;
  vendor: string;
  category: string;
  description: string;
  risk_level: number;
  process_names: string[];
  bundle_ids: string[];
  path_patterns: string[];
  domains: string[];
  icon_url?: string;
};

function AppIcon({ app, size = 40 }: { app: Pick<CatalogApp, "name" | "icon_url">; size?: number }) {
  if (app.icon_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={app.icon_url} alt="" width={size} height={size} className="rounded-lg object-contain bg-white/5" style={{ width: size, height: size }} />;
  }
  const initials = app.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded-lg bg-muted text-muted-foreground flex items-center justify-center font-semibold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || <ImageIcon className="w-4 h-4" />}
    </div>
  );
}

export default function ApplicationCatalogPage() {
  const qc = useQueryClient();
  const [editApp, setEditApp] = useState<CatalogApp | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CatalogApp | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["app-catalog"],
    queryFn: appCatalogApi.list,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => appCatalogApi.delete(id),
    onSuccess: () => {
      toast.success("Application removed from the catalog");
      qc.invalidateQueries({ queryKey: ["app-catalog"] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not delete the application"),
  });

  const apps: CatalogApp[] = data?.data?.applications ?? [];
  const filtered = apps.filter((a) => {
    if (category && a.category !== category) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.vendor?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Application Catalog</h2>
          <p className="text-sm text-muted-foreground mt-1">
            The built-in application list every organization sees for Application Control — name, logo, and detection rules
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add application
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or vendor..."
            className="flex-1 min-w-[200px] px-3 py-2 border border-border bg-background rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border border-border bg-background rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Application</th>
                <th className="text-left px-5 py-3 font-medium">Category</th>
                <th className="text-left px-5 py-3 font-medium">Risk</th>
                <th className="text-left px-5 py-3 font-medium">Detection</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(5)].map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-muted rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-[#6B6B6B]">
                    <AppWindow className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No applications match
                  </td>
                </tr>
              ) : (
                filtered.map((app) => {
                  const risk = riskBadge(app.risk_level);
                  const detection = [
                    app.process_names?.length ? `${app.process_names.length} process` : null,
                    app.domains?.length ? `${app.domains.length} domain` : null,
                  ].filter(Boolean).join(", ") || "—";
                  return (
                    <tr key={app.id} className="hover:bg-muted transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <AppIcon app={app} />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{app.name}</p>
                            {app.vendor && <p className="text-xs text-muted-foreground truncate">{app.vendor}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{CATEGORY_LABELS[app.category] ?? app.category}</td>
                      <td className="px-5 py-4">
                        <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", risk.className)}>{risk.label}</span>
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">{detection}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setEditApp(app)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Edit">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteTarget(app)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(showCreate || editApp) && (
        <AppFormModal
          app={editApp}
          onClose={() => { setShowCreate(false); setEditApp(null); }}
          onDone={() => {
            setShowCreate(false);
            setEditApp(null);
            qc.invalidateQueries({ queryKey: ["app-catalog"] });
          }}
        />
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} className="max-w-md">
        {deleteTarget && (
          <div className="p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete {deleteTarget.name}?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Removes it from every organization&apos;s catalog and deletes any org&apos;s existing rule against it. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleteMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AppFormModal({ app, onClose, onDone }: { app: CatalogApp | null; onClose: () => void; onDone: () => void }) {
  const isEdit = !!app;
  const [name, setName] = useState(app?.name ?? "");
  const [vendor, setVendor] = useState(app?.vendor ?? "");
  const [category, setCategory] = useState(app?.category ?? "other");
  const [description, setDescription] = useState(app?.description ?? "");
  const [riskLevel, setRiskLevel] = useState(app?.risk_level ?? 50);
  const [domains, setDomains] = useState((app?.domains ?? []).join("\n"));
  const [processes, setProcesses] = useState((app?.process_names ?? []).join("\n"));
  const [bundles, setBundles] = useState((app?.bundle_ids ?? []).join("\n"));
  const [iconPreview, setIconPreview] = useState<string | null>(app?.icon_url ?? null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const split = (v: string) => v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: AppCatalogInput = {
        name, vendor, category, description,
        risk_level: riskLevel,
        domains: split(domains),
        process_names: split(processes),
        bundle_ids: split(bundles),
      };
      const res = isEdit ? await appCatalogApi.update(app!.id, payload) : await appCatalogApi.create(payload);
      const id = isEdit ? app!.id : res.data.id;
      if (iconFile && id) {
        await appCatalogApi.uploadIcon(id, iconFile);
      }
      return res;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Application updated" : "Application added");
      onDone();
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Could not save the application"),
  });

  const onPickIcon = (f: File | null) => {
    setIconFile(f);
    if (f) setIconPreview(URL.createObjectURL(f));
  };

  const inputClass = "w-full px-3 py-2 border border-border bg-background rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <Modal open onClose={onClose} className="max-w-lg">
      <div className="p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-foreground">{isEdit ? "Edit application" : "Add application"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-4 mb-5">
          <AppIcon app={{ name: name || "?", icon_url: iconPreview ?? undefined }} size={56} />
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500/10 text-brand-500 hover:bg-brand-500/20 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" /> {iconPreview ? "Change logo" : "Upload logo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon"
              className="hidden"
              onChange={(e) => onPickIcon(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-[#6B6B6B] mt-1">PNG, JPEG, SVG, or WebP · under 512KB{!isEdit && " · saved after the application is created"}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="ChatGPT" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Vendor</label>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputClass} placeholder="OpenAI" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Risk level ({riskLevel})</label>
            <input type="range" min={0} max={100} value={riskLevel} onChange={(e) => setRiskLevel(Number(e.target.value))} className="w-full mt-3" />
          </div>
        </div>
        <div className="mb-3">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="AI chat assistant" />
        </div>
        <div className="mb-3">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Backend domains <span className="text-[#6B6B6B] font-normal">(one per line — subdomains covered automatically)</span></label>
          <textarea value={domains} onChange={(e) => setDomains(e.target.value)} rows={3} className={cn(inputClass, "font-mono")} placeholder={"chatgpt.com\napi.openai.com"} />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Process names <span className="text-[#6B6B6B] font-normal">(optional)</span></label>
            <textarea value={processes} onChange={(e) => setProcesses(e.target.value)} rows={2} className={cn(inputClass, "font-mono")} placeholder="chatgpt.exe" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">macOS bundle IDs <span className="text-[#6B6B6B] font-normal">(optional)</span></label>
            <textarea value={bundles} onChange={(e) => setBundles(e.target.value)} rows={2} className={cn(inputClass, "font-mono")} placeholder="com.openai.chat" />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={!name.trim() || saveMut.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? "Save changes" : "Add application"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

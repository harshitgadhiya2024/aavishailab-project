"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Check, Info, Laptop, Loader2, PowerOff, Search, ShieldOff, Users, User, Globe2, X } from "lucide-react";
import { appControlApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  categoryLabel, installedLabel, riskBadge, type AppGroup, type AppRule, type CatalogApp, type Targets,
} from "./appGroups";

/*
 * The one place an admin blocks an app: who it applies to, how it is
 * stopped, and what that will affect — then one button. Works on an app seen
 * on devices (a group) or on a catalog app nobody has installed yet.
 *
 * Saves only through the existing endpoints:
 *   everyone / teams → the app's company-wide rule (POST /applications/rules,
 *                      idempotent per app)
 *   specific people  → each person's own rule (POST /installed/:id/control)
 */

type Who = "all" | "team" | "people";
type Employee = { id: string; first_name?: string; last_name?: string; email?: string; team_id?: string | null };
type Team = { id: string; name: string; member_count?: number };

export type DrawerTarget = { kind: "group"; group: AppGroup } | { kind: "catalog"; app?: CatalogApp };

/** "remote access", "VPN", "AI tool": a category as it reads mid-sentence. */
const categoryNoun = (c?: string) => {
  const label = categoryLabel(c);
  return /^[A-Z]{2,}/.test(label) ? label : label.toLowerCase();
};

const empName = (e?: Employee) => (e ? [e.first_name, e.last_name].filter(Boolean).join(" ") || e.email || "Unknown" : "Unknown");

export function BlockDrawer({ target, catalog, teams, employees, onClose }: {
  target: DrawerTarget;
  catalog: CatalogApp[];
  teams: Team[];
  employees: Employee[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<CatalogApp | undefined>(target.kind === "catalog" ? target.app : undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal="true">
      <aside className="ac-drawer flex h-full w-full max-w-[520px] flex-col border-l border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <style>{`.ac-drawer{animation:ac-in .22s cubic-bezier(.2,.8,.2,1)}@keyframes ac-in{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}@media (prefers-reduced-motion: reduce){.ac-drawer{animation:none}}`}</style>
        {target.kind === "group" ? (
          <BlockForm key={target.group.key} group={target.group} catalog={catalog} teams={teams} employees={employees} onClose={onClose} />
        ) : picked ? (
          <BlockForm key={picked.id} catalogApp={picked} catalog={catalog} teams={teams} employees={employees} onClose={onClose} onBack={() => setPicked(undefined)} />
        ) : (
          <CatalogPicker catalog={catalog} onPick={setPicked} onClose={onClose} />
        )}
      </aside>
    </div>
  );
}

/* ── Pick an app that isn't installed anywhere yet ─────────────────────── */

function CatalogPicker({ catalog, onPick, onClose }: { catalog: CatalogApp[]; onPick: (a: CatalogApp) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return catalog
      .filter(a => !term || `${a.name} ${a.vendor ?? ""} ${categoryLabel(a.category)}`.toLowerCase().includes(term))
      .slice(0, 60);
  }, [catalog, q]);

  return (
    <>
      <DrawerHeader title="Block an app" subtitle="Block it before anyone installs it. Pick from apps Aavishield already knows how to stop." onClose={onClose} />
      <div className="border-b border-border px-5 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Telegram, AnyDesk, ChatGPT…" className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
      </div>
      <ul className="flex-1 divide-y divide-border overflow-y-auto">
        {list.map(a => {
          const r = riskBadge(a.risk_level ?? 0);
          const blocked = !!a.rule && a.rule.enabled && (a.rule.block_network || a.rule.block_process);
          return (
            <li key={a.id}>
              <button type="button" onClick={() => onPick(a)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-elevated">
                <AppIcon name={a.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{categoryLabel(a.category)}{a.vendor ? ` · ${a.vendor}` : ""}</span>
                </span>
                {blocked ? <span className="text-xs text-danger">Blocked</span> : <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", r.className)}>{r.label}</span>}
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted-foreground">No app matches. Try its company name.</li>}
      </ul>
    </>
  );
}

/* ── Who, how, impact ──────────────────────────────────────────────────── */

function BlockForm({ group, catalogApp, catalog, teams, employees, onClose, onBack }: {
  group?: AppGroup; catalogApp?: CatalogApp; catalog: CatalogApp[]; teams: Team[]; employees: Employee[];
  onClose: () => void; onBack?: () => void;
}) {
  const qc = useQueryClient();
  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const appId = group?.appId ?? catalogApp?.id;
  const entry = useMemo(() => catalog.find(c => c.id === appId), [catalog, appId]);
  const name = group?.name ?? catalogApp!.name;
  const vendor = group?.vendor || catalogApp?.vendor || "";
  const category = group?.category ?? catalogApp?.category ?? "other";
  const risk = group?.risk ?? catalogApp?.risk_level ?? 0;
  // Cutting an app's internet needs to know its servers. Apps Aavishield has
  // only seen on a device (not in the catalog) have none on record, so closing
  // the app is what actually stops them.
  const knowsServers = (entry?.domains?.length ?? 0) > 0;

  const orgRule: AppRule | undefined = group?.orgRule ?? (catalogApp?.rule && !catalogApp.rule.employee_id && catalogApp.rule.enabled ? catalogApp.rule : undefined);
  const personRules = group?.personRules ?? new Map<string, AppRule>();
  const hasBlock = !!orgRule || personRules.size > 0;

  const initialWho: Who = orgRule ? (orgRule.targets?.scope === "team" ? "team" : "all") : personRules.size ? "people" : "all";
  const firstRule = orgRule ?? [...personRules.values()][0];
  const [who, setWho] = useState<Who>(initialWho);
  const [teamIds, setTeamIds] = useState<string[]>(orgRule?.targets?.team_ids ?? []);
  const [personIds, setPersonIds] = useState<string[]>([...personRules.keys()]);
  const [net, setNet] = useState(firstRule ? firstRule.block_network : knowsServers);
  const [proc, setProc] = useState(firstRule ? firstRule.block_process : !knowsServers);
  const [alsoCategory, setAlsoCategory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const siblings = useMemo(
    () => (category && category !== "other" ? catalog.filter(c => c.category === category && c.id !== appId) : []),
    [catalog, category, appId],
  );

  // People who have the app, for the "specific people" list and the preview.
  const holders = useMemo(() => {
    const m = new Map<string, { name: string; devices: number; teamId?: string | null }>();
    for (const i of group?.installs ?? []) {
      if (!i.employee_id) continue;
      const cur = m.get(i.employee_id);
      m.set(i.employee_id, { name: i.employee_name || empName(empById.get(i.employee_id)), devices: (cur?.devices ?? 0) + 1, teamId: empById.get(i.employee_id)?.team_id });
    }
    return m;
  }, [group, empById]);

  const impact = useMemo(() => {
    const installs = group?.installs ?? [];
    if (who === "people") {
      const d = installs.filter(i => i.employee_id && personIds.includes(i.employee_id)).length;
      return { devices: d, people: personIds.length, future: false };
    }
    if (who === "team") {
      const inTeams = (id?: string | null) => !!id && teamIds.includes(empById.get(id)?.team_id ?? "");
      const d = installs.filter(i => inTeams(i.employee_id)).length;
      const p = new Set(installs.filter(i => inTeams(i.employee_id)).map(i => i.employee_id)).size;
      return { devices: d, people: p, future: true };
    }
    return { devices: group?.devices ?? 0, people: group?.people.size ?? 0, future: true };
  }, [who, personIds, teamIds, group, empById]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["app-control"] }),
      qc.invalidateQueries({ queryKey: ["installed-apps"] }),
    ]);
  };

  /** The catalog id rules hang on; promotes a never-catalogued app first. */
  async function ensureAppId(): Promise<string> {
    if (appId) return appId;
    const row = group!.installs[0];
    // Switching nothing on creates the catalog entry and leaves no rule behind.
    await appControlApi.setControl(row.id, { all_employees: true, block_network: false, block_process: false });
    const res = await appControlApi.installed({ search: row.name, limit: 200, include_removed: true });
    const fresh = (res.data?.data ?? []).find((r: any) => r.id === row.id);
    if (!fresh?.application_id) throw new Error("Couldn't prepare this app for blocking. Try again.");
    return fresh.application_id as string;
  }

  /** One install row per employee, for per-person rules. */
  const rowFor = (empId: string) => group?.installs.find(i => i.employee_id === empId);

  async function save() {
    setError("");
    if (!net && !proc) return setError("Pick at least one way to stop it.");
    if (who === "team" && teamIds.length === 0) return setError("Choose at least one team.");
    if (who === "people" && personIds.length === 0) return setError("Choose at least one person.");
    setBusy(true);
    try {
      if (who === "people") {
        // Per-person rules; a company-wide rule would override them.
        if (orgRule) await appControlApi.deleteRule(orgRule.id);
        for (const id of personIds) {
          const row = rowFor(id);
          if (row) await appControlApi.setControl(row.id, { block_network: net, block_process: proc });
        }
        for (const id of personRules.keys()) {
          if (personIds.includes(id)) continue;
          const row = rowFor(id);
          if (row) await appControlApi.setControl(row.id, { block_network: false, block_process: false });
        }
      } else {
        const id = await ensureAppId();
        const targets: Targets = who === "team" ? { scope: "team", team_ids: teamIds } : { scope: "all" };
        await appControlApi.createRule({ application_id: id, block_network: net, block_process: proc, enabled: true, targets });
        // One-person rules are covered now; drop them so status stays honest.
        for (const empId of personRules.keys()) {
          const row = rowFor(empId);
          if (row) await appControlApi.setControl(row.id, { block_network: false, block_process: false });
        }
        if (alsoCategory) {
          for (const s of siblings) {
            await appControlApi.createRule({ application_id: s.id, block_network: true, block_process: proc, enabled: true, targets });
          }
        }
      }
      await refresh();
      toast.success(`${name} blocked${alsoCategory ? ` with ${siblings.length} other ${categoryNoun(category)} apps` : ""}. Devices pick it up within a minute.`);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Couldn't save the block. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function unblock() {
    setBusy(true);
    setError("");
    try {
      if (orgRule) await appControlApi.deleteRule(orgRule.id);
      for (const empId of personRules.keys()) {
        const row = rowFor(empId);
        if (row) await appControlApi.setControl(row.id, { block_network: false, block_process: false });
      }
      await refresh();
      toast.success(`${name} is allowed again.`);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Couldn't remove the block. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const r = riskBadge(risk);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const count = (n: number, one: string, many: string) => (n === 0 ? many : `${n} ${n === 1 ? one : many}`);
  const saveLabel = who === "all" ? "Block for everyone" : who === "team" ? `Block for ${count(teamIds.length, "team", "teams")}` : `Block for ${count(personIds.length, "person", "people")}`;

  return (
    <>
      <DrawerHeader
        title={hasBlock ? `Edit block: ${name}` : `Block ${name}`}
        subtitle={[categoryLabel(category), vendor].filter(Boolean).join(" · ")}
        badge={<span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", r.className)}>{r.label} risk</span>}
        icon={<AppIcon name={name} size="lg" />}
        onBack={onBack}
        onClose={onClose}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section>
          <Step n={1} title="Who" />
          <div className="grid grid-cols-3 gap-2">
            <Choice on={who === "all"} onClick={() => setWho("all")} icon={Globe2} label="Everyone" />
            <Choice on={who === "team"} onClick={() => setWho("team")} icon={Users} label="Teams" disabled={teams.length === 0} hint={teams.length === 0 ? "No teams yet" : undefined} />
            <Choice on={who === "people"} onClick={() => setWho("people")} icon={User} label="People" disabled={!group || holders.size === 0} hint={!group ? "Once installed" : undefined} />
          </div>
          {who === "all" && <p className="mt-2 text-xs text-muted-foreground">Every device in the company, including anyone who installs it later.</p>}
          {who === "team" && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {teams.map(t => (
                <button key={t.id} type="button" onClick={() => setTeamIds(l => toggle(l, t.id))} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors", teamIds.includes(t.id) ? "border-brand-500 bg-brand-500/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                  {teamIds.includes(t.id) && <Check className="h-3 w-3 text-brand-500" />}{t.name}
                  {t.member_count != null && <span className="text-subtle">{t.member_count}</span>}
                </button>
              ))}
            </div>
          )}
          {who === "people" && (
            <ul className="mt-3 max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {[...holders.entries()].map(([id, h]) => (
                <li key={id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-elevated">
                    <input type="checkbox" checked={personIds.includes(id)} onChange={() => setPersonIds(l => toggle(l, id))} />
                    <span className="flex-1 text-foreground">{h.name}</span>
                    <span className="text-xs text-subtle">{h.devices} device{h.devices === 1 ? "" : "s"}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <Step n={2} title="How" />
          <div className="space-y-2">
            <HowOption
              on={net} onClick={() => setNet(v => !v)} icon={ShieldOff}
              title="Cut off its internet" tag={knowsServers ? "Recommended" : undefined}
              body={knowsServers ? "The app stays installed but can't reach its servers, so it stops working." : "Aavishield doesn't know this app's servers yet, so this won't stop it on its own."}
              muted={!knowsServers}
            />
            <HowOption
              on={proc} onClick={() => setProc(v => !v)} icon={PowerOff}
              title="Close it whenever it opens" tag={!knowsServers ? "Recommended" : undefined}
              body="The app is shut as soon as it starts, and the employee sees a notice explaining why."
            />
          </div>
          {siblings.length > 0 && who !== "people" && (
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm hover:bg-elevated">
              <input type="checkbox" className="mt-0.5" checked={alsoCategory} onChange={e => setAlsoCategory(e.target.checked)} />
              <span>
                <span className="text-foreground">Also block every other {categoryNoun(category)} app we know ({siblings.length})</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{siblings.slice(0, 5).map(s => s.name).join(", ")}{siblings.length > 5 ? ` and ${siblings.length - 5} more` : ""}, so a switch to a similar tool doesn't get around it.</span>
              </span>
            </label>
          )}
        </section>

        {group && (
          <section>
            <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">Installed on</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {group.installs.map(i => {
                const seen = installedLabel(i);
                const personal = i.employee_id ? personRules.get(i.employee_id) : undefined;
                return (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{i.employee_name || "Unassigned"}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-subtle"><Laptop className="h-3 w-3" />{i.device_name || "Unknown device"}{i.version ? ` · ${i.version}` : ""}</span>
                    </span>
                    <span className="text-right text-xs text-subtle">
                      {personal && <span className="block text-danger">Blocked for them</span>}
                      {seen.exact ? seen.text : `first seen ${seen.text}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <footer className="border-t border-border px-5 py-4">
        <p className="mb-3 flex items-start gap-2 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {impact.devices === 0 && impact.future ? (
            <span>Nobody {who === "team" ? "in those teams " : ""}has it installed yet. It's blocked the moment anyone {who === "team" ? "there " : ""}installs it.</span>
          ) : (
            <span>
              Affects <span className="font-medium text-foreground">{impact.devices} device{impact.devices === 1 ? "" : "s"}</span>
              {impact.people > 0 && <> of {impact.people} {impact.people === 1 ? "person" : "people"}</>} right now
              {impact.future ? ", and anyone who installs it later." : "."}
            </span>
          )}
        </p>
        {error && <p className="mb-3 text-[13px] text-danger">{error}</p>}
        <div className="flex items-center gap-2">
          {hasBlock && (
            <button type="button" disabled={busy} onClick={unblock} className="mr-auto inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground hover:bg-elevated hover:text-foreground disabled:opacity-50">
              Allow again
            </button>
          )}
          <button type="button" onClick={onClose} className={cn("inline-flex h-9 items-center rounded-md border border-border px-4 text-sm text-foreground hover:bg-elevated", !hasBlock && "ml-auto")}>Cancel</button>
          <button type="button" disabled={busy} onClick={save} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            {hasBlock ? "Save" : saveLabel}
          </button>
        </div>
      </footer>
    </>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────── */

function DrawerHeader({ title, subtitle, badge, icon, onBack, onClose }: {
  title: string; subtitle?: string; badge?: React.ReactNode; icon?: React.ReactNode; onBack?: () => void; onClose: () => void;
}) {
  return (
    <header className="flex items-start gap-3 border-b border-border px-5 py-4">
      {icon}
      <div className="min-w-0 flex-1">
        {onBack && <button type="button" onClick={onBack} className="mb-1 text-xs text-brand-600 hover:underline dark:text-brand-300">← All apps</button>}
        <h2 className="truncate text-base font-medium text-foreground">{title}</h2>
        {(subtitle || badge) && <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{subtitle}{badge}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-elevated hover:text-foreground"><X className="h-4 w-4" /></button>
    </header>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">{n} · {title}</p>;
}

function Choice({ on, onClick, icon: Icon, label, disabled, hint }: { on: boolean; onClick: () => void; icon: React.ElementType; label: string; disabled?: boolean; hint?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={hint} className={cn("flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45", on ? "border-brand-500 bg-brand-500/[0.07] text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
      <Icon className={cn("h-4 w-4", on && "text-brand-500")} />
      {label}
      {hint && <span className="text-[10.5px] text-subtle">{hint}</span>}
    </button>
  );
}

function HowOption({ on, onClick, icon: Icon, title, body, tag, muted }: { on: boolean; onClick: () => void; icon: React.ElementType; title: string; body: string; tag?: string; muted?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className={cn("flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors", on ? "border-brand-500 bg-brand-500/[0.06]" : "border-border hover:bg-elevated")}>
      <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded border", on ? "border-brand-500 bg-brand-500 text-white" : "border-border")}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", on ? "text-brand-500" : "text-subtle")} />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">{title}{tag && <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-success">{tag}</span>}</span>
        <span className={cn("mt-0.5 block text-xs", muted ? "text-warning" : "text-muted-foreground")}>{body}</span>
      </span>
    </button>
  );
}

export function AppIcon({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-md border border-border bg-elevated font-medium text-muted-foreground", size === "lg" ? "size-10 text-base" : "size-8 text-[13px]")}>
      {letter}
    </span>
  );
}

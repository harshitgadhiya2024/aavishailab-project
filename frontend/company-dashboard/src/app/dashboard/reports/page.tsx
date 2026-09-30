"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { reportApi } from "@/lib/api";
import {
  BarChart3, Shield, FileWarning, Users, Monitor, FileText, Inbox, LayoutDashboard, Globe, AppWindow, Clock,
  Download, Loader2, Sparkles, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, FileSpreadsheet, FileDown, Sheet,
} from "lucide-react";
import { formatNumber, cn } from "@/lib/utils";
import { Pagination } from "@/components/ui/Pagination";
import { Markdown } from "@/components/ui/Markdown";
import { toast } from "sonner";
import { CONTROLS, type ControlId } from "@/lib/controls";
import { PERIOD_LABELS, periodFor, periodParams, periodText, validateRange, type Period, type PeriodId } from "@/lib/report-period";
import { PeriodPicker } from "@/components/reports/PeriodPicker";
import { ControlTrend } from "@/components/reports/ControlTrend";
import { BarList } from "@/components/reports/BarList";

const AI_URL = process.env.NEXT_PUBLIC_AI_URL || "http://localhost:6002";

const ICONS: Record<string, React.ElementType> = {
  "layout-dashboard": LayoutDashboard, shield: Shield, "file-warning": FileWarning, globe: Globe,
  "app-window": AppWindow, users: Users, clock: Clock, monitor: Monitor, "file-text": FileText, inbox: Inbox,
};

const ALL_PERIODS: PeriodId[] = ["today", "yesterday", "7d", "30d", "this_month", "last_month", "3m", "12m"];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function filenameFrom(disposition: string | undefined, fallback: string) {
  const m = disposition?.match(/filename="?([^"]+)"?/);
  return m?.[1] ?? fallback;
}

/** Narrative read of the executive summary, written by the org's AI service from aggregate counts only. */
function AIBriefing({ period, report }: { period: Period; report: any }) {
  const { data: session } = useSession();
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => setSummary(""), [period.start, period.end]);

  const generate = async () => {
    const token = (session as any)?.accessToken;
    if (!token) return;
    setLoading(true);
    setSummary("");
    try {
      const facts = {
        period: periodText(period),
        summary: report?.summary ?? [],
        measures: (report?.rows ?? []).map((r: any[]) => ({ area: r[0], measure: r[1], this_period: r[2], previous: r[3], change: r[4] })),
      };
      const res = await fetch(`${AI_URL}/api/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          max_tokens: 600,
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content:
                "You are a security analyst writing for a company's IT administrator. Given aggregate security " +
                "figures, write 2-3 sentences on what they show, then 3-5 bullet points of concrete next steps. " +
                "Cite the numbers you were given and never invent data. If everything is zero, say so plainly and " +
                "say what to check. Format as GitHub-flavored markdown.",
            },
            { role: "user", content: `Security figures for ${periodText(period)}:\n${JSON.stringify(facts)}` },
          ],
        }),
      });
      if (!res.ok) throw new Error(`AI service returned ${res.status}`);
      const json = await res.json();
      setSummary(json?.choices?.[0]?.message?.content ?? "No summary returned.");
    } catch (e: any) {
      toast.error(e.message || "Could not generate the briefing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-500" />
            <h3 className="font-semibold text-foreground text-sm">AI briefing</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            A written read of these numbers with next steps. Only aggregate counts are sent, never names or events.
          </p>
        </div>
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {summary ? "Regenerate" : "Write briefing"}
        </button>
      </div>
      {summary && <div className="mt-4 bg-elevated rounded-lg p-4 text-body"><Markdown content={summary} /></div>}
    </div>
  );
}

function ExportMenu({ disabled, onExport, busy }: { disabled: boolean; onExport: (f: "pdf" | "xlsx" | "csv") => void; busy: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const items = [
    { id: "pdf" as const, icon: FileDown, label: "PDF", hint: "Formatted report to share or print" },
    { id: "xlsx" as const, icon: FileSpreadsheet, label: "Excel", hint: "Summary and data sheets, all rows" },
    { id: "csv" as const, icon: Sheet, label: "CSV", hint: "Plain rows for other tools" },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} disabled={disabled || !!busy}
        className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        Export <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-xl">
          {items.map((it) => (
            <button key={it.id} onClick={() => { setOpen(false); onExport(it.id); }}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-elevated">
              <it.icon className="w-4 h-4 mt-0.5 text-brand-500" />
              <span>
                <span className="block text-sm font-medium text-foreground">{it.label}</span>
                <span className="block text-xs text-muted-foreground">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportsInner() {
  const params = useSearchParams();
  const [reportType, setReportType] = useState(params.get("report") || "executive");
  const [control, setControl] = useState<ControlId | "">((params.get("control") as ControlId) || "");
  const [period, setPeriod] = useState<Period>(() => {
    const id = (params.get("period") as PeriodId) || "30d";
    const start = params.get("start"), end = params.get("end");
    if (id === "custom" && start && end && !validateRange(start, end)) return periodFor("custom", { start, end });
    return PERIOD_LABELS[id] ? periodFor(id) : periodFor("30d");
  });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => { setPage(1); setSort(null); setQ(""); }, [reportType, control, period.start, period.end]);

  const { data: catalogData } = useQuery({ queryKey: ["report-catalog"], queryFn: () => reportApi.catalog() });
  const catalog: any[] = catalogData?.data?.reports ?? [];

  const apiParams = { ...periodParams(period), ...(reportType === "incidents" && control ? { control } : {}) };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["report", reportType, period.start, period.end, control],
    queryFn: () => reportApi.get(reportType, apiParams),
  });

  const report = data?.data ?? {};
  const columns: string[] = report.columns ?? [];
  const rows: any[][] = report.rows ?? [];
  const active = catalog.find((r) => r.id === reportType);
  const filterLabel = reportType === "incidents" && control ? CONTROLS.find((c) => c.id === control)?.label : "";

  const visible = useMemo(() => {
    let out = rows;
    if (q.trim()) {
      const needle = q.toLowerCase();
      out = out.filter((r) => r.some((c) => String(c ?? "").toLowerCase().includes(needle)));
    }
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.col], y = b[sort.col];
        if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
        return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }) * sort.dir;
      });
    }
    return out;
  }, [rows, q, sort]);
  const paged = visible.slice((page - 1) * limit, page * limit);

  const doExport = async (format: "pdf" | "xlsx" | "csv") => {
    setBusy(format);
    const base = `delsecure_${reportType}_${period.start}_to_${period.end}`;
    try {
      if (format === "pdf") {
        const { downloadReportPdf } = await import("@/lib/report-pdf");
        await downloadReportPdf(
          { name: report.name ?? active?.name ?? "Report", columns, rows: sort || q ? visible : rows, summary: report.summary ?? [], charts: report.charts ?? [] },
          { period: `${periodText(period)} (${report.period?.tz ?? ""})`, filename: `${base}.pdf`, filter: [filterLabel, q && `Search: "${q}"`].filter(Boolean).join(", ") }
        );
      } else {
        const res = await reportApi.export(reportType, format, apiParams);
        downloadBlob(res.data, filenameFrom(res.headers?.["content-disposition"], `${base}.${format}`));
      }
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch {
      toast.error("Export failed. Try a shorter period.");
    } finally {
      setBusy("");
    }
  };

  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const r of catalog) (g[r.group] ??= []).push(r);
    return Object.entries(g);
  }, [catalog]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Reports</h2>
        <p className="text-sm text-muted-foreground mt-1">Choose a report and a period, review it here, then export it as PDF, Excel or CSV.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Report list */}
        <nav aria-label="Reports" className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">{group}</p>
              <ul className="space-y-0.5">
                {items.map((r) => {
                  const Icon = ICONS[r.icon] ?? BarChart3;
                  const selected = r.id === reportType;
                  return (
                    <li key={r.id}>
                      <button onClick={() => setReportType(r.id)}
                        className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-left transition-colors",
                          selected ? "bg-brand-500/10 text-brand-500 font-medium" : "text-body hover:bg-elevated")}>
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        {r.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          {/* Report header */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 max-w-2xl">
                <h3 className="text-lg font-semibold text-foreground">{active?.name ?? "Report"}</h3>
                <p className="text-sm text-muted-foreground mt-1">{active?.description}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <PeriodPicker value={period} onChange={setPeriod} options={ALL_PERIODS} />
                <ExportMenu disabled={isLoading} busy={busy} onExport={doExport} />
              </div>
            </div>

            {reportType === "incidents" && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {[{ id: "" as const, label: "All controls" }, ...CONTROLS].map((c) => (
                  <button key={c.id || "all"} onClick={() => setControl(c.id as ControlId | "")}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      control === c.id ? "border-brand-500 bg-brand-500/10 text-brand-500" : "border-border text-muted-foreground hover:text-foreground")}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            {(report.summary ?? []).length > 0 && (
              <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                {(report.summary as any[]).map((s) => (
                  <div key={s.label} className="rounded-lg bg-elevated px-4 py-3">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="mt-1 text-xl font-bold text-foreground tabular-nums">{typeof s.value === "number" ? formatNumber(s.value) : s.value}</p>
                    {s.hint && <p className="mt-0.5 text-[11px] text-subtle">{s.hint}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {reportType === "executive" && !isLoading && <AIBriefing period={period} report={report} />}

          {/* Charts */}
          {(report.charts ?? []).length > 0 && (
            <div className={cn("grid gap-4", report.charts.length > 1 && "xl:grid-cols-2")}>
              {(report.charts as any[]).map((c, i) => {
                const hasData = c.type === "trend" ? c.data.some((p: any) => p.total > 0) : c.data.length > 0;
                return (
                  <div key={i} className="bg-card rounded-xl border border-border shadow-sm p-5">
                    <h4 className="font-semibold text-foreground text-sm mb-4">{c.title}</h4>
                    {!hasData ? (
                      <p className="py-10 text-center text-sm text-subtle">Nothing in this period</p>
                    ) : c.type === "trend" ? (
                      <ControlTrend data={c.data} height={240} />
                    ) : (
                      <BarList items={c.data.map((r: any) => ({ label: r.label, value: r.count }))} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Table */}
          <div className="bg-card rounded-xl border border-border shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-muted-foreground">
                {isLoading || isFetching ? "Building report…" : (
                  <>
                    <span className="font-semibold text-foreground tabular-nums">{formatNumber(visible.length)}</span>
                    {q ? ` of ${formatNumber(rows.length)}` : ""} rows · {periodText(period)}
                    {report.truncated && <span className="ml-2 text-warning">Showing the latest {formatNumber(rows.length)}. Export for all rows.</span>}
                  </>
                )}
              </p>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search this report"
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    {columns.map((col, i) => {
                      const dir = sort?.col === i ? sort.dir : 0;
                      const Icon = dir === 1 ? ArrowUp : dir === -1 ? ArrowDown : ArrowUpDown;
                      return (
                        <th key={col} className="px-4 py-3 text-left font-medium whitespace-nowrap">
                          <button onClick={() => setSort(dir === 0 ? { col: i, dir: -1 } : dir === -1 ? { col: i, dir: 1 } : null)}
                            className="inline-flex items-center gap-1 hover:text-foreground">
                            {col} <Icon className={cn("w-3 h-3", !dir && "opacity-40")} />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-elevated">
                  {isLoading ? (
                    [...Array(6)].map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {(columns.length ? columns : [0, 0, 0, 0, 0]).map((__, j) => (
                          <td key={j} className="px-4 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                        ))}
                      </tr>
                    ))
                  ) : visible.length === 0 ? (
                    <tr>
                      <td colSpan={Math.max(columns.length, 1)} className="text-center py-14 text-subtle text-sm">
                        <Download className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        {q ? "No rows match your search." : "Nothing to report for this period. Try a longer one."}
                      </td>
                    </tr>
                  ) : (
                    paged.map((row, i) => (
                      <tr key={i} className="hover:bg-elevated transition-colors">
                        {row.map((cell, j) => (
                          <td key={j} className="px-4 py-3 text-body text-xs max-w-[280px] truncate" title={String(cell ?? "")}>
                            {cell === "" || cell == null ? "—" : typeof cell === "number" ? formatNumber(cell) : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(visible.length / limit))}
              total={visible.length}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(n) => { setLimit(n); setPage(1); }}
              limitOptions={[25, 50, 100]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="h-64 rounded-xl bg-card border border-border animate-pulse" />}>
      <ReportsInner />
    </Suspense>
  );
}

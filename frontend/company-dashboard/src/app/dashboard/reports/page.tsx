"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { reportApi } from "@/lib/api";
import {
  BarChart3, Shield, FileWarning, Bug, Cloud, Users, Monitor, FileText, Inbox,
  LayoutDashboard, Download, Loader2, Sparkles, Calendar, FileJson, Table2,
} from "lucide-react";
import { formatNumber, cn } from "@/lib/utils";
import { useChartTheme } from "@/lib/chart-theme";
import { Pagination } from "@/components/ui/Pagination";
import { Markdown } from "@/components/ui/Markdown";
import { toast } from "sonner";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Legend, LabelList,
} from "recharts";

const AI_URL = process.env.NEXT_PUBLIC_AI_URL || "http://localhost:6002";

const PERIODS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 180 days", days: 180 },
  { label: "Last 365 days", days: 365 },
];

const ICONS: Record<string, React.ElementType> = {
  "layout-dashboard": LayoutDashboard,
  shield: Shield,
  "file-warning": FileWarning,
  bug: Bug,
  cloud: Cloud,
  users: Users,
  monitor: Monitor,
  "file-text": FileText,
  inbox: Inbox,
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Narrative summary of the current period, written by the org's AI service. */
function AISummary({ days, report }: { days: number; report: any }) {
  const { data: session } = useSession();
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    const token = (session as any)?.accessToken;
    if (!token) return;
    setLoading(true);
    setSummary("");
    try {
      // The model only ever sees aggregate counts — never event rows, file
      // names or employee identifiers.
      const facts = {
        period_days: days,
        summary: report?.summary ?? {},
        rows_sampled: Math.min(report?.total ?? 0, 25),
        charts: (report?.charts ?? []).map((c: any) => ({ title: c.title, data: c.data })),
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
                "You are a security analyst writing for a company's IT administrator. " +
                "Given aggregate security telemetry, write a short briefing: 2-3 sentences of " +
                "what the numbers show, then 3-5 bullet points of concrete recommended actions. " +
                "Be specific and factual, cite the numbers you were given, and never invent data. " +
                "If the figures are all zero, say plainly that there is no activity yet and what to check. " +
                "Format the reply as GitHub-flavored markdown: short paragraphs, a bulleted list for the " +
                "actions, bold for key numbers, and a table when comparing several items.",
            },
            { role: "user", content: `Security telemetry for the last ${days} days:\n${JSON.stringify(facts)}` },
          ],
        }),
      });
      if (!res.ok) throw new Error(`AI service returned ${res.status}`);
      const json = await res.json();
      setSummary(json?.choices?.[0]?.message?.content ?? "No summary returned.");
    } catch (e: any) {
      toast.error(e.message || "Could not generate the AI summary");
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
            A written read of this period&apos;s numbers, with recommended next steps. Only aggregate
            counts are sent — no event rows, file names or employee details.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {summary ? "Regenerate" : "Generate briefing"}
        </button>
      </div>
      {summary && (
        <div className="mt-4 bg-elevated rounded-lg p-4 text-body">
          <Markdown content={summary} />
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const chart = useChartTheme();
  const [days, setDays] = useState(30);
  const [reportType, setReportType] = useState("executive");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [exporting, setExporting] = useState("");

  const { data: catalogData } = useQuery({
    queryKey: ["report-catalog"],
    queryFn: () => reportApi.catalog(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["report", reportType, days],
    queryFn: () => reportApi.get(reportType, { days }),
  });

  const catalog = catalogData?.data?.reports ?? [];
  const report = data?.data ?? {};
  const columns: string[] = report.columns ?? [];
  const rows: any[][] = report.rows ?? [];
  const charts: any[] = report.charts ?? [];

  const pagedRows = useMemo(
    () => rows.slice((page - 1) * limit, page * limit),
    [rows, page, limit]
  );

  const active = catalog.find((r: any) => r.id === reportType);

  const exportCsv = async () => {
    setExporting("csv");
    try {
      const res = await reportApi.exportCsv(reportType, { days });
      downloadBlob(res.data, `${reportType}-report-${days}d.csv`);
      toast.success("CSV downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting("");
    }
  };

  const exportJson = () => {
    setExporting("json");
    try {
      const payload = {
        report: reportType,
        period: report.period,
        generated_at: new Date().toISOString(),
        columns,
        rows,
        summary: report.summary,
      };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        `${reportType}-report-${days}d.json`);
      toast.success("JSON downloaded");
    } finally {
      setExporting("");
    }
  };

  const tooltip = {
    contentStyle: chart.tooltip as any,
    labelStyle: { color: chart.axis, fontSize: 11 },
    itemStyle: { fontSize: 11 },
  };
  const axis = { stroke: chart.axis, fontSize: 11, tickLine: false, axisLine: false };

  const renderChart = (c: any) => {
    const data = c.data ?? [];
    if (data.length === 0) return null;

    if (c.type === "trend") {
      const series = data.map((p: any) => ({ ...p, label: shortDate(p.date) }));
      return (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={series} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} allowDecimals={false} width={44} />
            <Tooltip {...tooltip} />
            <Legend wrapperStyle={{ fontSize: 11, color: chart.axis }} iconType="plainline" />
            <Area type="monotone" dataKey="blocked" name="Blocked" stroke={chart.action.blocked}
              strokeWidth={2} fill="none" dot={false} />
            <Area type="monotone" dataKey="alerted" name="Alerted" stroke={chart.action.alerted}
              strokeWidth={2} fill="none" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    const barData = data.map((r: any) => ({
      name: String(r.label ?? r.domain ?? r.name ?? "").replace(/_/g, " ").slice(0, 28),
      count: r.count ?? r.incidents ?? 0,
    }));
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
          <XAxis type="number" {...axis} allowDecimals={false} />
          <YAxis type="category" dataKey="name" {...axis} width={150} />
          <Tooltip {...tooltip} cursor={{ fill: chart.grid, opacity: 0.3 }} />
          <Bar dataKey="count" name="Events" radius={[0, 4, 4, 0]} barSize={14}>
            {barData.map((_: any, i: number) => (
              <Cell key={i} fill={chart.sequential[Math.max(0, chart.sequential.length - 1 - i)]} />
            ))}
            <LabelList dataKey="count" position="right" fill={chart.axis} fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Security Reports</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a report and a period, review it on screen, then export it
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
            <Calendar className="w-4 h-4 text-subtle" />
            <select
              value={days}
              onChange={e => { setDays(Number(e.target.value)); setPage(1); }}
              className="bg-transparent text-sm text-foreground focus:outline-none"
            >
              {PERIODS.map(p => <option key={p.days} value={p.days}>{p.label}</option>)}
            </select>
          </div>
          <button
            onClick={exportCsv}
            disabled={!!exporting || rows.length === 0}
            className="flex items-center gap-2 border border-border text-body hover:bg-elevated px-3 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {exporting === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Table2 className="w-4 h-4" />}
            Export CSV
          </button>
          <button
            onClick={exportJson}
            disabled={!!exporting || rows.length === 0}
            className="flex items-center gap-2 border border-border text-body hover:bg-elevated px-3 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <FileJson className="w-4 h-4" /> Export JSON
          </button>
        </div>
      </div>

      {/* Report picker */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {catalog.map((r: any) => {
          const Icon = ICONS[r.icon] ?? BarChart3;
          const selected = r.id === reportType;
          return (
            <button
              key={r.id}
              onClick={() => { setReportType(r.id); setPage(1); }}
              className={cn(
                "text-left rounded-xl border p-4 transition-all",
                selected
                  ? "border-brand-500 bg-brand-500/10"
                  : "border-border bg-card hover:bg-elevated"
              )}
            >
              <Icon className={cn("w-4 h-4 mb-2", selected ? "text-brand-500" : "text-subtle")} />
              <p className={cn("text-sm font-medium", selected ? "text-foreground" : "text-body")}>{r.name}</p>
              <p className="text-[11px] text-subtle mt-1 line-clamp-2">{r.description}</p>
            </button>
          );
        })}
      </div>

      <AISummary days={days} report={report} />

      {/* Charts for this report */}
      {charts.length > 0 && (
        <div className={cn("grid gap-4", charts.length > 1 ? "lg:grid-cols-2" : "")}>
          {charts.map((c: any, i: number) => (
            <div key={i} className="bg-card rounded-xl border border-border shadow-sm p-5">
              <h3 className="font-semibold text-foreground text-sm mb-4">{c.title}</h3>
              {renderChart(c) ?? (
                <div className="h-[240px] flex items-center justify-center text-subtle text-sm">
                  No data for this period
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* The report table itself */}
      <div className="bg-card rounded-xl border border-border shadow-sm">
        <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-foreground text-sm">{active?.name ?? "Report"}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLoading ? "Building report…" : `${formatNumber(rows.length)} rows · last ${days} days`}
            </p>
          </div>
          {report.summary && Object.keys(report.summary).length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              {Object.entries(report.summary).map(([k, v]) => (
                <span key={k} className="text-xs text-muted-foreground">
                  {k.replace(/_/g, " ")}: <span className="text-foreground font-semibold tabular-nums">{String(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                {columns.map(col => (
                  <th key={col} className="px-5 py-3 text-left font-medium whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {(columns.length ? columns : [0, 0, 0, 0]).map((__, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="text-center py-12 text-subtle text-sm">
                    <Download className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Nothing to report for this period — try a longer window.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, i) => (
                  <tr key={i} className="hover:bg-elevated transition-colors">
                    {row.map((cell, j) => (
                      <td key={j} className="px-5 py-3 text-body text-xs max-w-[280px] truncate" title={String(cell)}>
                        {String(cell ?? "—") || "—"}
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
          totalPages={Math.ceil(rows.length / limit)}
          total={rows.length}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={n => { setLimit(n); setPage(1); }}
        />
      </div>
    </div>
  );
}

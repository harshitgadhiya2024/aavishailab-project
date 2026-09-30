"use client";

import { useState } from "react";
import { FileDown, FileSpreadsheet, Sheet, Loader2, FileBarChart2 } from "lucide-react";
import { toast } from "sonner";
import { reportApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export type ReportAttachment = {
  type: string;
  name: string;
  start: string;
  end: string;
  tz: string;
  control?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  rows: number;
  summary: { label: string; value: any; hint?: string }[];
};

function fmt(d: string) {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download card for a report the assistant prepared. Files are built fresh from live data. */
export function ReportCard({ r }: { r: ReportAttachment }) {
  const [busy, setBusy] = useState("");
  const params: Record<string, string> = { start: r.start, end: r.end, tz: r.tz };
  if (r.control) params.control = r.control;
  if (r.employee_id) params.employee_id = r.employee_id;
  const slug = r.employee_name ? `_${r.employee_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  const base = `delsecure_${r.type}${slug}_${r.start}_to_${r.end}`;
  const period = r.start === r.end ? fmt(r.start) : `${fmt(r.start)} to ${fmt(r.end)}`;

  const get = async (f: "pdf" | "xlsx" | "csv") => {
    setBusy(f);
    try {
      if (f === "pdf") {
        const res = await reportApi.get(r.type, params);
        const d = res.data;
        const { downloadReportPdf } = await import("@/lib/report-pdf");
        await downloadReportPdf(
          { name: d.name ?? r.name, columns: d.columns ?? [], rows: d.rows ?? [], summary: d.summary ?? [], charts: d.charts ?? [] },
          { period: `${period} (${r.tz})`, filename: `${base}.pdf`, filter: r.employee_name ? `Employee: ${r.employee_name}` : undefined },
        );
      } else {
        const res = await reportApi.export(r.type, f, params);
        download(res.data, `${base}.${f}`);
      }
    } catch {
      toast.error("Could not download the report");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 p-3">
        <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-500">
          <FileBarChart2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {r.name}{r.employee_name ? ` · ${r.employee_name}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">{period} · {r.rows.toLocaleString()} row{r.rows === 1 ? "" : "s"}</p>
        </div>
      </div>
      {r.summary?.length > 0 && (
        <div className="grid grid-cols-2 gap-px border-y border-border bg-border">
          {r.summary.slice(0, 4).map((s, i, all) => (
            <div key={s.label} className={cn("bg-card px-3 py-2", all.length % 2 === 1 && i === all.length - 1 && "col-span-2")}>
              <p className="truncate text-[11px] text-muted-foreground">{s.label}</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">{String(s.value)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5 p-2">
        {([["pdf", "PDF", FileDown], ["xlsx", "Excel", FileSpreadsheet], ["csv", "CSV", Sheet]] as const).map(([f, label, Icon]) => (
          <button key={f} onClick={() => get(f)} disabled={!!busy}
            className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
              f === "pdf" ? "bg-brand-500 text-white hover:bg-brand-600" : "border border-border text-body hover:bg-elevated")}>
            {busy === f ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

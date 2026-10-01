/**
 * Branded PDF for a report, built in the browser from the data already on
 * screen. Loaded on demand (dynamic import) so jsPDF never ships with the
 * dashboard bundle.
 */

export const PDF_ROW_LIMIT = 2000;

type Report = {
  name: string;
  columns: string[];
  rows: any[][];
  summary: { label: string; value: any; hint?: string }[];
  charts: { type: string; title: string; data: any[] }[];
};

const ORANGE: [number, number, number] = [255, 112, 0];
const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];

const CONTROL_LABELS: Record<string, string> = {
  dlp: "Data protection", web: "Web filtering", apps: "App control",
  vpn: "VPN & bypass", threats: "Malware & threats", devices: "Device health",
};

/** The Aavishield logo as a data URL for jsPDF, or null if it can't be fetched. */
async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch("/brand/logo-horizontal-tagline-light.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadReportPdf(report: Report, opts: { period: string; filename: string; filter?: string }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);

  const landscape = report.columns.length > 6;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  // Header band
  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, pageW, 6, "F");
  const logo = await loadLogo();
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  if (logo) {
    // Brand lockup with tagline is 1400x354; draw it 30pt tall.
    doc.addImage(logo, "PNG", margin, 22, 30 * (1400 / 354), 30);
  } else {
    doc.setFontSize(12);
    doc.text("Aavishield", margin, 43);
  }

  doc.setFontSize(20);
  doc.text(report.name, margin, 84);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const sub = [opts.period, opts.filter].filter(Boolean).join("  |  ");
  doc.text(sub, margin, 102);
  doc.text(`Generated ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`, margin, 116);

  let y = 136;

  // Summary figures, as a compact two-column table
  if (report.summary.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: "plain",
      body: report.summary.map((s) => [s.label, `${s.value}${s.hint ? `  (${s.hint})` : ""}`]),
      styles: { fontSize: 10, cellPadding: 5, textColor: INK },
      columnStyles: { 0: { textColor: MUTED, cellWidth: 200 }, 1: { fontStyle: "bold" } },
    });
    y = (doc as any).lastAutoTable.finalY + 18;
  }

  // Charts become small ranked tables: they print legibly and stay accurate.
  for (const c of report.charts) {
    const data = c.data ?? [];
    if (!data.length) continue;
    let head: string[];
    let body: any[][];
    if (c.type === "trend") {
      const present = Object.keys(CONTROL_LABELS).filter((k) => data.some((p: any) => p[k] > 0));
      if (!present.length) continue;
      head = ["Period", ...present.map((k) => CONTROL_LABELS[k]), "Total"];
      body = data.filter((p: any) => p.total > 0).map((p: any) => [p.t.replace("T", " "), ...present.map((k) => p[k] ?? 0), p.total]);
      if (!body.length) continue;
    } else {
      head = ["", "Count"];
      body = data.slice(0, 10).map((r: any) => [r.label, r.count]);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 50; }
    doc.text(c.title, margin, y);
    autoTable(doc, {
      startY: y + 6,
      margin: { left: margin, right: margin },
      head: [head],
      body,
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [243, 244, 246], textColor: INK, fontStyle: "bold" },
    });
    y = (doc as any).lastAutoTable.finalY + 18;
  }

  // The report table itself
  const rows = report.rows.slice(0, PDF_ROW_LIMIT).map((r) => r.map((v) => (v == null ? "" : String(v))));
  if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 50; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(`Details (${report.rows.length.toLocaleString()} rows)`, margin, y);
  if (report.rows.length > PDF_ROW_LIMIT) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`First ${PDF_ROW_LIMIT.toLocaleString()} rows shown. Export to Excel or CSV for all rows.`, margin, y + 14);
    y += 14;
  }
  autoTable(doc, {
    startY: y + 6,
    margin: { left: margin, right: margin, bottom: 40 },
    head: [report.columns],
    body: rows.length ? rows : [[{ content: "Nothing to report for this period.", colSpan: report.columns.length }]],
    theme: "striped",
    styles: { fontSize: 7.5, cellPadding: 3.5, overflow: "linebreak" },
    headStyles: { fillColor: ORANGE, textColor: [10, 10, 10], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 251] },
  });

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const h = doc.internal.pageSize.getHeight();
    doc.text(`Aavishield  |  ${report.name}  |  Confidential`, margin, h - 20);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, h - 20, { align: "right" });
  }

  doc.save(opts.filename);
}

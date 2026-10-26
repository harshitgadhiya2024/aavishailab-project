/**
 * Branded PDF for a report, built in the browser from the data already on
 * screen. Loaded on demand (dynamic import) so jsPDF never ships with the
 * dashboard bundle.
 */

import { MARK } from "@/components/brand/BrandLogo";

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

/**
 * The Aavishield logo (the website's mark plus "Aavishield" in Sora SemiBold)
 * drawn onto a canvas, as a PNG data URL for jsPDF with its pixel size, or null
 * if the browser can't draw it.
 */
async function loadLogo(): Promise<{ url: string; w: number; h: number } | null> {
  try {
    const family = getComputedStyle(document.body).getPropertyValue("--font-sora").trim() || "sans-serif";
    const px = 120; // drawn large, then scaled down in the PDF so it stays sharp
    const font = `600 ${px}px ${family}`;
    await document.fonts.load(font);
    const canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.font = font;
    // Same proportions as BrandLogo: mark 1.22em tall, 0.28em from the word.
    const markH = px * 1.22;
    const markW = markH * (181 / 190);
    const gap = px * 0.28;
    canvas.width = Math.ceil(markW + gap + ctx.measureText("Aavishield").width + px * 0.1);
    canvas.height = Math.ceil(markH);
    ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.save();
    ctx.scale(markH / 190, markH / 190);
    ctx.translate(-446, -445);
    ctx.fillStyle = "#ff7000";
    ctx.fill(new Path2D(MARK));
    ctx.restore();
    ctx.font = font;
    ctx.fillStyle = "#0b0b0d";
    ctx.textBaseline = "middle";
    ctx.fillText("Aavishield", markW + gap, markH / 2 + px * 0.04);
    return { url: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
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
    // Drawn 24pt tall, keeping the canvas's aspect ratio.
    doc.addImage(logo.url, "PNG", margin, 24, 24 * (logo.w / logo.h), 24);
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

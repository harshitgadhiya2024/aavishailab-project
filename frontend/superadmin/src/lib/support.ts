export const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "bg-brand-500/10 text-brand-500 border-brand-500/20" },
  in_progress: { label: "In progress", tone: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  resolved: { label: "Resolved", tone: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" },
  closed: { label: "Closed", tone: "bg-muted text-muted-foreground border-border" },
};

export const PRIORITIES = [
  { id: "normal", label: "Normal", hint: "A question or something that can wait a day" },
  { id: "high", label: "High", hint: "Something is broken for several people" },
  { id: "urgent", label: "Urgent", hint: "Protection is down or sensitive data may be exposed" },
] as const;

export function priorityTone(p: string) {
  return p === "urgent" ? "text-red-500" : p === "high" ? "text-yellow-500" : "text-muted-foreground";
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Mirrors the API's allowlist, so a bad file is caught before upload.
export const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.zip";
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function checkFiles(current: File[], incoming: File[]): { files: File[]; error?: string } {
  const allowed = ACCEPT.split(",");
  const next = [...current];
  for (const f of incoming) {
    const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
    if (!allowed.includes(ext)) return { files: current, error: `${f.name}: attach images, PDF, text, CSV, log or ZIP files` };
    if (f.size > MAX_FILE_BYTES) return { files: current, error: `${f.name} is larger than 10 MB` };
    if (next.length >= MAX_FILES) return { files: current, error: `Attach up to ${MAX_FILES} files` };
    next.push(f);
  }
  return { files: next };
}

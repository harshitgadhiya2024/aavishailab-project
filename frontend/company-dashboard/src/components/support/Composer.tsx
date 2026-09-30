"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, Send, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ACCEPT, checkFiles, fileSize } from "@/lib/support";

/** Reply box with attachments. Ctrl/Cmd+Enter sends. */
export function Composer({
  onSend, sending, placeholder = "Write a reply…", note, submitLabel = "Send reply",
}: {
  onSend: (body: string, files: File[]) => Promise<boolean>;
  sending: boolean;
  placeholder?: string;
  note?: string;
  submitLabel?: string;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const r = checkFiles(files, Array.from(list));
    if (r.error) toast.error(r.error);
    setFiles(r.files);
  };

  const send = async () => {
    if (!body.trim() || sending) return;
    if (await onSend(body.trim(), files)) {
      setBody("");
      setFiles([]);
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
      className={cn("rounded-xl border bg-card shadow-sm transition-colors", drag ? "border-brand-500 ring-2 ring-brand-500/20" : "border-border")}
    >
      <label htmlFor="composer" className="sr-only">Your message</label>
      <textarea
        id="composer"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
        placeholder={placeholder}
        rows={4}
        className="block w-full resize-y rounded-t-xl bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-subtle focus:outline-none"
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-4 pb-3">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-body">
              <FileText className="h-3.5 w-3.5 text-subtle" />
              <span className="max-w-[180px] truncate">{f.name}</span>
              <span className="text-subtle">{fileSize(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-subtle hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <Paperclip className="h-4 w-4" /> Attach
          </button>
          {note && <span className="hidden text-xs text-subtle sm:inline">{note}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[11px] text-subtle md:inline">Ctrl + Enter to send</span>
          <button type="button" onClick={send} disabled={!body.trim() || sending}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

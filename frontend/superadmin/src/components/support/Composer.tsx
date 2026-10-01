"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, Send, X, FileText, Lock, MessageSquareReply, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ACCEPT, checkFiles, fileSize } from "@/lib/support";

export type SendOptions = { internal: boolean; resolve: boolean };

/** Support reply box: reply to the customer or leave an internal note. */
export function Composer({
  onSend, sending, customerName,
}: {
  onSend: (body: string, files: File[], opts: SendOptions) => Promise<boolean>;
  sending: boolean;
  customerName: string;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const r = checkFiles(files, Array.from(list));
    if (r.error) toast.error(r.error);
    setFiles(r.files);
  };

  const send = async (resolve: boolean) => {
    if (!body.trim() || sending) return;
    if (await onSend(body.trim(), files, { internal, resolve })) {
      setBody("");
      setFiles([]);
    }
  };

  return (
    <div className={cn("rounded-xl border bg-card shadow-sm", internal ? "border-dashed border-yellow-500/60 bg-yellow-500/5" : "border-border")}>
      <div className="flex gap-1 border-b border-border p-1.5">
        {[
          { v: false, label: "Reply to customer", icon: MessageSquareReply },
          { v: true, label: "Internal note", icon: Lock },
        ].map((o) => (
          <button key={o.label} type="button" onClick={() => setInternal(o.v)}
            className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
              internal === o.v ? (o.v ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" : "bg-brand-500/10 text-brand-500") : "text-muted-foreground hover:text-foreground")}>
            <o.icon className="h-3.5 w-3.5" /> {o.label}
          </button>
        ))}
      </div>
      <label htmlFor="sa-composer" className="sr-only">Message</label>
      <textarea id="sa-composer" value={body} onChange={(e) => setBody(e.target.value)} rows={4}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(false); } }}
        placeholder={internal ? "Only the Aavishield team sees this note…" : `Reply to ${customerName}. They'll get it by email too…`}
        className="block w-full resize-y bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-4 pb-3">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[160px] truncate">{f.name}</span>
              <span className="text-muted-foreground">{fileSize(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          <Paperclip className="h-4 w-4" /> Attach
        </button>
        <div className="flex items-center gap-2">
          {!internal && (
            <button type="button" onClick={() => send(true)} disabled={!body.trim() || sending}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> Send and resolve
            </button>
          )}
          <button type="button" onClick={() => send(false)} disabled={!body.trim() || sending}
            className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50",
              internal ? "bg-yellow-600 hover:bg-yellow-700" : "bg-brand-500 hover:bg-brand-600")}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : internal ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {internal ? "Add note" : "Send reply"}
          </button>
        </div>
      </div>
    </div>
  );
}

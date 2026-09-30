"use client";

import { FileText, ImageIcon, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { cn, getInitials } from "@/lib/utils";
import { fileSize, fullTime, timeAgo } from "@/lib/support";

export type ThreadMessage = {
  id: string;
  side: "customer" | "support" | "system";
  internal: boolean;
  source?: string;
  body: string;
  created_at: string;
  author_name: string;
  author_email?: string;
  attachments: { id: string; file_name: string; content_type: string; size: number }[];
};

const URL_RE = /(https?:\/\/[^\s<]+)/g;
const IS_URL = /^https?:\/\//;

/** Plain text with line breaks kept and bare URLs made clickable. */
function Body({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-body">
      {parts.map((p, i) =>
        IS_URL.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-brand-500 underline underline-offset-2">{p}</a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </p>
  );
}

export function Thread({
  messages, selfEmail, openAttachment,
}: {
  messages: ThreadMessage[];
  selfEmail?: string;
  openAttachment: (attachmentId: string) => Promise<string>;
}) {
  const open = async (aid: string) => {
    // Open the tab synchronously so pop-up blockers allow it, then point it
    // at the short-lived link once the API returns it.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = await openAttachment(aid);
      if (tab) tab.location.href = url;
    } catch {
      tab?.close();
      toast.error("Could not open the file");
    }
  };

  return (
    <ol className="space-y-4">
      {messages.map((m) => {
        if (m.side === "system") {
          return (
            <li key={m.id} className="flex items-center gap-3 px-2 text-xs text-subtle">
              <span className="h-px flex-1 bg-border" />
              <span>{m.body} · {timeAgo(m.created_at)}</span>
              <span className="h-px flex-1 bg-border" />
            </li>
          );
        }
        const support = m.side === "support";
        const you = !support && selfEmail && m.author_email === selfEmail;
        return (
          <li key={m.id}
            className={cn(
              "overflow-hidden rounded-xl border bg-card shadow-sm",
              support ? "border-brand-500/25" : "border-border",
              m.internal && "border-dashed border-yellow-500/50 bg-yellow-500/5"
            )}>
            <div className={cn("flex items-start justify-between gap-3 border-b px-4 py-3", support ? "border-brand-500/15 bg-brand-500/5" : "border-border")}>
              <div className="flex min-w-0 items-center gap-3">
                <div className={cn("grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-xs font-semibold",
                  support ? "bg-brand-500 text-white" : "bg-elevated text-body")}>
                  {support ? "D" : getInitials(m.author_name || "?")}
                </div>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {you ? "You" : m.author_name}
                    {support && <span className="rounded-md bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-500">Delsecure Support</span>}
                    {m.source === "email" && <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-500">via email</span>}
                    {m.internal && <span className="rounded-md bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">Internal note</span>}
                  </p>
                  {!support && m.author_email && !you && <p className="truncate text-xs text-subtle">{m.author_email}</p>}
                </div>
              </div>
              <time dateTime={m.created_at} title={fullTime(m.created_at)} className="flex-shrink-0 text-xs text-subtle">
                {fullTime(m.created_at)}
              </time>
            </div>
            <div className="px-4 py-4">
              <Body text={m.body} />
              {m.attachments.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Paperclip className="h-3.5 w-3.5" /> {m.attachments.length} attachment{m.attachments.length > 1 ? "s" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {m.attachments.map((a) => {
                      const Icon = a.content_type.startsWith("image/") ? ImageIcon : FileText;
                      return (
                        <button key={a.id} type="button" onClick={() => open(a.id)}
                          className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-left text-xs hover:border-brand-500/40 hover:bg-brand-500/5">
                          <Icon className="h-4 w-4 text-brand-500" />
                          <span className="max-w-[200px] truncate text-body">{a.file_name}</span>
                          <span className="text-subtle">{fileSize(a.size)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, X, Maximize2, Minimize2, Plus, History, ArrowUp, Square, ChevronLeft, Trash2, MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { streamChat, aiChatApi, type ChatTurn } from "@/lib/api";
import { usePermissions, PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/Markdown";
import { ReportCard, type ReportAttachment } from "./ReportCard";
import { useTypewriter } from "./useTypewriter";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: string;
  attachments?: ReportAttachment[];
  error?: boolean;
};

const QUICK_REPLIES = [
  "What needs my attention today?",
  "Which devices are offline right now?",
  "Show the latest DLP alerts",
  "Who had the most incidents this week?",
  "Export this month's executive summary",
  "How do I block social media for a team?",
];

const SESSION_KEY = "delsecure-assistant-session";
const ATTACHMENT_TOOL = "report_attachment";
let seq = 0;
const nid = () => `m${Date.now()}-${seq++}`;

function viewerTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

/** One assistant reply: typed out while streaming, markdown-rendered throughout. */
function AssistantBubble({ m }: { m: Msg }) {
  const text = useTypewriter(m.content, !!m.streaming);
  const typing = m.streaming && text.length < m.content.length;
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-brand-500 text-white">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {text ? (
          <div className={cn("rounded-2xl rounded-tl-sm border px-3.5 py-2.5 text-foreground",
            m.error ? "border-red-500/30 bg-red-500/5" : "border-border bg-elevated")}>
            <Markdown content={text} className="[&_table]:text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap" />
            {(typing || (m.streaming && !m.status)) && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-brand-500" />}
          </div>
        ) : m.streaming ? (
          <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-elevated px-3.5 py-2.5 text-xs text-muted-foreground">
            <span className="flex gap-1">
              {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500/70" style={{ animationDelay: `${d}ms` }} />)}
            </span>
            {m.status ?? "Thinking…"}
          </div>
        ) : null}
        {text && m.streaming && m.status && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" /> {m.status}
          </p>
        )}
        {m.attachments?.map((a, i) => <ReportCard key={i} r={a} />)}
      </div>
    </div>
  );
}

export function AssistantWidget() {
  const { data: session } = useSession();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  const user = (session as any)?.user;
  const token = (session as any)?.accessToken as string | undefined;
  const firstName = (user?.first_name as string) || (user?.full_name as string)?.split(" ")[0] || "";
  const allowed = can(PERMISSIONS.aiUse);

  const { data: sessionsData } = useQuery({
    queryKey: ["ai-sessions"],
    queryFn: () => aiChatApi.listSessions(),
    enabled: !!token && open && view === "history",
  });
  const sessions: any[] = sessionsData?.data?.data ?? [];

  // Open from anywhere: the old /dashboard/ai-assistant route leaves a flag
  // (it may run before this mounts), and any link can dispatch the event.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("delsecure-open-assistant")) {
        sessionStorage.removeItem("delsecure-open-assistant");
        setOpen(true);
      }
    } catch {}
  }, []);
  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent).detail?.prompt;
      if (q) setInput(q);
    };
    window.addEventListener("delsecure:open-assistant", onOpen);
    return () => window.removeEventListener("delsecure:open-assistant", onOpen);
  }, []);

  // Keyboard: Esc closes.
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, busy]);

  const load = useCallback(async (id: string) => {
    try {
      const res = await aiChatApi.getSession(id);
      const out: Msg[] = [];
      for (const m of res.data?.messages ?? []) {
        if (m.role === "tool" && m.tool_name === ATTACHMENT_TOOL) {
          try {
            const a = JSON.parse(m.content);
            const last = out[out.length - 1];
            if (last?.role === "assistant") last.attachments = [...(last.attachments ?? []), a];
            else out.push({ id: nid(), role: "assistant", content: "", attachments: [a] });
          } catch { /* ignore a malformed card */ }
        } else if (m.role === "user" || m.role === "assistant") {
          out.push({ id: nid(), role: m.role, content: m.content });
        }
      }
      setSessionId(id);
      setMsgs(out);
      setView("chat");
      try { localStorage.setItem(SESSION_KEY, id); } catch {}
    } catch {
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    }
  }, []);

  // Resume the last conversation the first time the panel opens.
  const resumed = useRef(false);
  useEffect(() => {
    if (!open || resumed.current || !token) return;
    resumed.current = true;
    let id: string | null = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch {}
    if (id) load(id);
  }, [open, token, load]);

  useEffect(() => {
    if (open && view === "chat") setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, view]);

  // Follow new output, including text being typed out, unless the reader
  // scrolled up to read something earlier.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current, inner = contentRef.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [open, view]);

  // Grow the input with its content, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [input]);

  const history = useMemo<ChatTurn[]>(
    () => msgs.filter((m) => m.content && !m.error).map((m) => ({ role: m.role, content: m.content })),
    [msgs]
  );

  const newChat = () => {
    abortRef.current?.abort();
    setMsgs([]);
    setSessionId(null);
    setView("chat");
    setInput("");
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  };

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMsgs((prev) => {
      const next = [...prev];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !token || !user?.org_id) return;
    setInput("");
    setBusy(true);
    stick.current = true;
    const turns: ChatTurn[] = [...history, { role: "user", content: text }];
    setMsgs((p) => [...p, { id: nid(), role: "user", content: text }, { id: nid(), role: "assistant", content: "", streaming: true }]);

    let sid = sessionId;
    try {
      if (!sid) {
        sid = (await aiChatApi.createSession({})).data?.id ?? null;
        setSessionId(sid);
        if (sid) try { localStorage.setItem(SESSION_KEY, sid); } catch {}
      }
      if (sid) await aiChatApi.addMessage(sid, { role: "user", content: text });
    } catch { /* history is a convenience; the answer still comes */ }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let answer = "";
    const cards: ReportAttachment[] = [];
    try {
      for await (const ev of streamChat(turns, {
        accessToken: token, orgId: user.org_id, orgName: user.org_name, tz: viewerTz(), signal: ctrl.signal,
      })) {
        if (ev.type === "chunk") {
          answer += ev.content ?? "";
          patchLast((m) => ({ ...m, content: answer, status: undefined }));
        } else if (ev.type === "reset") {
          answer = "";
          patchLast((m) => ({ ...m, content: "" }));
        } else if (ev.type === "status") {
          patchLast((m) => ({ ...m, status: ev.content }));
        } else if (ev.type === "attachment" && ev.report) {
          cards.push(ev.report);
          patchLast((m) => ({ ...m, attachments: [...cards] }));
        } else if (ev.type === "error") {
          answer = ev.content ?? "The assistant couldn't answer right now.";
          patchLast((m) => ({ ...m, content: answer, error: true }));
        }
      }
      patchLast((m) => ({ ...m, streaming: false, status: undefined }));
      if (sid) {
        if (answer) await aiChatApi.addMessage(sid, { role: "assistant", content: answer }).catch(() => {});
        for (const c of cards) {
          await aiChatApi.addMessage(sid, { role: "tool", tool_name: ATTACHMENT_TOOL, content: JSON.stringify(c) }).catch(() => {});
        }
        qc.invalidateQueries({ queryKey: ["ai-sessions"] });
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        patchLast((m) => ({ ...m, streaming: false, status: undefined, content: m.content || "_Stopped._" }));
      } else {
        patchLast((m) => ({ ...m, streaming: false, status: undefined, error: true,
          content: "I couldn't reach the assistant just now. Please try again in a moment." }));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const stop = () => abortRef.current?.abort();

  const remove = async (id: string) => {
    try {
      await aiChatApi.deleteSession(id);
      if (id === sessionId) newChat();
      qc.invalidateQueries({ queryKey: ["ai-sessions"] });
    } catch {
      toast.error("Could not delete that conversation");
    }
  };

  if (!allowed || !session) return null;

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close assistant" : "Open Delsecure AI assistant"}
        aria-expanded={open}
        className={cn(
          "fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-brand-500 text-white shadow-[0_12px_32px_-8px_rgb(255_112_0/0.7)] transition-all duration-300 hover:scale-105 hover:bg-brand-600 active:scale-95",
          open && "max-sm:hidden"
        )}
      >
        <span className={cn("absolute transition-all duration-300", open ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-50 opacity-0")}>
          <X className="h-6 w-6" />
        </span>
        <span className={cn("absolute transition-all duration-300", open ? "-rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100")}>
          <Sparkles className="h-6 w-6" />
        </span>
        {!open && <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-brand-500/30 [animation-duration:3s]" />}
      </button>

      {/* Panel */}
      <section
        role="dialog"
        aria-label="Delsecure AI assistant"
        aria-hidden={!open}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border border-border bg-card shadow-2xl transition-all duration-300 ease-out",
          "max-sm:inset-0 max-sm:rounded-none",
          big
            ? "sm:bottom-24 sm:right-5 sm:h-[min(820px,calc(100vh-7.5rem))] sm:w-[min(760px,calc(100vw-2.5rem))] sm:rounded-2xl"
            : "sm:bottom-24 sm:right-5 sm:h-[min(640px,calc(100vh-7.5rem))] sm:w-[400px] sm:rounded-2xl",
          open ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-4 scale-95 opacity-0",
          "origin-bottom-right"
        )}
      >
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-brand-500/10 to-transparent px-3 py-2.5">
          {view === "history" ? (
            <button onClick={() => setView("chat")} aria-label="Back" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-500 text-white"><Sparkles className="h-4 w-4" /></span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{view === "history" ? "Conversations" : "Delsecure Assistant"}</p>
            {view === "chat" && <p className="truncate text-[11px] text-muted-foreground">Live data · read-only</p>}
          </div>
          {view === "chat" && (
            <>
              <button onClick={() => setView("history")} title="Conversations" aria-label="Conversations"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><History className="h-4 w-4" /></button>
              <button onClick={newChat} title="New chat" aria-label="New chat"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="h-4 w-4" /></button>
            </>
          )}
          <button onClick={() => setBig((b) => !b)} title={big ? "Smaller" : "Larger"} aria-label={big ? "Smaller" : "Larger"}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground max-sm:hidden">
            {big ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        {view === "history" ? (
          <div className="flex-1 overflow-y-auto p-2">
            <button onClick={newChat} className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-foreground hover:bg-muted">
              <Plus className="h-4 w-4 text-brand-500" /> New conversation
            </button>
            {sessions.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No conversations yet</p>
            ) : sessions.map((s) => (
              <div key={s.id} className={cn("group flex items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-muted", s.id === sessionId && "bg-brand-500/10")}>
                <button onClick={() => load(s.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                  <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">{s.title}</span>
                    <span className="block text-[11px] text-muted-foreground">{s.message_count} messages · {timeAgo(s.updated_at)}</span>
                  </span>
                </button>
                <button onClick={() => remove(s.id)} aria-label="Delete conversation"
                  className="rounded p-1 text-muted-foreground opacity-0 hover:text-red-500 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div
              ref={listRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              }}
              className="flex-1 overflow-y-auto px-3.5 py-4"
              aria-live="polite"
            >
              <div ref={contentRef} className="space-y-4">
              {/* Welcome */}
              <div className="flex gap-2.5">
                <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-brand-500 text-white">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div className="rounded-2xl rounded-tl-sm border border-border bg-elevated px-3.5 py-2.5 text-sm text-foreground">
                  <p className="font-medium">Hi{firstName ? ` ${firstName}` : ""}! 👋 I&apos;m your Delsecure assistant.</p>
                  <p className="mt-1 text-muted-foreground">
                    Ask me anything about your organization&apos;s security: employees, devices, alerts, policies or reports.
                    I read your live data and can export reports, but I never change settings.
                  </p>
                </div>
              </div>
              {msgs.length === 0 && (
                <div className="flex flex-wrap gap-1.5 pl-9">
                  {QUICK_REPLIES.map((q) => (
                    <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                      className="rounded-full border border-brand-500/30 bg-brand-500/5 px-3 py-1.5 text-left text-xs text-brand-600 transition-colors hover:bg-brand-500/15 dark:text-brand-400">
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {msgs.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand-500 px-3.5 py-2.5 text-sm text-white">{m.content}</p>
                  </div>
                ) : (
                  <AssistantBubble key={m.id} m={m} />
                )
              )}
              </div>
            </div>

            {/* Composer */}
            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
                <label htmlFor="assistant-input" className="sr-only">Message the assistant</label>
                <textarea
                  id="assistant-input"
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Ask about employees, devices, alerts…"
                  className="max-h-[132px] flex-1 resize-none bg-transparent py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {busy ? (
                  <button onClick={stop} aria-label="Stop" title="Stop"
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-border text-foreground hover:bg-muted">
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : (
                  <button onClick={send} disabled={!input.trim()} aria-label="Send" title="Send (Enter)"
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:opacity-40">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Enter to send · Shift+Enter for a new line · AI can make mistakes</p>
            </div>
          </>
        )}
      </section>
    </>
  );
}

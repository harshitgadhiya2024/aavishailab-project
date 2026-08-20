"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { streamChat, aiChatApi, type ChatTurn } from "@/lib/api";
import {
  Send, User, Loader2, Wrench, Plus, Shield, MessageSquare, Trash2,
  Pencil, Check, X, StopCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/Markdown";
import { toast } from "sonner";

type Message = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
  isStreaming?: boolean;
};

const GREETING: Message = {
  role: "assistant",
  content:
    "I'm your Delsecure assistant. Ask me about incidents, employees or policies — " +
    "or tell me what to change and I'll do it. For example: *\"block social media for the Sales team\"*, " +
    "*\"who was blocked most this week?\"*, or *\"give me a DLP report for the last 30 days\"*.\n\n" +
    "If I need more detail before making a change, I'll ask first.",
};

const SUGGESTIONS = [
  "What happened in the last 7 days?",
  "Create a policy blocking file-sharing sites",
  "Who has the most blocked events?",
  "Show pending access requests",
  "Which SaaS apps are unreviewed?",
];

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Renders a tool result compactly — the model already explains it in prose. */
function toolSummary(tool: string, result: any): string {
  if (result && typeof result === "object") {
    if (result.error) return `${tool} — ${String(result.error).slice(0, 120)}`;
    const count =
      result.total ?? (Array.isArray(result.data) ? result.data.length : undefined) ??
      (Array.isArray(result) ? result.length : undefined);
    if (typeof count === "number") return `${tool} — ${count} result${count === 1 ? "" : "s"}`;
    if (result.id) return `${tool} — done`;
  }
  return tool;
}

export default function AIAssistantPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const token = (session as any)?.accessToken;
  const orgId = (session as any)?.user?.org_id;
  const orgName = (session as any)?.user?.org_name;

  const { data: sessionsData } = useQuery({
    queryKey: ["ai-sessions"],
    queryFn: () => aiChatApi.listSessions(),
    enabled: !!token,
  });
  const conversations = sessionsData?.data?.data ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const refreshSessions = () => qc.invalidateQueries({ queryKey: ["ai-sessions"] });

  const openConversation = async (id: string) => {
    try {
      const res = await aiChatApi.getSession(id);
      const stored = res.data?.messages ?? [];
      setSessionId(id);
      setMessages(
        stored.length === 0
          ? [GREETING]
          : stored.map((m: any) => ({
              role: m.role,
              content: m.content,
              tool_name: m.tool_name || undefined,
            }))
      );
    } catch {
      toast.error("Could not open that conversation");
    }
  };

  const newConversation = () => {
    setSessionId(null);
    setMessages([GREETING]);
    setInput("");
    textareaRef.current?.focus();
  };

  const removeConversation = async (id: string) => {
    try {
      await aiChatApi.deleteSession(id);
      if (sessionId === id) newConversation();
      refreshSessions();
      toast.success("Conversation deleted");
    } catch {
      toast.error("Could not delete that conversation");
    }
  };

  const saveRename = async (id: string) => {
    const title = renameValue.trim();
    if (!title) return setRenaming(null);
    try {
      await aiChatApi.renameSession(id, title);
      refreshSessions();
    } catch {
      toast.error("Could not rename");
    } finally {
      setRenaming(null);
    }
  };

  /** History the model needs: user/assistant turns only, tool chatter excluded. */
  const chatHistory = useMemo<ChatTurn[]>(
    () =>
      messages
        .filter(m => m.role === "user" || (m.role === "assistant" && m.content && m !== GREETING))
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    [messages]
  );

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || !token || !orgId) return;

    setInput("");
    setLoading(true);

    const history: ChatTurn[] = [...chatHistory, { role: "user", content: text }];
    setMessages(prev => [...prev, { role: "user", content: text }, { role: "assistant", content: "", isStreaming: true }]);

    // A thread is created on the first message rather than up-front, so an
    // abandoned empty chat never shows up in the sidebar.
    let activeSession = sessionId;
    try {
      if (!activeSession) {
        const created = await aiChatApi.createSession({});
        activeSession = created.data?.id ?? null;
        setSessionId(activeSession);
      }
      if (activeSession) {
        await aiChatApi.addMessage(activeSession, { role: "user", content: text });
        refreshSessions();
      }
    } catch {
      // Persistence failing shouldn't cost the user their answer — carry on
      // with the conversation in memory.
      toast.error("Conversation history could not be saved");
    }

    const controller = new AbortController();
    abortRef.current = controller;

    let answer = "";
    const toolNotes: { tool: string; summary: string }[] = [];

    try {
      for await (const event of streamChat(history, {
        accessToken: token, orgId, orgName, signal: controller.signal,
      })) {
        if (event.type === "chunk") {
          answer += event.content ?? "";
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: answer, isStreaming: true };
            return updated;
          });
        } else if (event.type === "message") {
          answer = event.content ?? answer;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: answer, isStreaming: true };
            return updated;
          });
        } else if (event.type === "tool_call") {
          setMessages(prev => {
            const updated = [...prev];
            updated.splice(updated.length - 1, 0, {
              role: "tool",
              content: `Running ${event.tool}…`,
              tool_name: event.tool,
            });
            return updated;
          });
        } else if (event.type === "tool_result") {
          const summary = toolSummary(event.tool, event.result);
          toolNotes.push({ tool: event.tool, summary });
          setMessages(prev => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === "tool" && updated[i].tool_name === event.tool) {
                updated[i] = { ...updated[i], content: summary };
                break;
              }
            }
            return updated;
          });
        } else if (event.type === "error") {
          // The service explains configuration failures in words; show that
          // rather than a generic "something went wrong".
          answer = event.content ?? "The assistant could not answer.";
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: answer, isStreaming: false };
            return updated;
          });
        } else if (event.type === "done") {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: answer, isStreaming: false };
            return updated;
          });
        }
      }

      if (activeSession) {
        for (const note of toolNotes) {
          await aiChatApi.addMessage(activeSession, {
            role: "tool", content: note.summary, tool_name: note.tool,
          }).catch(() => {});
        }
        if (answer) {
          await aiChatApi.addMessage(activeSession, { role: "assistant", content: answer }).catch(() => {});
        }
        refreshSessions();
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: answer || "_Stopped._",
            isStreaming: false,
          };
          return updated;
        });
      } else {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `I couldn't complete that request. ${err?.message ?? ""}`,
            isStreaming: false,
          };
          return updated;
        });
        toast.error(err?.message || "AI assistant request failed");
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-9rem)]">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-foreground">AI Security Assistant</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Ask about your security posture, or tell it what to change
          </p>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Conversation history */}
        <aside className="hidden lg:flex w-64 flex-shrink-0 bg-card rounded-xl border border-border shadow-sm flex-col">
          <div className="p-3 border-b border-border">
            <button
              onClick={newConversation}
              className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-3 py-2 rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> New chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversations.length === 0 ? (
              <p className="text-xs text-subtle text-center py-6">No conversations yet</p>
            ) : (
              conversations.map((conv: any) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group rounded-lg px-2.5 py-2 cursor-pointer transition-colors",
                    sessionId === conv.id ? "bg-brand-500/10" : "hover:bg-elevated"
                  )}
                  onClick={() => renaming !== conv.id && openConversation(conv.id)}
                >
                  {renaming === conv.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveRename(conv.id); if (e.key === "Escape") setRenaming(null); }}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <button onClick={e => { e.stopPropagation(); saveRename(conv.id); }} className="text-success p-1">
                        <Check className="w-3 h-3" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); setRenaming(null); }} className="text-subtle p-1">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <MessageSquare className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0",
                          sessionId === conv.id ? "text-brand-500" : "text-subtle")} />
                        <p className={cn("text-xs leading-snug line-clamp-2 flex-1",
                          sessionId === conv.id ? "text-foreground font-medium" : "text-body")}>
                          {conv.title}
                        </p>
                      </div>
                      <div className="flex items-center justify-between mt-1 pl-5">
                        <span className="text-[10px] text-subtle">
                          {conv.message_count} msg · {timeAgo(conv.updated_at)}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                          <button
                            onClick={e => { e.stopPropagation(); setRenaming(conv.id); setRenameValue(conv.title); }}
                            title="Rename"
                            className="p-1 text-subtle hover:text-body"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); removeConversation(conv.id); }}
                            title="Delete"
                            className="p-1 text-subtle hover:text-danger"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Chat window */}
        <div className="flex-1 bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-3",
                  msg.role === "user" ? "flex-row-reverse" : "flex-row",
                  // A tool call is the assistant's own working-out, so it sits
                  // on the assistant's side, indented past the avatar column
                  // (w-8 + gap-3) to line up with the reply it belongs to.
                  msg.role === "tool" && "pl-11"
                )}
              >
                {msg.role === "tool" ? (
                  <div className="inline-flex items-center gap-2 text-xs text-subtle bg-elevated px-3 py-1.5 rounded-full border border-border self-start max-w-full">
                    <Wrench className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{msg.content}</span>
                  </div>
                ) : (
                  <>
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                      msg.role === "user" ? "bg-brand-500" : "bg-elevated"
                    )}>
                      {msg.role === "user"
                        ? <User className="w-4 h-4 text-white" />
                        : <Shield className="w-4 h-4 text-brand-500" />}
                    </div>
                    <div className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "bg-brand-500 text-on-brand rounded-tr-sm whitespace-pre-wrap"
                        : "bg-elevated text-foreground border border-border rounded-tl-sm"
                    )}>
                      {msg.content ? (
                        msg.role === "assistant"
                          ? <Markdown content={msg.content} />
                          : msg.content
                      ) : msg.isStreaming ? (
                        <span className="flex gap-1 items-center">
                          <span className="w-1.5 h-1.5 bg-subtle rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 bg-subtle rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 bg-subtle rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </span>
                      ) : null}
                      {msg.isStreaming && msg.content && (
                        <span className="inline-block w-0.5 h-4 bg-muted-foreground animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {messages.length === 1 && (
            <div className="px-5 pb-3">
              <p className="text-xs text-subtle mb-2">Try:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                    className="text-xs bg-brand-500/10 text-brand-500 px-3 py-1.5 rounded-full hover:bg-brand-500/20 transition-colors border border-brand-500/20"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border p-4 flex items-end gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question, or describe the change you want…"
              rows={1}
              style={{ maxHeight: "120px" }}
              className="flex-1 border border-border rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 bg-elevated text-foreground placeholder:text-subtle"
              disabled={loading}
            />
            {loading ? (
              <button
                onClick={stop}
                title="Stop generating"
                className="w-10 h-10 border border-border text-body rounded-xl flex items-center justify-center flex-shrink-0 hover:bg-elevated"
              >
                <StopCircle className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="w-10 h-10 bg-brand-500 hover:bg-brand-600 text-on-brand rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

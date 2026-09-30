"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileText, Loader2, UploadCloud, X, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { ticketApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ACCEPT, PRIORITIES, TOPICS, checkFiles, fileSize, type TopicId } from "@/lib/support";

function NewRequestForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const initial = TOPICS.find((t) => t.id === params.get("topic"))?.id ?? "";
  const [topic, setTopic] = useState<TopicId | "">(initial);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [sending, setSending] = useState(false);
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const errors = {
    topic: !topic ? "Choose a topic" : "",
    subject: subject.trim().length < 5 ? "Add a short summary (at least 5 characters)" : "",
    body: body.trim().length < 15 ? "Tell us a little more (at least 15 characters)" : "",
  };
  const valid = !errors.topic && !errors.subject && !errors.body;

  const add = (list: FileList | null) => {
    if (!list) return;
    const r = checkFiles(files, Array.from(list));
    if (r.error) toast.error(r.error);
    setFiles(r.files);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || sending) return;
    setSending(true);
    const form = new FormData();
    form.append("subject", subject.trim());
    form.append("body", body.trim());
    form.append("category", topic);
    form.append("priority", priority);
    files.forEach((f) => form.append("files", f));
    try {
      const res = await ticketApi.create(form);
      qc.invalidateQueries({ queryKey: ["tickets"] });
      router.push(`/dashboard/support/${res.data.id}?created=1`);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? "Could not send your request. Please try again.");
      setSending(false);
    }
  };

  const field = "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

  return (
    <div className="mx-auto max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/dashboard/support" className="hover:text-foreground">Support</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">New request</span>
      </nav>
      <h2 className="text-2xl font-bold tracking-tight text-foreground">Create a support request</h2>
      <p className="mt-1 text-sm text-muted-foreground">The more detail you share, the faster we can fix it.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
        <form onSubmit={submit} noValidate className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <fieldset>
            <legend className="text-sm font-semibold text-foreground">Topic</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {TOPICS.map((t) => (
                <label key={t.id}
                  className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    topic === t.id ? "border-brand-500 bg-brand-500/5 ring-1 ring-brand-500" : "border-border hover:bg-elevated")}>
                  <input type="radio" name="topic" value={t.id} checked={topic === t.id} onChange={() => setTopic(t.id)} className="sr-only" />
                  <t.icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", topic === t.id ? "text-brand-500" : "text-subtle")} />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{t.label}</span>
                    <span className="block text-xs text-muted-foreground">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {touched && errors.topic && <p className="mt-2 text-xs text-danger">{errors.topic}</p>}
          </fieldset>

          <div>
            <label htmlFor="subject" className="text-sm font-semibold text-foreground">Subject</label>
            <input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200}
              placeholder="e.g. Agent shows offline on two MacBooks" className={cn(field, "mt-2")} aria-invalid={touched && !!errors.subject} aria-describedby="subject-err" />
            {touched && errors.subject && <p id="subject-err" className="mt-1.5 text-xs text-danger">{errors.subject}</p>}
          </div>

          <div>
            <label htmlFor="body" className="text-sm font-semibold text-foreground">Describe the problem</label>
            <p className="mt-0.5 text-xs text-muted-foreground">What happened, what you expected, when it started, and which employees or devices are affected.</p>
            <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={7}
              placeholder="Since this morning, the dashboard shows Utsavi's MacBook as offline, although the laptop is on and connected…"
              className={cn(field, "mt-2 resize-y")} aria-invalid={touched && !!errors.body} aria-describedby="body-err" />
            {touched && errors.body && <p id="body-err" className="mt-1.5 text-xs text-danger">{errors.body}</p>}
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-foreground">Priority</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {PRIORITIES.map((p) => (
                <label key={p.id}
                  className={cn("cursor-pointer rounded-lg border p-3 transition-colors",
                    priority === p.id ? (p.id === "urgent" ? "border-red-500 bg-red-500/5 ring-1 ring-red-500" : "border-brand-500 bg-brand-500/5 ring-1 ring-brand-500") : "border-border hover:bg-elevated")}>
                  <input type="radio" name="priority" value={p.id} checked={priority === p.id} onChange={() => setPriority(p.id)} className="sr-only" />
                  <span className="block text-sm font-medium text-foreground">{p.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{p.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <p className="text-sm font-semibold text-foreground">Attachments <span className="font-normal text-muted-foreground">(optional)</span></p>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            <button type="button" onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
              className={cn("mt-2 flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
                drag ? "border-brand-500 bg-brand-500/5" : "border-border hover:border-brand-500/50 hover:bg-elevated")}>
              <UploadCloud className="h-6 w-6 text-brand-500" />
              <span className="mt-2 text-sm text-foreground">Drop screenshots or files here, or <span className="font-medium text-brand-500">browse</span></span>
              <span className="mt-0.5 text-xs text-subtle">Images, PDF, text, CSV, log or ZIP. Up to 5 files, 10 MB each.</span>
            </button>
            {files.length > 0 && (
              <ul className="mt-3 space-y-2">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 flex-shrink-0 text-subtle" />
                      <span className="truncate text-body">{f.name}</span>
                      <span className="flex-shrink-0 text-xs text-subtle">{fileSize(f.size)}</span>
                    </span>
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-subtle hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
            <Link href="/dashboard/support" className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">Cancel</Link>
            <button type="submit" disabled={sending}
              className="flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit request
            </button>
          </div>
        </form>

        <aside className="h-fit rounded-xl border border-border bg-card p-5 shadow-sm lg:sticky lg:top-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Lightbulb className="h-4 w-4 text-brand-500" /> For a faster answer</h3>
          <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            <li>Name the employee or device affected (the hostname is on the Devices page).</li>
            <li>Add a screenshot of any error or warning you see.</li>
            <li>Say whether it worked before and what changed.</li>
            <li>For a blocked site or app, include its exact address or name.</li>
          </ul>
          <p className="mt-4 border-t border-border pt-4 text-xs text-subtle">We'll email you a copy of this request and every reply.</p>
        </aside>
      </div>
    </div>
  );
}

export default function NewRequestPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-5xl animate-pulse rounded-xl bg-card" />}>
      <NewRequestForm />
    </Suspense>
  );
}

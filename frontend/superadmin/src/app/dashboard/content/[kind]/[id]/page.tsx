"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Columns2, ExternalLink, Eye, Loader2, PenLine, Trash2 } from "lucide-react";
import { contentApi } from "@/lib/api";
import { Markdown, parseMarkdown } from "@/lib/markdown";
import { cn, formatDateTime } from "@/lib/utils";
import { KINDS, WEBSITE_URL, isKind } from "../../kinds";

type Form = {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  category: string;
  tags: string;
  author_name: string;
  cover_image: string;
  seo_title: string;
  seo_description: string;
  featured: boolean;
  sort_order: number;
  published_at: string;
};

const EMPTY: Form = {
  title: "", slug: "", excerpt: "", body: "", category: "", tags: "", author_name: "Aavishield team",
  cover_image: "", seo_title: "", seo_description: "", featured: false, sort_order: 0, published_at: "",
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);

const INPUT = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

// Markdown preview styles, applied from the wrapper (the renderer emits plain tags).
const PROSE = cn(
  "text-sm leading-relaxed text-foreground/90",
  "[&>*+*]:mt-4 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li+li]:mt-1",
  "[&_a]:text-brand-600 [&_a]:underline [&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-brand-500 [&_blockquote]:bg-brand-500/5 [&_blockquote]:px-4 [&_blockquote]:py-3",
  "[&_table]:w-full [&_table]:border-collapse [&_th]:border-b [&_th]:border-border [&_th]:py-2 [&_th]:text-left [&_td]:border-b [&_td]:border-border [&_td]:py-2 [&_hr]:border-border",
);

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="font-normal">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Count({ n, max }: { n: number; max: number }) {
  return <span className={n > max ? "text-red-600" : undefined}>{n}/{max}</span>;
}

export default function ContentEditorPage() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const cfg = isKind(kind) ? KINDS[kind] : null;
  const isNew = id === "new";

  const [form, setForm] = useState<Form>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"write" | "split" | "preview">("split");

  const { data: post, isLoading } = useQuery({
    queryKey: ["content-post", id],
    queryFn: () => contentApi.get(id).then((r) => r.data),
    enabled: !!cfg && !isNew,
  });

  // Existing categories, offered as suggestions so they stay consistent.
  const { data: siblings } = useQuery({
    queryKey: ["content", cfg?.api, "", ""],
    queryFn: () => contentApi.list({ kind: cfg!.api }).then((r) => r.data),
    enabled: !!cfg,
  });
  const categories = useMemo(
    () => Array.from(new Set<string>((siblings?.posts ?? []).map((p: any) => p.category).filter(Boolean))).sort(),
    [siblings],
  );

  useEffect(() => {
    if (!post) return;
    setForm({
      title: post.title ?? "",
      slug: post.slug ?? "",
      excerpt: post.excerpt ?? "",
      body: post.body ?? "",
      category: post.category ?? "",
      tags: (post.tags ?? []).join(", "),
      author_name: post.author_name ?? "",
      cover_image: post.cover_image ?? "",
      seo_title: post.seo_title ?? "",
      seo_description: post.seo_description ?? "",
      featured: !!post.featured,
      sort_order: post.sort_order ?? 0,
      published_at: post.published_at ? String(post.published_at).slice(0, 10) : "",
    });
    setDirty(false);
  }, [post]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const blocks = useMemo(() => parseMarkdown(form.body), [form.body]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setDirty(true);
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "title" && !slugTouched) next.slug = slugify(String(value));
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async (status: "draft" | "published") => {
      const payload = {
        ...form,
        kind: cfg!.api,
        status,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        sort_order: Number(form.sort_order) || 0,
        published_at: form.published_at || undefined,
      };
      const res = isNew ? await contentApi.create(payload) : await contentApi.update(id, payload);
      return res.data;
    },
    onSuccess: (saved, status) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["content"] });
      qc.setQueryData(["content-post", saved.id], saved);
      const wasPublished = post?.status === "published";
      toast.success(status === "published" ? (wasPublished ? "Changes are live" : "Published") : wasPublished ? "Unpublished" : "Draft saved");
      if (isNew) router.replace(`/dashboard/content/${kind}/${saved.id}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to save"),
  });

  const remove = useMutation({
    mutationFn: () => contentApi.delete(id),
    onSuccess: () => {
      setDirty(false);
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["content"] });
      router.push(`/dashboard/content/${kind}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to delete"),
  });

  if (!cfg) notFound();
  if (!isNew && isLoading) {
    return <div className="h-96 animate-pulse rounded-xl bg-muted/40" />;
  }

  const published = post?.status === "published";
  const busy = save.isPending || remove.isPending;
  const liveUrl = `${WEBSITE_URL}${cfg.sitePath}/${form.slug}`;

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/dashboard/content/${kind}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> {cfg.label}
          </Link>
          <h2 className="mt-1 truncate text-[2rem] font-normal leading-[1.1] tracking-[-0.035em] text-foreground">{form.title || `New ${cfg.singular}`}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {isNew ? "Not saved yet" : published ? "Published" : "Draft"}
            {post?.updated_at && <> · last saved {formatDateTime(post.updated_at)}</>}
            {dirty && <span className="text-yellow-700"> · unsaved changes</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {published && (
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-4 w-4" /> View live
            </a>
          )}
          {!isNew && (
            <button
              disabled={busy}
              onClick={() => confirm(`Delete "${form.title}" permanently? This cannot be undone.`) && remove.mutate()}
              className="rounded-lg border border-border p-2 text-muted-foreground hover:border-red-500/40 hover:text-red-600 disabled:opacity-50"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {published ? (
            <button disabled={busy} onClick={() => save.mutate("draft")} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/40 disabled:opacity-50">
              Unpublish
            </button>
          ) : (
            <button disabled={busy} onClick={() => save.mutate("draft")} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/40 disabled:opacity-50">
              Save draft
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => save.mutate("published")}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.06em] text-primary-foreground hover:bg-brand-600 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {published ? "Update" : "Publish"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        {/* Writing area */}
        <div className="space-y-4">
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <Field label="Title *" hint={<Count n={form.title.length} max={200} />}>
              <input value={form.title} onChange={(e) => set("title", e.target.value)} className={cn(INPUT, "text-base")} placeholder="How to block a desktop application" />
            </Field>
            <Field label="Excerpt" hint="Shown on cards and in search results">
              <textarea rows={2} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} className={INPUT} placeholder="One or two sentences on what the reader will learn." />
            </Field>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="px-2 text-xs text-muted-foreground">
                Markdown: <code>## Heading</code> <code>**bold**</code> <code>- list</code> <code>1. steps</code> <code>&gt; tip</code> <code>[link](/path)</code> <code>| table |</code>
              </p>
              <div className="flex gap-1">
                {([["write", PenLine, "Write"], ["split", Columns2, "Split"], ["preview", Eye, "Preview"]] as const).map(([m, Icon, label]) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs", mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={cn("grid", mode === "split" && "lg:grid-cols-2")}>
              {mode !== "preview" && (
                <textarea
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                  spellCheck
                  className="min-h-[560px] w-full resize-y bg-background p-5 font-mono text-[13px] leading-relaxed focus:outline-none"
                  placeholder={"Start with a sentence that answers the question.\n\n## First section\n\nWrite here..."}
                />
              )}
              {mode !== "write" && (
                <div className={cn("max-h-[720px] min-h-[560px] overflow-y-auto p-6", mode === "split" && "border-t border-border lg:border-l lg:border-t-0")}>
                  {form.body.trim() ? (
                    <div className={PROSE}>
                      <Markdown blocks={blocks} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">The preview appears here as you write.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Settings */}
        <aside className="space-y-4">
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">Details</h3>
            <Field label="URL slug">
              <div className="flex items-center rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-brand-500">
                <span className="pl-3 text-xs text-muted-foreground">{cfg.sitePath}/</span>
                <input
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                  }}
                  className="w-full bg-transparent px-1 py-2 text-sm focus:outline-none"
                />
              </div>
            </Field>
            <Field label="Category">
              <input list="content-categories" value={form.category} onChange={(e) => set("category", e.target.value)} className={INPUT} placeholder="Getting started" />
              <datalist id="content-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="Tags" hint="Comma separated">
              <input value={form.tags} onChange={(e) => set("tags", e.target.value)} className={INPUT} placeholder="dlp, onboarding" />
            </Field>
            <Field label="Author">
              <input value={form.author_name} onChange={(e) => set("author_name", e.target.value)} className={INPUT} />
            </Field>
            <Field label="Publish date" hint="Set on first publish if empty">
              <input type="date" value={form.published_at} onChange={(e) => set("published_at", e.target.value)} className={INPUT} />
            </Field>
            {cfg.api === "guide" && (
              <Field label="Order in category" hint="Lower comes first">
                <input type="number" value={form.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} className={INPUT} />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={form.featured} onChange={(e) => set("featured", e.target.checked)} className="h-4 w-4 accent-[#FF7000]" />
              Feature on the {cfg.label} home
            </label>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">Search appearance</h3>
            <Field label="SEO title" hint={<Count n={form.seo_title.length} max={60} />}>
              <input value={form.seo_title} onChange={(e) => set("seo_title", e.target.value)} className={INPUT} placeholder={form.title} />
            </Field>
            <Field label="Meta description" hint={<Count n={form.seo_description.length} max={160} />}>
              <textarea rows={3} value={form.seo_description} onChange={(e) => set("seo_description", e.target.value)} className={INPUT} placeholder={form.excerpt} />
            </Field>
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="truncate text-[11px] text-muted-foreground">{liveUrl}</p>
              <p className="mt-0.5 truncate text-sm text-sky-700">{form.seo_title || form.title || "Page title"} | Aavishield</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{form.seo_description || form.excerpt || "The meta description appears here."}</p>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">Cover image</h3>
            <Field label="Image URL" hint="Optional, 16:9">
              <input value={form.cover_image} onChange={(e) => set("cover_image", e.target.value)} className={INPUT} placeholder="https://… or /images/…" />
            </Field>
          </div>
        </aside>
      </div>
    </div>
  );
}

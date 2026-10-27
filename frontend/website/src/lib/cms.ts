import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/*
 * Blog posts and knowledge hub articles, written in the superadmin panel and
 * served by admin-api's public /public/content routes. Pages revalidate every
 * few minutes, so a publish shows up without a redeploy.
 *
 * With no ADMIN_API_INTERNAL_URL (plain `npm run dev`, no Docker stack), the
 * starter articles are read straight from admin-api's seed folder instead,
 * so the pages can be worked on locally.
 */

export type ContentKind = "blog" | "guide";

export type PostSummary = {
  id: string;
  kind: ContentKind;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  tags: string[] | null;
  author_name: string;
  cover_image: string;
  thumbnail_image: string;
  featured: boolean;
  sort_order: number;
  published_at: string | null;
  updated_at: string;
  reading_minutes: number;
};

export type Post = PostSummary & { body: string; seo_title: string; seo_description: string };

const API = process.env.ADMIN_API_INTERNAL_URL;
const REVALIDATE = 300;

/** Where each kind lives on the site. */
export const BASE: Record<ContentKind, string> = { blog: "/blog", guide: "/knowledge-hub" };

/** Knowledge hub sections, in reading order. Unknown categories go last. */
export const GUIDE_CATEGORIES: { name: string; body: string }[] = [
  { name: "Getting started", body: "Set up your organisation, install the agent and plan a rollout." },
  { name: "Policies and controls", body: "Web filtering, app blocking, VPNs and malware scanning." },
  { name: "Data protection", body: "How DLP works and what it detects." },
  { name: "Devices and agent", body: "Posture checks, updates and offline devices." },
  { name: "Privacy and monitoring", body: "Activity monitoring and telling employees." },
  { name: "Security and trust", body: "How Aavishield protects your data and sign-ins." },
  { name: "Account and billing", body: "Plans, pricing and cancellation." },
];

async function api<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${url}`, { next: { revalidate: REVALIDATE, tags: ["content"] }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Local seed fallback ─────────────────────────────────────────────────────
// Mirrors parseContentSeed in services/admin-api/internal/database/content.go.

const SEED_DIR = path.join(process.cwd(), "..", "..", "services", "admin-api", "internal", "database", "config", "content");

function parseSeed(file: string, raw: string): Post | null {
  const text = raw.replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if ((meta.kind !== "blog" && meta.kind !== "guide") || !meta.slug || !meta.title) return null;
  const body = m[2].trim();
  const date = meta.published ? new Date(`${meta.published}T00:00:00Z`).toISOString() : new Date().toISOString();
  return {
    id: file,
    kind: meta.kind,
    slug: meta.slug,
    title: meta.title,
    excerpt: meta.excerpt ?? "",
    body,
    category: meta.category ?? "",
    tags: (meta.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    author_name: meta.author ?? "",
    cover_image: meta.cover ?? "",
    thumbnail_image: meta.thumbnail ?? "",
    seo_title: meta.seo_title ?? "",
    seo_description: meta.seo_description ?? "",
    featured: meta.featured === "true",
    sort_order: Number(meta.order) || 0,
    published_at: date,
    updated_at: date,
    reading_minutes: Math.max(1, Math.ceil(body.split(/\s+/).filter(Boolean).length / 220)),
  };
}

let seedCache: Promise<Post[]> | null = null;
function seed(): Promise<Post[]> {
  seedCache ??= readdir(SEED_DIR)
    .then((files) => Promise.all(files.filter((f) => f.endsWith(".md")).map(async (f) => parseSeed(f, await readFile(path.join(SEED_DIR, f), "utf8")))))
    .then((posts) => posts.filter((p): p is Post => p !== null))
    .catch(() => []);
  return seedCache;
}

const byOrder = (kind: ContentKind) => (a: PostSummary, b: PostSummary) =>
  kind === "guide"
    ? a.sort_order - b.sort_order || a.title.localeCompare(b.title)
    : (b.published_at ?? "").localeCompare(a.published_at ?? "");

// Branded stills for the starter posts. Applied when a row has no cover,
// including database posts seeded before the images existed.
const BLOG_ART: Record<string, { thumb: string; hero: string }> = {
  "what-your-team-pastes-into-ai-tools": {
    thumb: "/images/blog/ai-tools-thumb.jpg",
    hero: "/images/blog/ai-tools-hero.jpg",
  },
  "personal-vpns-bypass-web-filtering": {
    thumb: "/images/blog/personal-vpns-thumb.jpg",
    hero: "/images/blog/personal-vpns-hero.jpg",
  },
  "roll-out-endpoint-security-without-losing-trust": {
    thumb: "/images/blog/rollout-trust-thumb.jpg",
    hero: "/images/blog/rollout-trust-hero.jpg",
  },
};

function withArt<T extends { slug: string; cover_image: string; thumbnail_image?: string | null }>(p: T): T {
  const art = BLOG_ART[p.slug];
  if (!art) return { ...p, thumbnail_image: p.thumbnail_image ?? "" };
  return {
    ...p,
    cover_image: p.cover_image || art.hero,
    thumbnail_image: p.thumbnail_image || art.thumb,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Every published post of a kind, without bodies. */
export async function listPosts(kind: ContentKind): Promise<PostSummary[]> {
  const posts = API
    ? (await api<{ posts: PostSummary[] }>(`/public/content?kind=${kind}`))?.posts ?? []
    : (await seed())
        .filter((p) => p.kind === kind)
        .sort(byOrder(kind))
        .map((p): PostSummary => ({ ...p, body: undefined, seo_title: undefined, seo_description: undefined }) as PostSummary);
  return posts.map(withArt);
}

/** One published post and up to three related posts from its category. */
export async function getPost(kind: ContentKind, slug: string): Promise<{ post: Post; related: PostSummary[] } | null> {
  if (API) {
    const found = await api<{ post: Post; related: PostSummary[] }>(`/public/content/${kind}/${encodeURIComponent(slug)}`);
    if (!found) return null;
    return { post: withArt(found.post), related: found.related.map(withArt) };
  }
  const all = (await seed()).filter((p) => p.kind === kind);
  const post = all.find((p) => p.slug === slug);
  if (!post) return null;
  const related = all.filter((p) => p.id !== post.id && p.category === post.category).sort(byOrder(kind)).slice(0, 3);
  return { post: withArt(post), related: related.map(withArt) };
}

/** Knowledge hub articles grouped into sections, in reading order. */
export function groupGuides(posts: PostSummary[]) {
  const known = GUIDE_CATEGORIES.map((c) => c.name);
  const names = [...known, ...Array.from(new Set(posts.map((p) => p.category))).filter((c) => !known.includes(c))];
  return names
    .map((name) => ({
      name,
      body: GUIDE_CATEGORIES.find((c) => c.name === name)?.body ?? "",
      posts: posts.filter((p) => p.category === name),
    }))
    .filter((g) => g.posts.length > 0);
}

export const categoryId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "general";

export function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

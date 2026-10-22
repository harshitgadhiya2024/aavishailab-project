import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { BASE, formatDate, type PostSummary } from "@/lib/cms";
import { LogoMark } from "../wordmark";

/**
 * The cover for a post: the uploaded image when there is one, otherwise a
 * typographic card on the pixel grid, so every post looks finished.
 */
export function Cover({ post, large = false }: { post: PostSummary; large?: boolean }) {
  if (post.cover_image) {
    return (
      // Covers can live on any host the editor pastes, so next/image's
      // remote allowlist would get in the way here.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={post.cover_image} alt="" className="aspect-[16/9] w-full rounded-[4px] border border-line object-cover" loading="lazy" />
    );
  }
  // The title always sits right next to the cover, so the cover carries the mark instead of repeating it.
  return (
    <div className="pixel-grid relative flex aspect-[16/9] w-full flex-col justify-between overflow-hidden rounded-[4px] border border-brand/15 bg-brand-soft p-5" aria-hidden>
      <span className="flex items-center justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-brand-ink">
        {post.category || "Aavishield"}
        <span className="text-muted">{post.reading_minutes} min</span>
      </span>
      <span className="grid flex-1 place-items-center">
        <LogoMark className={large ? "h-24 md:h-32" : "h-12"} />
      </span>
    </div>
  );
}

export function Meta({ post }: { post: PostSummary }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
      {post.published_at && <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>}
      <span aria-hidden>·</span>
      <span>{post.reading_minutes} min read</span>
    </p>
  );
}

/** A blog post card for the index grid. */
export function PostCard({ post }: { post: PostSummary }) {
  return (
    <Link href={`${BASE[post.kind]}/${post.slug}`} className="group flex h-full flex-col gap-5 rounded-[6px] border border-line bg-bg p-4 transition-colors duration-300 hover:border-brand/40 hover:bg-surface md:p-5">
      <Cover post={post} />
      <div className="flex flex-1 flex-col">
        <Meta post={post} />
        <h3 className="mt-3 text-[1.2rem] leading-snug tracking-[-0.015em] text-fg">{post.title}</h3>
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{post.excerpt}</p>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg group-hover:text-brand-ink">
          Read <ArrowUpRight size={12} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

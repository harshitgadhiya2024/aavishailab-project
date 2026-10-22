import Link from "next/link";
import { Markdown, type Block, type LinkLike } from "@/lib/markdown";

// On-site links go through next/link; anything else opens in a new tab.
const SiteLink: LinkLike = ({ href, children }) =>
  href.startsWith("/") || href.startsWith("#") ? (
    <Link href={href}>{children}</Link>
  ) : (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
      {children}
    </a>
  );

// Article typography, applied from the wrapper because the renderer emits plain tags.
const PROSE = [
  "max-w-[68ch] text-[16.5px] leading-[1.75] text-fg-2",
  "[&>*+*]:mt-5",
  "[&_h2]:mt-14 [&_h2]:scroll-mt-28 [&_h2]:text-[1.65rem] [&_h2]:font-normal [&_h2]:leading-tight [&_h2]:tracking-[-0.025em] [&_h2]:text-fg",
  "[&_h3]:mt-10 [&_h3]:scroll-mt-28 [&_h3]:text-[1.2rem] [&_h3]:font-medium [&_h3]:tracking-[-0.015em] [&_h3]:text-fg",
  "[&_h4]:mt-8 [&_h4]:font-medium [&_h4]:text-fg",
  "[&_strong]:font-medium [&_strong]:text-fg",
  "[&_a]:text-brand-ink [&_a]:underline [&_a]:decoration-brand/40 [&_a]:underline-offset-4 hover:[&_a]:decoration-brand",
  "[&_ul]:grid [&_ul]:gap-2 [&_ul]:pl-0 [&_ul>li]:relative [&_ul>li]:pl-6 [&_ul>li]:before:absolute [&_ul>li]:before:left-1 [&_ul>li]:before:top-[0.72em] [&_ul>li]:before:size-1.5 [&_ul>li]:before:bg-brand [&_ul>li]:before:content-['']",
  "[&_ol]:grid [&_ol]:gap-3 [&_ol]:pl-0 [&_ol]:[counter-reset:step] [&_ol>li]:relative [&_ol>li]:pl-10 [&_ol>li]:[counter-increment:step]",
  "[&_ol>li]:before:absolute [&_ol>li]:before:left-0 [&_ol>li]:before:top-[0.2em] [&_ol>li]:before:grid [&_ol>li]:before:size-6 [&_ol>li]:before:place-items-center [&_ol>li]:before:rounded-[4px] [&_ol>li]:before:border [&_ol>li]:before:border-brand/30 [&_ol>li]:before:bg-brand-soft [&_ol>li]:before:font-mono [&_ol>li]:before:text-[11px] [&_ol>li]:before:text-brand-ink [&_ol>li]:before:content-[counter(step)]",
  "[&_blockquote]:rounded-[6px] [&_blockquote]:border [&_blockquote]:border-brand/25 [&_blockquote]:bg-brand-soft [&_blockquote]:px-5 [&_blockquote]:py-4 [&_blockquote]:text-[15.5px] [&_blockquote]:text-fg",
  "[&_code]:rounded-[4px] [&_code]:border [&_code]:border-line [&_code]:bg-bg-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-fg",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-[6px] [&_pre]:bg-ink [&_pre]:p-5 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:text-ink-fg [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-ink-fg",
  "[&_[data-table-wrap]]:overflow-x-auto [&_[data-table-wrap]]:rounded-[6px] [&_[data-table-wrap]]:border [&_[data-table-wrap]]:border-line",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-[15px] [&_th]:bg-bg-2 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-mono [&_th]:text-[11px] [&_th]:font-normal [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-muted",
  "[&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-3 [&_td]:align-top",
  "[&_hr]:my-10 [&_hr]:border-line",
].join(" ");

export function Prose({ blocks }: { blocks: Block[] }) {
  return (
    <div className={PROSE}>
      <Markdown blocks={blocks} link={SiteLink} />
    </div>
  );
}

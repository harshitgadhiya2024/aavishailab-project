import type { ComponentType, ReactNode } from "react";

/*
 * A small Markdown renderer for blog posts and knowledge hub articles.
 *
 * It builds React elements directly (never HTML strings), so nothing an
 * editor types can inject markup or script. It covers what the CMS editor
 * documents: ## headings, paragraphs, - and 1. lists, > quotes, ``` code,
 * | tables |, --- rules, **bold**, *italic*, `code` and [links](/path).
 *
 * The same file is copied into frontend/superadmin/src/lib/markdown.tsx for
 * the editor preview; keep the two in step.
 */

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; text: string; id: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; code: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "rule" };

export function headingId(text: string) {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const BULLET = /^\s*[-*+]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

function startsBlock(line: string, next?: string) {
  return (
    /^#{1,4}\s/.test(line) ||
    line.startsWith("```") ||
    line.startsWith(">") ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    /^(-{3,}|\*{3,})\s*$/.test(line) ||
    (line.trim().startsWith("|") && next !== undefined && TABLE_RULE.test(next))
  );
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const used = new Map<string, number>();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ type: "code", code: code.join("\n") });
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      // The page already has its <h1>, so a "# " heading becomes an <h2>.
      const level = Math.max(2, h[1].length) as 2 | 3 | 4;
      const text = h[2].trim();
      let id = headingId(text) || "section";
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      blocks.push({ type: "heading", level, text, id });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const text: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) text.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: text.join(" ").trim() });
      continue;
    }

    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const marker = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        if (marker.test(lines[i])) items.push(lines[i].replace(marker, ""));
        else if (startsBlock(lines[i], lines[i + 1])) break;
        else items[items.length - 1] += " " + lines[i].trim(); // wrapped line
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.trim().startsWith("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ type: "table", head, rows });
      continue;
    }

    const text: string[] = [];
    while (i < lines.length && lines[i].trim() && (text.length === 0 || !startsBlock(lines[i], lines[i + 1]))) {
      text.push(lines[i++].trim());
    }
    blocks.push({ type: "paragraph", text: text.join(" ") });
  }
  return blocks;
}

/** The ## headings, for an "On this page" list. */
export function outline(blocks: Block[]) {
  return blocks.filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading" && b.level === 2);
}

/** Only web, mail and on-site links are rendered as links. */
function safeHref(href: string) {
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href) ? href : null;
}

export type LinkLike = ComponentType<{ href: string; children: ReactNode; className?: string }>;

const PlainLink: LinkLike = ({ href, children, className }) => {
  const external = /^https?:/i.test(href);
  return (
    <a href={href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
};

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

export function renderInline(text: string, Link: LinkLike = PlainLink, key = "i"): ReactNode[] {
  return text.split(INLINE).map((part, n) => {
    const k = `${key}-${n}`;
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={k}>{renderInline(part.slice(2, -2), Link, k)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={k}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      const label = renderInline(link[1], Link, k);
      return href ? <Link key={k} href={href}>{label}</Link> : <span key={k}>{label}</span>;
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      if (part.length > 2) return <em key={k}>{renderInline(part.slice(1, -1), Link, k)}</em>;
    }
    return part;
  });
}

/**
 * Renders parsed blocks as plain semantic elements. Style them from the
 * wrapper (e.g. `[&_h2]:text-2xl`) so this file stays portable.
 */
export function Markdown({ blocks, link = PlainLink }: { blocks: Block[]; link?: LinkLike }) {
  return (
    <>
      {blocks.map((b, n) => {
        const k = `b${n}`;
        switch (b.type) {
          case "heading": {
            const Tag = `h${b.level}` as "h2" | "h3" | "h4";
            return <Tag key={k} id={b.id}>{renderInline(b.text, link, k)}</Tag>;
          }
          case "paragraph":
            return <p key={k}>{renderInline(b.text, link, k)}</p>;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={k}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item, link, `${k}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return <blockquote key={k}><p>{renderInline(b.text, link, k)}</p></blockquote>;
          case "code":
            return <pre key={k}><code>{b.code}</code></pre>;
          case "table":
            return (
              <div key={k} data-table-wrap="">
                <table>
                  <thead>
                    <tr>{b.head.map((c, j) => <th key={j}>{renderInline(c, link, `${k}-h${j}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>{row.map((c, j) => <td key={j}>{renderInline(c, link, `${k}-${r}-${j}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "rule":
            return <hr key={k} />;
        }
      })}
    </>
  );
}

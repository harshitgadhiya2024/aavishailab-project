"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Renders assistant output as markdown, styled with the app's own tokens.
 *
 * Every element is mapped explicitly rather than relying on a prose plugin:
 * the assistant's most useful answers are tables and lists, and those need to
 * match the tables elsewhere in the dashboard instead of looking like a
 * pasted document. Raw HTML is deliberately NOT enabled — model output is
 * untrusted text, and react-markdown escapes it by default.
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,

          h1: ({ children }) => <h1 className="text-base font-semibold text-foreground mt-3 mb-2 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground mt-2 mb-1 first:mt-0">{children}</h3>,

          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="marker:text-subtle">{children}</li>,

          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,

          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-500 hover:underline"
            >
              {children}
            </a>
          ),

          code: ({ className: codeClass, children, ...props }) => {
            // Fenced blocks arrive with a language class; inline code doesn't.
            const isBlock = /language-/.test(codeClass ?? "");
            if (isBlock) {
              return (
                <code className="block font-mono text-xs leading-relaxed" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="bg-background border border-border rounded px-1 py-0.5 font-mono text-[12px] text-foreground" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-background border border-border rounded-lg p-3 mb-2 overflow-x-auto last:mb-0">
              {children}
            </pre>
          ),

          // Tables carry the real answers, so they get a horizontal scroll
          // container of their own — a wide table must never widen the bubble.
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-border">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-background">{children}</thead>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wide text-[10px] border-b border-border whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-body border-b border-elevated last:border-b-0 align-top">{children}</td>
          ),

          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-brand-500 pl-3 my-2 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border my-3" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

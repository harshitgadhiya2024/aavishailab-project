import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, UserCheck } from "lucide-react";
import { pageNeighbors } from "@/lib/nav";
import { cn } from "@/lib/utils";

const AUDIENCE_STYLE = {
  Company: { icon: Building2, classes: "bg-brand-500/10 text-brand-500" },
  Employee: { icon: UserCheck, classes: "bg-blue-500/10 text-blue-400" },
} as const;

export function DocPage({
  title,
  description,
  audience,
  path,
  children,
}: {
  title: string;
  description: string;
  audience?: "Company" | "Employee";
  path: string;
  children: React.ReactNode;
}) {
  const { prev, next } = pageNeighbors(path);
  const aud = audience ? AUDIENCE_STYLE[audience] : null;

  return (
    <div className="max-w-3xl mx-auto px-8 py-12 lg:px-12">
      <div className="mb-8">
        {aud && (
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-4", aud.classes)}>
            <aud.icon className="w-3.5 h-3.5" />
            {audience} Guide
          </span>
        )}
        <h1 className="text-3xl font-bold text-foreground tracking-tight">{title}</h1>
        <p className="text-base text-muted-foreground mt-3 leading-relaxed">{description}</p>
      </div>

      <div className="doc-content">{children}</div>

      <div className="flex items-center justify-between mt-16 pt-6 border-t border-border gap-4">
        {prev ? (
          <Link href={prev.href} className="group flex-1 flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-500 transition-colors">
            <ArrowLeft className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{prev.label}</span>
          </Link>
        ) : <div className="flex-1" />}
        {next ? (
          <Link href={next.href} className="group flex-1 flex items-center justify-end gap-2 text-sm text-muted-foreground hover:text-brand-500 transition-colors text-right">
            <span className="truncate">{next.label}</span>
            <ArrowRight className="w-4 h-4 flex-shrink-0" />
          </Link>
        ) : <div className="flex-1" />}
      </div>
    </div>
  );
}

export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="!list-none !pl-0 space-y-5 my-6">{children}</ol>;
}

export function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-500/10 text-brand-500 text-sm font-semibold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children && <div className="text-sm text-muted-foreground mt-1 leading-relaxed [&>p]:mb-0">{children}</div>}
      </div>
    </li>
  );
}

const CALLOUT_STYLE = {
  note: "bg-brand-500/10 border-brand-500/20 text-foreground",
  warning: "bg-yellow-500/10 border-yellow-500/20 text-foreground",
  gap: "bg-red-500/10 border-red-500/20 text-foreground",
};

export function Callout({ type = "note", title, children }: { type?: "note" | "warning" | "gap"; title: string; children: React.ReactNode }) {
  return (
    <div className={cn("border rounded-lg px-4 py-3 my-5 text-sm", CALLOUT_STYLE[type])}>
      <p className="font-medium mb-1">{title}</p>
      <div className="text-muted-foreground leading-relaxed [&>p]:mb-0">{children}</div>
    </div>
  );
}

export function FeatureTable({ rows }: { rows: { name: string; desc: string }[] }) {
  return (
    <div className="overflow-x-auto my-5 rounded-lg border border-border">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap align-top w-1/4">{r.name}</td>
              <td className="px-4 py-3 text-muted-foreground align-top">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

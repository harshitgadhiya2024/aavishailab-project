"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { categoryApi } from "@/lib/api";
import {
  Search, Trash2, X, Loader2, Plus, Globe, Tags, Eye,
  ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/Pagination";


function riskLabel(level: number) {
  if (level >= 4) return { label: "Critical", className: "bg-red-500/10 text-danger" };
  if (level === 3) return { label: "High", className: "bg-orange-500/10 text-warning" };
  if (level === 2) return { label: "Medium", className: "bg-yellow-500/10 text-warning" };
  if (level === 1) return { label: "Low", className: "bg-green-500/10 text-success" };
  return { label: "None", className: "bg-elevated text-body" };
}

export default function CategoriesPage() {
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const [domainsCategory, setDomainsCategory] = useState<any>(null);
  const [domainSearch, setDomainSearch] = useState("");
  const [domainPage, setDomainPage] = useState(1);
  const [domainLimit, setDomainLimit] = useState(10);
  const [newDomain, setNewDomain] = useState("");
  const [removeDomain, setRemoveDomain] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["url-categories", search],
    queryFn: () => categoryApi.list({ search: search || undefined }),
  });

  const { data: domainsData, isLoading: domainsLoading } = useQuery({
    queryKey: ["category-domains", domainsCategory?.id, domainSearch, domainPage, domainLimit],
    queryFn: () =>
      categoryApi.domains(domainsCategory.id, {
        search: domainSearch || undefined,
        page: domainPage,
        limit: domainLimit,
      }),
    enabled: !!domainsCategory,
  });

  const addMut = useMutation({
    mutationFn: ({ id, domains }: { id: string; domains: string }) =>
      categoryApi.addDomains(id, { domain: domains }),
    onSuccess: (res) => {
      const { added = 0, restored = 0, already = 0, invalid = [] } = res.data ?? {};
      const saved = added + restored;
      if (saved > 0) toast.success(`${saved} domain${saved === 1 ? "" : "s"} added`);
      else if (already > 0) toast.info(`Already in this category`);
      if (invalid.length > 0) toast.error(`Skipped invalid: ${invalid.join(", ")}`);
      setNewDomain("");
      qc.invalidateQueries({ queryKey: ["category-domains"] });
      qc.invalidateQueries({ queryKey: ["url-categories"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to add domain"),
  });

  const deleteMut = useMutation({
    mutationFn: ({ id, domain }: { id: string; domain: string }) => categoryApi.deleteDomain(id, domain),
    onSuccess: () => {
      toast.success("Domain removed");
      setRemoveDomain(null);
      qc.invalidateQueries({ queryKey: ["category-domains"] });
      qc.invalidateQueries({ queryKey: ["url-categories"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Failed to remove domain"),
  });

  const allCategories = Array.isArray(data?.data?.data) ? data.data.data : [];
  const total = allCategories.length;
  const totalPages = Math.ceil(total / limit);
  // The categories endpoint returns the full library — page it on the client.
  const categories = useMemo(
    () => allCategories.slice((page - 1) * limit, page * limit),
    [allCategories, page]
  );

  const domains = Array.isArray(domainsData?.data?.data) ? domainsData.data.data : [];
  const domainTotal = domainsData?.data?.total ?? 0;
  const domainTotalPages = Math.ceil(domainTotal / domainLimit);

  const openDomains = (category: any) => {
    setDomainsCategory(category);
    setDomainSearch("");
    setDomainPage(1);
    setNewDomain("");
  };

  const closeDomains = () => {
    setDomainsCategory(null);
    setNewDomain("");
    setDomainSearch("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Policy Categories</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {total} categories · add or remove the domains each category blocks
          </p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm">
        {/* Filters */}
        <div className="p-4 border-b border-border flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search categories..."
              className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-left font-medium">Description</th>
                <th className="px-4 py-3 text-left font-medium">Risk</th>
                <th className="px-4 py-3 text-left font-medium">Domains</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-elevated">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(5)].map((__, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))
              ) : categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-subtle">
                    <Tags className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No categories found
                  </td>
                </tr>
              ) : (
                categories.map((cat: any) => {
                  const risk = riskLabel(cat.risk_level ?? 0);
                  return (
                    <tr key={cat.id} className="hover:bg-elevated transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-brand-500/10 text-brand-500"
                            style={cat.color ? { backgroundColor: `${cat.color}1a`, color: cat.color } : undefined}
                          >
                            <Tags className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{cat.name}</p>
                            <p className="text-xs text-subtle font-mono">{cat.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-body max-w-md">
                        <span className="line-clamp-1">{cat.description || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", risk.className)}>
                          {risk.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-elevated text-body">
                          <Globe className="w-3 h-3" />
                          {cat.domain_count ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openDomains(cat)}
                            title="View & manage domains"
                            className="p-1.5 hover:bg-elevated rounded text-subtle hover:text-body"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openDomains(cat)}
                            title="Add domain"
                            className="p-1.5 hover:bg-brand-500/10 rounded text-subtle hover:text-brand-500"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
      </div>

      {/* Domains modal */}
      {domainsCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-500/10 text-brand-500 flex-shrink-0"
                  style={domainsCategory.color ? { backgroundColor: `${domainsCategory.color}1a`, color: domainsCategory.color } : undefined}
                >
                  <Tags className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{domainsCategory.name}</h3>
                  <p className="text-xs text-muted-foreground">{domainTotal} domains in this category</p>
                </div>
              </div>
              <button onClick={closeDomains} className="text-subtle hover:text-body"><X className="w-5 h-5" /></button>
            </div>

            {/* Add + search */}
            <div className="px-6 py-4 border-b border-border space-y-3">
              <form
                onSubmit={e => {
                  e.preventDefault();
                  if (newDomain.trim()) addMut.mutate({ id: domainsCategory.id, domains: newDomain });
                }}
                className="flex gap-2"
              >
                <input
                  value={newDomain}
                  onChange={e => setNewDomain(e.target.value)}
                  placeholder="Add domain(s) — e.g. facebook.com, tiktok.com"
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="submit"
                  disabled={!newDomain.trim() || addMut.isPending}
                  className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-on-brand px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                >
                  {addMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add
                </button>
              </form>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                <input
                  value={domainSearch}
                  onChange={e => { setDomainSearch(e.target.value); setDomainPage(1); }}
                  placeholder="Search domains in this category..."
                  className="pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm w-full text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-6 py-3 text-left font-medium">Domain</th>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-elevated">
                  {domainsLoading ? (
                    [...Array(6)].map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {[...Array(3)].map((__, j) => (
                          <td key={j} className="px-4 py-4"><div className="h-4 bg-elevated rounded w-3/4" /></td>
                        ))}
                      </tr>
                    ))
                  ) : domains.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center py-12 text-subtle">
                        <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        {domainSearch ? "No domains match your search" : "No domains in this category yet"}
                      </td>
                    </tr>
                  ) : (
                    domains.map((d: any) => (
                      <tr key={d.id} className="hover:bg-elevated transition-colors">
                        <td className="px-6 py-3 font-mono text-foreground">{d.domain}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-medium",
                            d.scope === "custom" ? "bg-brand-500/10 text-brand-500" : "bg-elevated text-body"
                          )}>
                            {d.scope === "custom" ? "Added by you" : "Built-in"}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-end">
                            <button
                              onClick={() => setRemoveDomain(d)}
                              title="Remove domain"
                              className="p-1.5 hover:bg-red-500/10 rounded text-subtle hover:text-danger"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={domainPage}
              totalPages={domainTotalPages}
              total={domainTotal}
              limit={domainLimit}
              onPageChange={setDomainPage}
              onLimitChange={n => { setDomainLimit(n); setDomainPage(1); }}
            />

            <div className="px-6 py-4 border-t border-border flex justify-end">
              <button onClick={closeDomains} className="border border-border text-body px-5 py-2 rounded-lg text-sm hover:bg-elevated">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove domain confirm */}
      {removeDomain && domainsCategory && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="w-5 h-5 text-danger" />
            </div>
            <h3 className="text-center font-semibold text-foreground mb-2">Remove this domain?</h3>
            <p className="text-center text-sm text-muted-foreground mb-6">
              <span className="font-mono text-foreground">{removeDomain.domain}</span> will no longer be blocked by
              policies using <strong className="text-foreground">{domainsCategory.name}</strong>. This only affects your organization.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setRemoveDomain(null)} className="flex-1 border border-border text-body py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => deleteMut.mutate({ id: domainsCategory.id, domain: removeDomain.domain })}
                disabled={deleteMut.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {deleteMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Globe2,
  LoaderCircle,
  Network,
} from "lucide-react";

import { PageHeader } from "../components/page-header";
import { EmptyState } from "../components/ui/empty-state";
import { listDomains, type DomainSummary } from "../lib/desktop";

export function DomainsPage() {
  const domains = useQuery({ queryKey: ["domains"], queryFn: listDomains });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useMemo(() => {
    const groups = new Map<string, DomainSummary[]>();
    for (const domain of domains.data ?? []) {
      const current = groups.get(domain.registrableDomain) ?? [];
      current.push(domain);
      groups.set(domain.registrableDomain, current);
    }
    return [...groups.entries()];
  }, [domains.data]);

  function toggle(parent: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  }

  return (
    <div className="page">
      <PageHeader
        title="Domains"
        description="Explore registrable parent domains, subdomains, URLs, datasets, and linked records."
        meta={`${tree.length.toLocaleString()} PARENTS`}
      />
      {domains.isLoading ? (
        <div className="loading-line">
          <LoaderCircle className="animate-spin" size={16} />
          Resolving local domain groups
        </div>
      ) : tree.length ? (
        <section className="domain-explorer">
          <header className="domain-explorer__head">
            <span>Registrable domain</span>
            <span>Suffix</span>
            <span>Observed records</span>
          </header>
          {tree.map(([parent, entries]) => {
            const open = expanded.has(parent);
            const parentEntry = entries.find((entry) => !entry.isSubdomain);
            const total = entries.reduce(
              (sum, entry) => sum + entry.recordCount,
              0,
            );
            return (
              <div className="domain-group" key={parent}>
                <button
                  className="domain-row"
                  aria-expanded={open}
                  onClick={() => toggle(parent)}
                >
                  <span className="domain-row__name">
                    {open ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    <Globe2 size={15} />
                    <strong>{parent}</strong>
                    <small>
                      {entries.filter((entry) => entry.isSubdomain).length}{" "}
                      subdomains
                    </small>
                  </span>
                  <span className="font-mono">
                    {parentEntry?.publicSuffix ??
                      entries[0]?.publicSuffix ??
                      "none"}
                  </span>
                  <span className="font-mono">{total.toLocaleString()}</span>
                </button>
                {open ? (
                  <div className="domain-children">
                    {entries
                      .filter((entry) => entry.hostname !== parent)
                      .map((entry) => (
                        <article key={entry.id}>
                          <span>
                            <Network size={13} />
                            <code>{entry.hostname}</code>
                          </span>
                          <span className="font-mono">
                            {entry.recordCount.toLocaleString()} records
                          </span>
                        </article>
                      ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : (
        <EmptyState
          icon={Globe2}
          title="No normalized domains"
          description="Hostnames and URLs extracted during import will be grouped with Public Suffix List semantics."
          detail="portal.example.co.uk is grouped under example.co.uk."
        />
      )}
    </div>
  );
}

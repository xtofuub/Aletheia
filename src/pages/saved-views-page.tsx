import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, BookMarked, Braces, LoaderCircle } from "lucide-react";

import { PageHeader } from "../components/page-header";
import { EmptyState } from "../components/ui/empty-state";
import { listSavedSearches } from "../lib/desktop";

export function SavedViewsPage() {
  const views = useQuery({
    queryKey: ["saved-searches"],
    queryFn: listSavedSearches,
  });

  return (
    <div className="page">
      <PageHeader
        title="Saved Views"
        description="Preserve queries, filters, sort, visible columns, notes, and investigation context."
      />
      {views.isLoading ? (
        <div className="loading-line">
          <LoaderCircle className="animate-spin" size={16} />
          Reading saved local views
        </div>
      ) : views.data?.length ? (
        <div className="saved-view-grid">
          {views.data.map((view) => (
            <article key={view.id}>
              <header>
                <BookMarked size={17} />
                <span>
                  <strong>{view.name}</strong>
                  <small>{new Date(view.createdAt).toLocaleDateString()}</small>
                </span>
              </header>
              <code>{view.query}</code>
              <footer>
                <span>
                  <Braces size={13} />
                  Local filters retained
                </span>
                <Link to="/search">
                  Open search
                  <ArrowUpRight size={13} />
                </Link>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BookMarked}
          title="No saved investigations"
          description="Save a useful result view after the first search, then return without rebuilding its filters."
        />
      )}
    </div>
  );
}

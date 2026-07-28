import { useQuery } from "@tanstack/react-query";
import {
  Download,
  FileCheck2,
  FileJson2,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";

import { PageHeader } from "../components/page-header";
import { EmptyState } from "../components/ui/empty-state";
import { listExports } from "../lib/desktop";

export function ExportsPage() {
  const exports = useQuery({ queryKey: ["exports"], queryFn: listExports });

  return (
    <div className="page">
      <PageHeader
        title="Exports"
        description="Create deliberately scoped findings with redaction and a local audit trail."
        meta="STRICT REDACTION"
      />
      <section className="export-policy">
        <LockKeyhole size={18} />
        <div>
          <strong>Safe export defaults are enforced in Rust</strong>
          <span>
            Secret fields are excluded, sensitive values are masked, and every
            export gets a sidecar manifest.
          </span>
        </div>
        <span className="status-label" data-status="ready">
          <FileCheck2 size={13} />
          audit on
        </span>
      </section>
      {exports.isLoading ? (
        <div className="loading-line">
          <LoaderCircle className="animate-spin" size={16} />
          Reading export history
        </div>
      ) : exports.data?.length ? (
        <div className="data-list">
          <div className="data-list__head export-list__head">
            <span>Export</span>
            <span>Format</span>
            <span>Records</span>
            <span>Created</span>
          </div>
          {exports.data.map((item) => (
            <article className="data-list__row export-list__row" key={item.id}>
              <div className="data-list__identity">
                <FileJson2 size={16} />
                <span>
                  <strong>{fileName(item.destinationPath)}</strong>
                  <small className="font-mono">{item.destinationPath}</small>
                </span>
              </div>
              <span className="font-mono">{item.format.toUpperCase()}</span>
              <span className="font-mono">
                {item.recordCount.toLocaleString()}
              </span>
              <span className="font-mono">
                {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Download}
          title="No export history"
          description="Select findings on the Search page to create a redacted CSV. JSON, JSONL, and Markdown are available through the same native export pipeline."
          detail="Passwords, tokens, cookies, API keys, hashes, and raw records are excluded by default."
        />
      )}
    </div>
  );
}

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleStop,
  FilePlus2,
  Files,
  LoaderCircle,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";

import { ImportWizard } from "../components/import-wizard";
import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import {
  cancelImport,
  isTauriRuntime,
  listDatasets,
  listenImportProgress,
  pauseImport,
  resumeDatasetImport,
  resumeImport,
  startImport,
  type ImportPlan,
  type ImportProgress,
} from "../lib/desktop";
import { formatBytes } from "../lib/utils";

function isTerminalImport(status: ImportProgress["status"]) {
  return ["completed", "cancelled", "interrupted", "failed"].includes(status);
}

export function DatasetsPage() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [activeJob, setActiveJob] = useState<ImportProgress | null>(null);
  const datasets = useQuery({
    queryKey: ["datasets"],
    queryFn: listDatasets,
    refetchInterval:
      activeJob && !isTerminalImport(activeJob.status) ? 1500 : false,
  });

  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void listenImportProgress((progress) => {
      if (disposed) return;
      setActiveJob(progress);
      if (isTerminalImport(progress.status)) {
        void queryClient.invalidateQueries({ queryKey: ["datasets"] });
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [queryClient]);

  async function beginImport(plan: ImportPlan) {
    const result = await startImport(plan);
    setActiveJob({
      ...result,
      status: isTauriRuntime() ? "queued" : "completed",
      currentFile: null,
      bytesRead: 0,
      totalBytes: plan.files.reduce((sum, file) => sum + file.fileSize, 0),
      recordsProcessed: 0,
      recordsIndexed: isTauriRuntime() ? 0 : 3,
      invalidRecords: 0,
      duplicateRecords: 0,
      message: isTauriRuntime() ? "Import queued" : "Index ready",
    });
    setShowWizard(false);
    await queryClient.invalidateQueries({ queryKey: ["datasets"] });
  }

  async function pauseActiveJob() {
    if (!activeJob) return;
    await pauseImport(activeJob.jobId);
    setActiveJob((current) =>
      current
        ? { ...current, status: "paused", message: "Import paused locally" }
        : current,
    );
  }

  async function resumeActiveJob() {
    if (!activeJob) return;
    await resumeImport(activeJob.jobId);
    setActiveJob((current) =>
      current
        ? { ...current, status: "running", message: "Indexing local records" }
        : current,
    );
  }

  async function cancelActiveJob() {
    if (!activeJob) return;
    await cancelImport(activeJob.jobId);
    setActiveJob((current) =>
      current
        ? {
            ...current,
            status: "cancelling",
            message: "Cancelling after the current record",
          }
        : current,
    );
  }

  async function continueDataset(
    dataset: Awaited<ReturnType<typeof listDatasets>>[number],
  ) {
    try {
      const result = await resumeDatasetImport(dataset.id);
      setActiveJob({
        ...result,
        status: "queued",
        currentFile: null,
        bytesRead: 0,
        totalBytes: dataset.totalBytes,
        recordsProcessed: dataset.recordCount,
        recordsIndexed: dataset.recordCount,
        invalidRecords: dataset.warningCount,
        duplicateRecords: 0,
        message: "Resume queued from the last stored record",
      });
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
    } catch (error) {
      setActiveJob({
        jobId: "",
        datasetId: dataset.id,
        status: "failed",
        currentFile: null,
        bytesRead: 0,
        totalBytes: dataset.totalBytes,
        recordsProcessed: dataset.recordCount,
        recordsIndexed: dataset.recordCount,
        invalidRecords: dataset.warningCount,
        duplicateRecords: 0,
        message:
          error instanceof Error ? error.message : "Dataset could not resume",
      });
    }
  }

  const progress = activeJob?.totalBytes
    ? Math.min(100, (activeJob.bytesRead / activeJob.totalBytes) * 100)
    : 0;
  const terminal = activeJob && isTerminalImport(activeJob.status);

  if (showWizard) {
    return (
      <ImportWizard
        onClose={() => setShowWizard(false)}
        onStart={beginImport}
      />
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Datasets"
        description="Manage local source references, mappings, import reports, and generated indexes."
        action={
          <Button variant="primary" onClick={() => setShowWizard(true)}>
            <FilePlus2 size={16} aria-hidden="true" />
            Add source
          </Button>
        }
      />

      {activeJob ? (
        <section className="job-panel" aria-live="polite">
          <div className="job-panel__lead">
            {activeJob.status === "completed" ? (
              <CheckCircle2 size={18} aria-hidden="true" />
            ) : (
              <LoaderCircle
                className={terminal ? "" : "animate-spin"}
                size={18}
                aria-hidden="true"
              />
            )}
            <div>
              <strong>{activeJob.message}</strong>
              <span>
                {activeJob.currentFile ?? activeJob.status} ·{" "}
                {activeJob.recordsIndexed.toLocaleString()} indexed ·{" "}
                {activeJob.invalidRecords.toLocaleString()} invalid
              </span>
            </div>
          </div>
          <div
            className="job-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          {!terminal ? (
            <div className="job-panel__actions">
              {activeJob.status === "paused" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void resumeActiveJob()}
                >
                  <Play size={14} />
                  Resume
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void pauseActiveJob()}
                >
                  <Pause size={14} />
                  Pause
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void cancelActiveJob()}
              >
                <CircleStop size={14} />
                Cancel
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {datasets.isLoading ? (
        <div className="loading-line">
          <LoaderCircle className="animate-spin" size={16} />
          Reading local metadata
        </div>
      ) : datasets.data?.length ? (
        <div className="data-list" aria-label="Local datasets">
          <div className="data-list__head">
            <span>Dataset</span>
            <span>Status</span>
            <span>Records</span>
            <span>Sources</span>
            <span>Size</span>
          </div>
          {datasets.data.map((dataset) => (
            <article className="data-list__row" key={dataset.id}>
              <div className="data-list__identity">
                <Files size={16} aria-hidden="true" />
                <span>
                  <strong>{dataset.name}</strong>
                  <small className="font-mono">{dataset.id.slice(0, 8)}</small>
                </span>
              </div>
              <span className="dataset-status-cell">
                <span className="status-label" data-status={dataset.status}>
                  {dataset.status === "ready" ? (
                    <ShieldCheck size={13} />
                  ) : dataset.status === "indexing" ||
                    dataset.status === "queued" ? (
                    <LoaderCircle className="animate-spin" size={13} />
                  ) : (
                    <CircleStop size={13} />
                  )}
                  {dataset.status}
                </span>
                {["cancelled", "interrupted", "failed"].includes(
                  dataset.status,
                ) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void continueDataset(dataset)}
                  >
                    <Play size={13} />
                    Resume
                  </Button>
                ) : null}
              </span>
              <span className="font-mono">
                {dataset.recordCount.toLocaleString()}
              </span>
              <span className="font-mono">{dataset.fileCount}</span>
              <span className="font-mono">
                {formatBytes(dataset.totalBytes)}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FilePlus2}
          title="No datasets have been added"
          description="Choose a local file or folder to create the first searchable index. The source remains unchanged and is never uploaded."
          detail="Detection previews are masked before they reach the interface."
          action={
            <Button variant="primary" onClick={() => setShowWizard(true)}>
              <FilePlus2 size={16} />
              Add authorized source
            </Button>
          }
        />
      )}
    </div>
  );
}

import type { ImportProgress } from "@/lib/desktop";

export type ImportControlStatus = "running" | "paused" | "cancelling";

const terminalStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const controlMessages: Record<ImportControlStatus, string> = {
  running: "Indexing local records",
  paused: "Import paused",
  cancelling: "Finishing cancellation safely",
};

export function mergeImportProgress(
  current: ImportProgress | null,
  next: ImportProgress,
  forcedStatus?: ImportControlStatus | null,
): ImportProgress {
  if (!current || current.jobId !== next.jobId) {
    return forcedStatus && !terminalStatuses.has(next.status)
      ? {
          ...next,
          status: forcedStatus,
          message: controlMessages[forcedStatus],
        }
      : next;
  }
  if (terminalStatuses.has(current.status)) return current;

  const keepStartedStatus =
    next.status === "queued" && current.status !== "queued";
  const status = terminalStatuses.has(next.status)
    ? next.status
    : (forcedStatus ?? (keepStartedStatus ? current.status : next.status));
  const message = terminalStatuses.has(next.status)
    ? next.message
    : forcedStatus
      ? controlMessages[forcedStatus]
      : keepStartedStatus
        ? current.message
        : next.message;

  return {
    ...next,
    status,
    message,
    currentFile: next.currentFile ?? current.currentFile,
    bytesRead: Math.max(current.bytesRead, next.bytesRead),
    totalBytes: Math.max(current.totalBytes, next.totalBytes),
    recordsProcessed: Math.max(current.recordsProcessed, next.recordsProcessed),
    recordsIndexed: Math.max(current.recordsIndexed, next.recordsIndexed),
    invalidRecords: Math.max(current.invalidRecords, next.invalidRecords),
    duplicateRecords: Math.max(current.duplicateRecords, next.duplicateRecords),
  };
}

export function isTerminalImportStatus(status: string) {
  return terminalStatuses.has(status);
}

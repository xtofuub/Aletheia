import { describe, expect, it } from "vitest";

import type { ImportProgress } from "@/lib/desktop";
import { mergeImportProgress } from "@/lib/import-progress";

function progress(overrides: Partial<ImportProgress> = {}): ImportProgress {
  return {
    jobId: "job-1",
    datasetId: "dataset-1",
    status: "running",
    currentFile: "records.txt",
    bytesRead: 200,
    totalBytes: 1_000,
    recordsProcessed: 20,
    recordsIndexed: 18,
    invalidRecords: 1,
    duplicateRecords: 1,
    message: "Indexing local records",
    ...overrides,
  };
}

describe("mergeImportProgress", () => {
  it("does not let a late queued snapshot reset visible progress", () => {
    const merged = mergeImportProgress(
      progress(),
      progress({
        status: "queued",
        bytesRead: 0,
        recordsProcessed: 0,
        recordsIndexed: 0,
        message: "Import queued",
      }),
    );
    expect(merged.status).toBe("running");
    expect(merged.bytesRead).toBe(200);
    expect(merged.recordsIndexed).toBe(18);
  });

  it("keeps pause and cancellation controls stable across stale events", () => {
    expect(
      mergeImportProgress(progress(), progress({ bytesRead: 240 }), "paused")
        .status,
    ).toBe("paused");
    expect(
      mergeImportProgress(
        progress({ status: "paused" }),
        progress({ bytesRead: 260 }),
        "cancelling",
      ).status,
    ).toBe("cancelling");
  });

  it("allows terminal worker acknowledgements through", () => {
    const merged = mergeImportProgress(
      progress({ status: "cancelling" }),
      progress({ status: "cancelled", message: "Import cancelled" }),
      "cancelling",
    );
    expect(merged.status).toBe("cancelled");
  });
});

import { describe, expect, it } from "vitest";

import {
  applyPendingControl,
  mergeDirectSearchProgress,
} from "./use-direct-search-progress";
import type { DirectSearchProgress } from "@/lib/desktop";

function progress(
  status: DirectSearchProgress["status"],
  hits: DirectSearchProgress["hits"],
  sequence = 1,
): DirectSearchProgress {
  return {
    jobId: "job-1",
    sequence,
    status,
    currentSource: null,
    sourceCount: 1,
    filesScanned: status === "completed" ? 1 : 0,
    totalBytes: 100,
    sourceBytesScanned: status === "completed" ? 100 : 50,
    contentBytesScanned: status === "completed" ? 100 : 50,
    matches: hits.length,
    elapsedMs: 10,
    bytesPerSecond: 10,
    estimatedRemainingMs: status === "completed" ? null : 10,
    queryCount: 1,
    truncated: false,
    message: status,
    hits,
  };
}

describe("mergeDirectSearchProgress", () => {
  it("keeps streamed hits when the completion event has no batch", () => {
    const hit = {
      id: "hit-1",
      sourcePath: "C:\\Synthetic\\source.txt",
      sourceFile: "source.txt",
      archiveEntry: null,
      sourceLocation: "line 2",
      excerpt: "synthetic row",
      matchReason: "Line contains query",
      matchedQuery: "synthetic",
    };
    const running = progress("running", [hit]);
    const completed = progress("completed", []);

    expect(mergeDirectSearchProgress(running, completed).hits).toBe(
      running.hits,
    );
  });

  it("does not let a late worker event move counters backwards", () => {
    const newer = {
      ...progress("running", [], 4),
      sourceBytesScanned: 80,
      contentBytesScanned: 160,
      elapsedMs: 400,
    };
    const stale = {
      ...progress("running", [], 3),
      sourceBytesScanned: 20,
      contentBytesScanned: 40,
      elapsedMs: 200,
    };

    expect(mergeDirectSearchProgress(newer, stale)).toEqual(newer);
  });

  it("ignores the zeroed start snapshot when scan events arrived first", () => {
    const running = {
      ...progress("running", [], 2),
      sourceBytesScanned: 25,
    };
    const startSnapshot = {
      ...progress("running", [], 0),
      sourceBytesScanned: 0,
    };

    expect(
      mergeDirectSearchProgress(running, startSnapshot).sourceBytesScanned,
    ).toBe(25);
  });

  it("shows control acknowledgement immediately while the worker catches up", () => {
    const running = progress("running", [], 2);
    expect(
      applyPendingControl(running, { action: "pause", jobId: "job-1" }),
    ).toMatchObject({ status: "paused", message: "Pausing live search" });
    expect(
      applyPendingControl(running, { action: "cancel", jobId: "job-1" }),
    ).toMatchObject({
      status: "cancelling",
      message: "Cancelling live search",
    });
  });
});

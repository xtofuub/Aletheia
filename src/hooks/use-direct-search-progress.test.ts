import { describe, expect, it } from "vitest";

import { mergeDirectSearchProgress } from "./use-direct-search-progress";
import type { DirectSearchProgress } from "@/lib/desktop";

function progress(
  status: DirectSearchProgress["status"],
  hits: DirectSearchProgress["hits"],
): DirectSearchProgress {
  return {
    jobId: "job-1",
    status,
    currentSource: null,
    sourceCount: 1,
    filesScanned: status === "completed" ? 1 : 0,
    totalBytes: 100,
    contentBytesScanned: status === "completed" ? 100 : 50,
    matches: hits.length,
    elapsedMs: 10,
    bytesPerSecond: 10,
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
    };
    const running = progress("running", [hit]);
    const completed = progress("completed", []);

    expect(mergeDirectSearchProgress(running, completed).hits).toEqual([hit]);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildIndexGrowthRows,
  buildSearchActivityRows,
  growthPercent,
} from "@/lib/dashboard-chart-data";
import type { DatasetSummary, LiveSearchActivity } from "@/lib/desktop";

function dataset(
  id: string,
  recordCount: number,
  lastIndexedAt: string,
): DatasetSummary {
  return {
    id,
    name: id,
    status: "ready",
    recordCount,
    fileCount: 1,
    totalBytes: 100,
    warningCount: 0,
    createdAt: lastIndexedAt,
    lastIndexedAt,
  };
}

function liveSearch(completedAt: string, matches: number): LiveSearchActivity {
  return {
    jobId: "job-1",
    sourceId: "source-1",
    sourceName: "Synthetic source",
    matches,
    filesScanned: 1,
    bytesScanned: 100,
    completedAt,
  };
}

describe("dashboard chart data", () => {
  it("builds a cumulative seven-day index-growth window", () => {
    const rows = buildIndexGrowthRows([
      dataset("older", 10, "2026-08-01T12:00:00.000Z"),
      dataset("recent", 30, "2026-08-07T12:00:00.000Z"),
    ]);

    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({ date: "2026-08-01", records: 10 });
    expect(rows.at(-1)).toEqual({ date: "2026-08-07", records: 40 });
  });

  it("keeps indexed and Live activity as separate daily series", () => {
    const rows = buildSearchActivityRows(
      [dataset("index", 4_000_000, "2026-08-07T12:00:00.000Z")],
      [liveSearch("2026-08-06T12:00:00.000Z", 42)],
    );

    expect(rows).toHaveLength(7);
    expect(rows.at(-2)).toMatchObject({ live: 42, indexed: 0 });
    expect(rows.at(-1)).toMatchObject({ live: 0, indexed: 4_000_000 });
  });

  it("handles growth from an empty baseline", () => {
    expect(growthPercent(0, 20)).toBe(100);
    expect(growthPercent(0, 0)).toBe(0);
    expect(growthPercent(10, 15)).toBe(50);
  });
});

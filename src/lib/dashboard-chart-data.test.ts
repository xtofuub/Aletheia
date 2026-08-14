import { describe, expect, it } from "vitest";

import { buildDatasetScaleRows } from "@/lib/dashboard-chart-data";
import type { DatasetSummary } from "@/lib/desktop";

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

describe("dataset landscape data", () => {
  it("ranks sources and calculates total and relative shares", () => {
    const rows = buildDatasetScaleRows([
      dataset("small", 10, "2026-08-01T12:00:00.000Z"),
      dataset("large", 30, "2026-08-07T12:00:00.000Z"),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["large", "small"]);
    expect(rows[0]).toMatchObject({
      share: 75,
      relativeScale: 100,
      records: 30,
    });
    expect(rows[1]).toMatchObject({ share: 25, records: 10 });
    expect(rows[1]?.relativeScale).toBeCloseTo(100 / 3);
  });

  it("limits rows without changing shares of the whole workspace", () => {
    const rows = buildDatasetScaleRows(
      [
        dataset("first", 50, "2026-08-01T12:00:00.000Z"),
        dataset("second", 30, "2026-08-02T12:00:00.000Z"),
        dataset("third", 20, "2026-08-03T12:00:00.000Z"),
      ],
      2,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.share).toBe(50);
    expect(rows[1]?.share).toBe(30);
  });

  it("drops empty sources and handles an empty workspace", () => {
    expect(
      buildDatasetScaleRows([dataset("empty", 0, "2026-08-01T12:00:00.000Z")]),
    ).toEqual([]);
    expect(buildDatasetScaleRows([])).toEqual([]);
  });
});

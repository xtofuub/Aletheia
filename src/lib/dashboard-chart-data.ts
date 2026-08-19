import type { DatasetSummary } from "@/lib/desktop";

export interface DatasetScaleRow {
  id: string;
  name: string;
  status: string;
  records: number;
  files: number;
  relativeScale: number;
}

export function buildDatasetScaleRows(
  datasets: DatasetSummary[],
  limit = 6,
): DatasetScaleRow[] {
  const normalized = datasets.map((dataset) => ({
    ...dataset,
    recordCount: Math.max(0, dataset.recordCount),
  }));
  const sorted = normalized
    .filter((dataset) => dataset.recordCount > 0)
    .sort(
      (left, right) =>
        right.recordCount - left.recordCount ||
        left.name.localeCompare(right.name),
    )
    .slice(0, Math.max(0, limit));
  const largest = sorted[0]?.recordCount ?? 0;

  return sorted.map((dataset) => ({
    id: dataset.id,
    name: dataset.name,
    status: dataset.status,
    records: dataset.recordCount,
    files: Math.max(0, dataset.fileCount),
    relativeScale: largest > 0 ? (dataset.recordCount / largest) * 100 : 0,
  }));
}

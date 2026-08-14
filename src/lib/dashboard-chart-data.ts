import type { DatasetSummary, LiveSearchActivity } from "@/lib/desktop";

const DAY_MS = 86_400_000;

export interface IndexGrowthRow {
  date: string;
  records: number;
}

export interface SearchActivityRow {
  date: string;
  indexed: number;
  live: number;
}

function timestampDay(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setTime(date.getTime() + offset * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function latestDay(days: Array<string | null>): string | null {
  return (
    days
      .filter((day): day is string => Boolean(day))
      .sort()
      .at(-1) ?? null
  );
}

function todayDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function rollingEndDay(eventDays: string[], endDay?: string): string | null {
  if (!eventDays.length) return null;
  return latestDay([endDay ?? todayDay(), ...eventDays]);
}

function dateWindow(endDay: string, visibleDays: number): string[] {
  const days = Math.max(1, visibleDays);
  return Array.from({ length: days }, (_, index) =>
    shiftDay(endDay, index - days + 1),
  );
}

export function buildIndexGrowthRows(
  datasets: DatasetSummary[],
  visibleDays = 7,
  endDay?: string,
): IndexGrowthRow[] {
  const events = datasets.flatMap((dataset) => {
    const date = timestampDay(dataset.lastIndexedAt ?? dataset.createdAt);
    return date ? [{ date, records: Math.max(0, dataset.recordCount) }] : [];
  });
  const rollingEnd = rollingEndDay(
    events.map((event) => event.date),
    endDay,
  );
  if (!rollingEnd) return [];

  return dateWindow(rollingEnd, visibleDays).map((date) => ({
    date,
    records: events.reduce(
      (total, event) => total + (event.date <= date ? event.records : 0),
      0,
    ),
  }));
}

export function buildSearchActivityRows(
  datasets: DatasetSummary[],
  liveSearches: LiveSearchActivity[],
  visibleDays = 7,
  endDay?: string,
): SearchActivityRow[] {
  const indexedEvents = datasets.flatMap((dataset) => {
    const date = timestampDay(dataset.lastIndexedAt ?? dataset.createdAt);
    return date ? [{ date, records: Math.max(0, dataset.recordCount) }] : [];
  });
  const liveEvents = liveSearches.flatMap((activity) => {
    const date = timestampDay(activity.completedAt);
    return date ? [{ date, matches: Math.max(0, activity.matches) }] : [];
  });
  const rollingEnd = rollingEndDay(
    [
      ...indexedEvents.map((event) => event.date),
      ...liveEvents.map((event) => event.date),
    ],
    endDay,
  );
  if (!rollingEnd) return [];

  return dateWindow(rollingEnd, visibleDays).map((date) => ({
    date,
    indexed: indexedEvents.reduce(
      (total, event) => total + (event.date === date ? event.records : 0),
      0,
    ),
    live: liveEvents.reduce(
      (total, event) => total + (event.date === date ? event.matches : 0),
      0,
    ),
  }));
}

export function growthPercent(first: number, last: number): number {
  if (first <= 0) return last > 0 ? 100 : 0;
  return ((last - first) / first) * 100;
}

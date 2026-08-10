import { useCallback, useEffect, useState } from "react";

import {
  listenDirectSearchProgress,
  type DirectSearchProgress,
  type DirectSearchStart,
} from "@/lib/desktop";

export function mergeDirectSearchProgress(
  previous: DirectSearchProgress | null,
  next: DirectSearchProgress,
) {
  if (!previous || previous.jobId !== next.jobId) return next;
  const hits = new Map(previous.hits.map((hit) => [hit.id, hit]));
  for (const hit of next.hits) hits.set(hit.id, hit);
  return { ...next, hits: [...hits.values()] };
}

export function useDirectSearchProgress() {
  const [progress, setProgress] = useState<DirectSearchProgress | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenDirectSearchProgress((next) => {
      setProgress((previous) => mergeDirectSearchProgress(previous, next));
    }).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, []);

  const begin = useCallback((start: DirectSearchStart) => {
    setProgress((previous) =>
      mergeDirectSearchProgress(previous, {
        jobId: start.jobId,
        status: "running",
        currentSource: null,
        sourceCount: start.sourceCount,
        filesScanned: 0,
        totalBytes: start.totalBytes,
        contentBytesScanned: 0,
        matches: 0,
        elapsedMs: 0,
        bytesPerSecond: 0,
        truncated: false,
        message: "Scanning local sources",
        hits: [],
      }),
    );
  }, []);

  const clear = useCallback(() => setProgress(null), []);

  return { begin, clear, progress };
}

import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelDirectSearch,
  listenDirectSearchProgress,
  pauseDirectSearch,
  resumeDirectSearch,
  type DirectSearchProgress,
  type DirectSearchStart,
} from "@/lib/desktop";

type DirectSearchControl = "pause" | "resume" | "cancel";

interface PendingControl {
  action: DirectSearchControl;
  jobId: string;
}

export function mergeDirectSearchProgress(
  previous: DirectSearchProgress | null,
  next: DirectSearchProgress,
) {
  if (!previous || previous.jobId !== next.jobId) return next;
  const hits = new Map(previous.hits.map((hit) => [hit.id, hit]));
  for (const hit of next.hits) hits.set(hit.id, hit);
  if (next.sequence < previous.sequence) {
    return { ...previous, hits: [...hits.values()] };
  }
  return {
    ...next,
    contentBytesScanned: Math.max(
      previous.contentBytesScanned,
      next.contentBytesScanned,
    ),
    elapsedMs: Math.max(previous.elapsedMs, next.elapsedMs),
    filesScanned: Math.max(previous.filesScanned, next.filesScanned),
    matches: Math.max(previous.matches, next.matches),
    sourceBytesScanned: Math.max(
      previous.sourceBytesScanned,
      next.sourceBytesScanned,
    ),
    hits: [...hits.values()],
  };
}

export function applyPendingControl(
  progress: DirectSearchProgress | null,
  pending: PendingControl | null,
) {
  if (!progress || !pending || progress.jobId !== pending.jobId)
    return progress;
  if (pending.action === "pause") {
    return {
      ...progress,
      status: "paused" as const,
      message: "Pausing live search",
    };
  }
  if (pending.action === "resume") {
    return {
      ...progress,
      status: "running" as const,
      message: "Resuming live search",
    };
  }
  return {
    ...progress,
    status: "cancelling" as const,
    message: "Cancelling live search",
  };
}

export function useDirectSearchProgress() {
  const [progress, setProgress] = useState<DirectSearchProgress | null>(null);
  const latestProgress = useRef<DirectSearchProgress | null>(null);
  const pendingProgress = useRef<DirectSearchProgress | null>(null);
  const animationFrame = useRef<number | null>(null);
  const [pendingControl, setPendingControl] = useState<PendingControl | null>(
    null,
  );
  const [controlError, setControlError] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenDirectSearchProgress((next) => {
      const merged = mergeDirectSearchProgress(latestProgress.current, next);
      latestProgress.current = merged;
      pendingProgress.current = merged;
      if (animationFrame.current === null) {
        animationFrame.current = window.requestAnimationFrame(() => {
          animationFrame.current = null;
          if (pendingProgress.current) setProgress(pendingProgress.current);
        });
      }
    }).then((value) => {
      unlisten = value;
    });
    return () => {
      unlisten?.();
      if (animationFrame.current !== null) {
        window.cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  const begin = useCallback((start: DirectSearchStart) => {
    const merged = mergeDirectSearchProgress(latestProgress.current, {
      jobId: start.jobId,
      sequence: 0,
      status: "running",
      currentSource: null,
      sourceCount: start.sourceCount,
      filesScanned: 0,
      totalBytes: start.totalBytes,
      sourceBytesScanned: 0,
      contentBytesScanned: 0,
      matches: 0,
      elapsedMs: 0,
      bytesPerSecond: 0,
      estimatedRemainingMs: null,
      queryCount: start.queryCount,
      truncated: false,
      message: "Scanning local sources",
      hits: [],
    });
    latestProgress.current = merged;
    pendingProgress.current = merged;
    setProgress(merged);
    setPendingControl(null);
    setControlError("");
  }, []);

  const clear = useCallback(() => {
    latestProgress.current = null;
    pendingProgress.current = null;
    setProgress(null);
    setPendingControl(null);
    setControlError("");
  }, []);

  const control = useCallback(
    async (jobId: string, action: DirectSearchControl) => {
      setControlError("");
      setPendingControl({ action, jobId });
      try {
        if (action === "pause") await pauseDirectSearch(jobId);
        else if (action === "resume") await resumeDirectSearch(jobId);
        else await cancelDirectSearch(jobId);
      } catch (error) {
        setPendingControl(null);
        setControlError(String(error));
      }
    },
    [],
  );

  const pause = useCallback(
    (jobId: string) => control(jobId, "pause"),
    [control],
  );
  const resume = useCallback(
    (jobId: string) => control(jobId, "resume"),
    [control],
  );
  const cancel = useCallback(
    (jobId: string) => control(jobId, "cancel"),
    [control],
  );
  const pendingConfirmed =
    pendingControl &&
    progress?.jobId === pendingControl.jobId &&
    (["cancelled", "completed", "failed"].includes(progress.status) ||
      (pendingControl.action === "pause" && progress.status === "paused") ||
      (pendingControl.action === "resume" && progress.status === "running"));
  const activePendingControl = pendingConfirmed ? null : pendingControl;

  return {
    begin,
    cancel,
    clear,
    controlError,
    controlPending: activePendingControl?.action ?? null,
    pause,
    progress: applyPendingControl(progress, activePendingControl),
    resume,
  };
}

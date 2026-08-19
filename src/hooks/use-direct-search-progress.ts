import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  cancelDirectSearch,
  discardDirectSearchSession,
  getRecoverableDirectSearch,
  listenDirectSearchProgress,
  pauseDirectSearch,
  restartDirectSearchSession,
  resumeDirectSearch,
  type DirectSearchProgress,
  type DirectSearchStart,
} from "@/lib/desktop";

type DirectSearchControl = "pause" | "resume" | "cancel";

interface PendingControl {
  action: DirectSearchControl;
  jobId: string;
}

export interface DirectSearchSessionMeta {
  scope: "domains" | "identities" | "search";
  query?: string;
  sourceId?: string;
  sourceName?: string;
}

export interface DirectSearchSession extends DirectSearchSessionMeta {
  handled: boolean;
  jobId: string;
}

export function mergeDirectSearchProgress(
  previous: DirectSearchProgress | null,
  next: DirectSearchProgress,
) {
  if (!previous || previous.jobId !== next.jobId) return next;
  if (next.sequence < previous.sequence) {
    if (next.hits.length === 0) return previous;
    const hits = new Map(previous.hits.map((hit) => [hit.id, hit]));
    for (const hit of next.hits) hits.set(hit.id, hit);
    return { ...previous, hits: [...hits.values()] };
  }
  let hits = previous.hits;
  if (next.hits.length > 0) {
    const merged = new Map(previous.hits.map((hit) => [hit.id, hit]));
    for (const hit of next.hits) merged.set(hit.id, hit);
    hits = [...merged.values()];
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
    hits,
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

function useDirectSearchProgressState() {
  const [progress, setProgress] = useState<DirectSearchProgress | null>(null);
  const [session, setSession] = useState<DirectSearchSession | null>(null);
  const latestProgress = useRef<DirectSearchProgress | null>(null);
  const activeJobId = useRef<string | null>(null);
  const recoveredJobId = useRef<string | null>(null);
  const pendingProgress = useRef<DirectSearchProgress | null>(null);
  const animationFrame = useRef<number | null>(null);
  const [pendingControl, setPendingControl] = useState<PendingControl | null>(
    null,
  );
  const [controlError, setControlError] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenDirectSearchProgress((next) => {
      if (activeJobId.current && next.jobId !== activeJobId.current) return;
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

  useEffect(() => {
    let cancelled = false;
    void getRecoverableDirectSearch()
      .then((recovery) => {
        if (cancelled || !recovery || activeJobId.current) return;
        const recoveredSession: DirectSearchSession = {
          handled: false,
          jobId: recovery.progress.jobId,
          query: recovery.query,
          scope: recovery.scope,
          ...(recovery.sourceId ? { sourceId: recovery.sourceId } : {}),
          ...(recovery.sourceName ? { sourceName: recovery.sourceName } : {}),
        };
        activeJobId.current = recovery.progress.jobId;
        recoveredJobId.current = recovery.progress.jobId;
        latestProgress.current = recovery.progress;
        pendingProgress.current = recovery.progress;
        setProgress(recovery.progress);
        setSession(recoveredSession);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const begin = useCallback(
    (start: DirectSearchStart, metadata?: DirectSearchSessionMeta) => {
      activeJobId.current = start.jobId;
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
      const nextSession = metadata
        ? { ...metadata, handled: false, jobId: start.jobId }
        : null;
      setSession(nextSession);
      setPendingControl(null);
      setControlError("");
    },
    [],
  );

  const clear = useCallback(() => {
    activeJobId.current = null;
    recoveredJobId.current = null;
    latestProgress.current = null;
    pendingProgress.current = null;
    setProgress(null);
    setSession(null);
    setPendingControl(null);
    setControlError("");
  }, []);

  const markHandled = useCallback((jobId: string) => {
    setSession((current) =>
      current?.jobId === jobId ? { ...current, handled: true } : current,
    );
  }, []);

  const control = useCallback(
    async (jobId: string, action: DirectSearchControl) => {
      setControlError("");
      setPendingControl({ action, jobId });
      try {
        if (recoveredJobId.current === jobId) {
          if (action === "resume") {
            const start = await restartDirectSearchSession(jobId);
            recoveredJobId.current = null;
            const current = latestProgress.current;
            const resumed = current
              ? {
                  ...current,
                  status: "running" as const,
                  message: "Resuming from a saved checkpoint",
                }
              : null;
            latestProgress.current = resumed;
            pendingProgress.current = resumed;
            setProgress(resumed);
            activeJobId.current = start.jobId;
          } else if (action === "cancel") {
            await discardDirectSearchSession(jobId);
            recoveredJobId.current = null;
            const current = latestProgress.current;
            const discarded = current
              ? {
                  ...current,
                  status: "cancelled" as const,
                  message: "Interrupted scan dismissed",
                }
              : null;
            latestProgress.current = discarded;
            pendingProgress.current = discarded;
            setProgress(discarded);
          }
        } else if (action === "pause") await pauseDirectSearch(jobId);
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
    markHandled,
    pause,
    progress: applyPendingControl(progress, activePendingControl),
    resume,
    session,
  };
}

type DirectSearchProgressContextValue = ReturnType<
  typeof useDirectSearchProgressState
>;

const DirectSearchProgressContext =
  createContext<DirectSearchProgressContextValue | null>(null);

export function DirectSearchProgressProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useDirectSearchProgressState();
  return createElement(
    DirectSearchProgressContext.Provider,
    { value },
    children,
  );
}

export function useDirectSearchProgress() {
  const context = useContext(DirectSearchProgressContext);
  if (!context) {
    throw new Error(
      "useDirectSearchProgress must be used within DirectSearchProgressProvider",
    );
  }
  return context;
}

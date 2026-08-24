import { ArrowRightIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { useDirectSearchProgress } from "@/hooks/use-direct-search-progress";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatProgressPercent,
} from "@/lib/format";

const activeStatuses = ["running", "paused", "cancelling"];

export function ActiveDomainScan() {
  const {
    cancel,
    controlPending,
    markHandled,
    pause,
    progress,
    resume,
    session,
  } = useDirectSearchProgress();
  if (
    session?.scope !== "domains" ||
    !progress ||
    progress.jobId !== session.jobId ||
    (session.handled && !activeStatuses.includes(progress.status))
  ) {
    return null;
  }

  const percent = progress.totalBytes
    ? Math.min(100, (progress.sourceBytesScanned / progress.totalBytes) * 100)
    : 0;
  const controllable = ["running", "paused"].includes(progress.status);

  return (
    <section
      aria-label="Active domain scan"
      className="state-reveal border-b bg-muted/30 px-4 py-3 md:px-6"
    >
      <div className="mx-auto flex w-full max-w-(--app-wrapper-max-width) flex-col gap-2 lg:flex-row lg:items-center">
        <Progress className="min-w-0 flex-1" value={percent}>
          <ProgressLabel>
            Live domain scan · {session.query ?? "Domain"}
          </ProgressLabel>
          <ProgressValue>{() => formatProgressPercent(percent)}</ProgressValue>
        </Progress>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {formatBytes(progress.bytesPerSecond)}/s
          </Badge>
          <Badge variant="outline">
            {formatCount(progress.matches)} matches
          </Badge>
          <Badge variant="outline">
            {progress.status === "paused"
              ? "Paused"
              : progress.status === "cancelling"
                ? "Stopping"
                : `${formatDuration(progress.estimatedRemainingMs)} remaining`}
          </Badge>
          {progress.status === "running" ? (
            <Button
              disabled={controlPending !== null}
              onClick={() => void pause(progress.jobId)}
              size="sm"
              variant="outline"
            >
              <PauseIcon data-icon="inline-start" />
              Pause
            </Button>
          ) : progress.status === "paused" ? (
            <Button
              disabled={controlPending !== null}
              onClick={() => void resume(progress.jobId)}
              size="sm"
              variant="outline"
            >
              <PlayIcon data-icon="inline-start" />
              Continue
            </Button>
          ) : null}
          {controllable || progress.status === "cancelling" ? (
            <Button
              disabled={controlPending !== null}
              onClick={() => void cancel(progress.jobId)}
              size="sm"
              variant="outline"
            >
              <SquareIcon data-icon="inline-start" />
              Cancel
            </Button>
          ) : null}
          {["cancelled", "failed"].includes(progress.status) ? (
            <Button
              onClick={() => markHandled(progress.jobId)}
              size="sm"
              variant="ghost"
            >
              Dismiss
            </Button>
          ) : null}
          <Button
            nativeButton={false}
            render={<a href="#/domains" />}
            size="sm"
            variant="outline"
          >
            Open Domains
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { GaugeIcon } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { preflightDirectSearch, type LiveSourceSummary } from "@/lib/desktop";
import { formatBytes, formatDuration } from "@/lib/format";

export function LiveSearchPreflight({
  currentWorkerLimit,
  includeArchives,
  onUseRecommendedWorkers,
  source,
}: {
  currentWorkerLimit: number;
  includeArchives: boolean;
  onUseRecommendedWorkers?: (workers: number) => void;
  source: LiveSourceSummary | null;
}) {
  const preflight = useQuery({
    queryKey: [
      "direct-search-preflight",
      source?.id,
      source?.paths,
      includeArchives,
    ],
    queryFn: () =>
      preflightDirectSearch({
        paths: source?.paths ?? [],
        includeArchives,
      }),
    enabled: Boolean(source),
    staleTime: 30 * 60 * 1_000,
  });

  if (!source) return null;

  if (preflight.isPending) {
    return (
      <Alert role="status">
        <Spinner />
        <AlertTitle>Measuring this Live source</AlertTitle>
        <AlertDescription>
          Reading a small sample without changing the selected files.
        </AlertDescription>
      </Alert>
    );
  }

  if (preflight.isError) {
    return (
      <Alert variant="destructive">
        <GaugeIcon />
        <AlertTitle>Source estimate unavailable</AlertTitle>
        <AlertDescription>{String(preflight.error)}</AlertDescription>
      </Alert>
    );
  }

  const result = preflight.data;
  const recommendationChanged =
    result.recommendedWorkerLimit !== currentWorkerLimit;

  return (
    <Alert>
      <GaugeIcon />
      <AlertTitle>
        Approximate full scan: {formatDuration(result.estimatedMinimumMs)}–
        {formatDuration(result.estimatedMaximumMs)}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>
          This range assumes every byte must be read. A result cap can finish
          sooner. ZIP, RAR, and GZIP timing varies with compression ratio.
        </p>
        <p>
          Results and safe byte checkpoints stay on this device. After an
          interruption, Continue skips completed files and already scanned
          plain-text blocks.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {formatBytes(result.totalBytes)} source
          </Badge>
          <Badge variant="outline">
            {formatBytes(result.sampleReadBytesPerSecond)}/s sampled read
          </Badge>
          <Badge variant="outline">{result.bottleneck} bottleneck</Badge>
          <Badge variant="outline">
            {result.sourceReaderLimit} sequential reader
          </Badge>
          <Badge variant="outline">
            {result.recommendedWorkerLimit} match workers
          </Badge>
          {result.archiveCount ? (
            <>
              <Badge variant="outline">
                {result.archiveCount.toLocaleString()} archives
              </Badge>
              <Badge variant="outline">
                {formatBytes(result.archiveBytesPerSecond)}/s archive decode
              </Badge>
            </>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{result.confidence}</p>
      </AlertDescription>
      {onUseRecommendedWorkers && recommendationChanged ? (
        <AlertAction>
          <Button
            onClick={() =>
              onUseRecommendedWorkers(result.recommendedWorkerLimit)
            }
            size="sm"
            variant="outline"
          >
            Use {result.recommendedWorkerLimit} workers
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

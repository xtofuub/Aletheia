import { useEffect, useState } from "react";
import {
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  checkForUpdates,
  downloadAndInstallUpdate,
  openReleasePage,
  type UpdateInstallProgress,
  type UpdateStatus,
} from "@/lib/desktop";

interface ApplicationUpdatePromptProps {
  enabled: boolean;
  checkUpdates?: () => Promise<UpdateStatus>;
  installUpdate?: (
    onProgress: (progress: UpdateInstallProgress) => void,
  ) => Promise<boolean>;
  checkDelayMs?: number;
}

const progressLabels: Record<UpdateInstallProgress["state"], string> = {
  checking: "Checking signed release",
  downloading: "Downloading update",
  installing: "Installing update",
  restarting: "Restarting Aletheia",
};

export function ApplicationUpdatePrompt({
  enabled,
  checkUpdates = checkForUpdates,
  installUpdate = downloadAndInstallUpdate,
  checkDelayMs = 1_500,
}: ApplicationUpdatePromptProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [progress, setProgress] = useState<UpdateInstallProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkUpdates()
        .then((next) => {
          if (cancelled || !next.updateAvailable) return;
          setStatus(next);
          setOpen(true);
        })
        .catch(() => {
          // Startup checks stay quiet when the device is offline.
        });
    }, checkDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkDelayMs, checkUpdates, enabled]);

  const updatePercent = progress?.totalBytes
    ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
    : 0;

  async function install() {
    setError("");
    setInstalling(true);
    try {
      const started = await installUpdate(setProgress);
      if (!started) {
        setProgress(null);
        setError(
          "The signed update is no longer available. Check again later.",
        );
      }
    } catch {
      setError(
        "The update could not be installed. Your current installation was left unchanged.",
      );
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="max-w-md" showCloseButton={!installing}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Signed update</Badge>
            <Badge variant="outline">v{status?.latestVersion}</Badge>
          </div>
          <DialogTitle>A new Aletheia version is ready</DialogTitle>
          <DialogDescription>
            Update from {status?.currentVersion} to {status?.latestVersion}. The
            installer is downloaded from the official GitHub release, verified,
            installed, and then Aletheia restarts.
          </DialogDescription>
        </DialogHeader>

        {status?.releaseNotes ? (
          <Alert>
            <RefreshCwIcon />
            <AlertTitle>What changed</AlertTitle>
            <AlertDescription>{status.releaseNotes}</AlertDescription>
          </Alert>
        ) : null}

        {progress ? (
          <Progress value={updatePercent}>
            <ProgressLabel>{progressLabels[progress.state]}</ProgressLabel>
            <ProgressValue>
              {() =>
                progress.totalBytes
                  ? `${updatePercent.toFixed(0)}%`
                  : progress.state === "restarting"
                    ? "Ready"
                    : "Working"
              }
            </ProgressValue>
          </Progress>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Update failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <DialogClose
            disabled={installing}
            render={<Button variant="outline" />}
          >
            Later
          </DialogClose>
          <Button
            disabled={installing}
            onClick={() =>
              status ? void openReleasePage(status.releaseUrl) : undefined
            }
            variant="ghost"
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Release notes
          </Button>
          <Button disabled={installing} onClick={() => void install()}>
            {installing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            {installing ? "Updating…" : "Update and restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LatestChange() {
  const [isOpen, setIsOpen] = useState(true);
  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "group/latest-change relative flex min-h-27 flex-col gap-1 overflow-hidden border-t px-4 pt-3 pb-1 *:text-nowrap",
        "transition-opacity group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0",
      )}
    >
      <span className="font-mono text-[10px] text-muted-foreground">
        ENGINE READY
      </span>
      <p className="font-medium text-xs">Resumable indexing</p>
      <span className="text-[10px] text-muted-foreground">
        Import large sources safely.
      </span>
      <Button
        className="w-max px-0 text-xs"
        nativeButton={false}
        render={<a href="#/datasets" />}
        size="sm"
        variant="link"
      >
        Open datasets
      </Button>
      <Button
        aria-label="Dismiss status card"
        className="absolute top-2 right-2 size-6 rounded-full opacity-0 transition-opacity group-hover/latest-change:opacity-100"
        onClick={() => setIsOpen(false)}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </div>
  );
}

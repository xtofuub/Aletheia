import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";

export function PaginationControls({
  offset,
  limit,
  total,
  onOffsetChange,
  label = "results",
}: {
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  label?: string;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);

  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground tabular-nums">
        {start}–{end} of {total.toLocaleString()} · Page {page} of {pages}
      </p>
      <Pagination
        aria-label={`${label} pagination`}
        className="mx-0 w-auto justify-start sm:justify-end"
      >
        <PaginationContent>
          <PaginationItem>
            <Button
              aria-label={`Previous ${label} page`}
              disabled={offset === 0}
              onClick={() => onOffsetChange(Math.max(0, offset - limit))}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronLeftIcon />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              aria-label={`Next ${label} page`}
              disabled={offset + limit >= total}
              onClick={() => onOffsetChange(offset + limit)}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronRightIcon />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

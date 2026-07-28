import { type FormEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "./button";

interface PaginationControlsProps {
  label: string;
  offset: number;
  total: number;
  pageSize: number;
  onOffsetChange: (offset: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizes?: number[];
  busy?: boolean;
}

export function PaginationControls({
  label,
  offset,
  total,
  pageSize,
  onOffsetChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100, 200],
  busy = false,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(
    totalPages,
    Math.max(1, Math.floor(offset / pageSize) + 1),
  );
  function goToPage(page: number) {
    const safePage = Math.min(totalPages, Math.max(1, Math.floor(page)));
    onOffsetChange((safePage - 1) * pageSize);
  }

  function submitPage(event: FormEvent) {
    event.preventDefault();
    const page = Number(
      new FormData(event.currentTarget as HTMLFormElement).get("page"),
    );
    if (Number.isFinite(page)) goToPage(page);
  }

  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(total, offset + pageSize);

  return (
    <div className="table-pagination" aria-label={`${label} pagination`}>
      <span className="table-pagination__range font-mono">
        {start.toLocaleString()}-{end.toLocaleString()} of{" "}
        {total.toLocaleString()}
      </span>
      {onPageSizeChange ? (
        <label className="table-pagination__size">
          <span>Rows</span>
          <select
            aria-label={`${label} rows per page`}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="table-pagination__buttons">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`First ${label} page`}
          disabled={busy || currentPage === 1}
          onClick={() => goToPage(1)}
        >
          <ChevronsLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Previous ${label} page`}
          disabled={busy || currentPage === 1}
          onClick={() => goToPage(currentPage - 1)}
        >
          <ChevronLeft />
        </Button>
        <form className="table-pagination__jump" onSubmit={submitPage}>
          <span>Page</span>
          <input
            key={currentPage}
            name="page"
            aria-label={`${label} page number`}
            inputMode="numeric"
            min={1}
            max={totalPages}
            type="number"
            defaultValue={currentPage}
            onBlur={(event) => {
              event.currentTarget.value = String(currentPage);
            }}
          />
          <span>of {totalPages.toLocaleString()}</span>
        </form>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Next ${label} page`}
          disabled={busy || currentPage >= totalPages}
          onClick={() => goToPage(currentPage + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Last ${label} page`}
          disabled={busy || currentPage >= totalPages}
          onClick={() => goToPage(totalPages)}
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  );
}

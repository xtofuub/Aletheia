import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ChevronDownIcon,
  DatabaseIcon,
  FileSearchIcon,
  FolderOpenIcon,
  PauseIcon,
  PlayIcon,
  SaveIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SquareIcon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDirectSearchProgress } from "@/hooks/use-direct-search-progress";
import {
  cancelDirectSearch,
  exportRecords,
  listDatasets,
  pauseDirectSearch,
  resumeDirectSearch,
  saveSearch,
  searchRecords,
  selectDirectSearchSources,
  selectExportDestination,
  startDirectSearch,
  type FieldType,
  type SearchMode,
} from "@/lib/desktop";
import { formatBytes, formatDuration } from "@/lib/format";
import { formatSearchDisplay } from "@/lib/search-display";

const modeItems = [
  { label: "Contains", value: "contains" },
  { label: "Exact", value: "exact" },
  { label: "Prefix", value: "prefix" },
];
const fieldItems: Array<{ label: string; value: string }> = [
  { label: "Any safe field", value: "all" },
  { label: "Email", value: "email" },
  { label: "Domain", value: "domain" },
  { label: "URL", value: "url" },
  { label: "Username", value: "username" },
  { label: "First name", value: "first_name" },
  { label: "Last name", value: "last_name" },
  { label: "Full name", value: "full_name" },
  { label: "Phone", value: "phone" },
  { label: "IP address", value: "ip_address" },
  { label: "User ID", value: "user_id" },
];
const pageItems = [25, 50, 100, 200].map((value) => ({
  label: `${value} per page`,
  value: String(value),
}));
const workerItems = [
  { label: "1 worker · HDD", value: "1" },
  { label: "2 workers · SATA SSD", value: "2" },
  { label: "4 workers · NVMe", value: "4" },
  { label: "8 workers · fast NVMe", value: "8" },
];
const resultCapItems = [500, 2_000, 5_000].map((value) => ({
  label: `${value.toLocaleString()} matches`,
  value: String(value),
}));

function detectQueryKind(value: string) {
  const query = value.trim();
  if (!query) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) return "Email";
  if (/^(?:https?:\/\/|www\.)/i.test(query)) return "URL";
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(query)) return "IP address";
  if (/^\+?[\d\s().-]{7,}$/.test(query)) return "Phone";
  if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(query)) {
    return "Domain";
  }
  if (/^@[a-z0-9_.-]+$/i.test(query)) return "Username";
  if (/^[\p{L}']+(?:[ -][\p{L}']+){1,3}$/u.test(query)) return "Name";
  return "Text";
}

function parseDirectQueries(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((query) => query.trim())
        .filter(Boolean),
    ),
  ];
}

export function SearchPage({
  initialQuery = "",
  initialDatasetId = "all",
  initialSurface = "index",
}: {
  initialQuery?: string;
  initialDatasetId?: string;
  initialSurface?: "index" | "direct";
}) {
  const [surface, setSurface] = useState<"index" | "direct">(initialSurface);
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>("contains");
  const [field, setField] = useState("all");
  const [datasetId, setDatasetId] = useState(initialDatasetId);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState("");
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [directQuery, setDirectQuery] = useState("");
  const [directMode, setDirectMode] = useState<SearchMode>("contains");
  const [includeArchives, setIncludeArchives] = useState(true);
  const [directWorkerLimit, setDirectWorkerLimit] = useState(1);
  const [directMaxResults, setDirectMaxResults] = useState(2_000);
  const [directOffset, setDirectOffset] = useState(0);
  const [directError, setDirectError] = useState("");
  const { begin: beginDirectSearch, progress: directProgress } =
    useDirectSearchProgress();
  const queryClient = useQueryClient();

  const datasets = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const indexed = useQuery({
    queryKey: ["search", submittedQuery, mode, field, datasetId, offset, limit],
    queryFn: () =>
      searchRecords({
        query: submittedQuery,
        mode,
        datasetId: datasetId === "all" ? null : datasetId,
        fieldType: field === "all" ? null : (field as FieldType),
        offset,
        limit,
      }),
    enabled: submittedQuery.trim().length > 0,
  });

  const directSearch = useMutation({
    mutationFn: () =>
      startDirectSearch({
        paths: sourcePaths,
        query: directQuery.trim(),
        mode: directMode,
        caseSensitive: false,
        includeArchives,
        maxResults: directMaxResults,
        workerLimit: directWorkerLimit,
      }),
    onSuccess: (start) => {
      setDirectError("");
      beginDirectSearch(start);
    },
    onError: (error) => setDirectError(String(error)),
  });

  const datasetItems = useMemo(
    () => [
      { label: "All datasets", value: "all" },
      ...(datasets.data ?? []).map((dataset) => ({
        label: dataset.name,
        value: dataset.id,
      })),
    ],
    [datasets.data],
  );

  function submitSearch() {
    const value = query.trim();
    if (!value) return;
    setOffset(0);
    setSelected(new Set());
    setSubmittedQuery(value);
  }

  async function exportSelected() {
    if (!selected.size) return;
    const destinationPath = await selectExportDestination("csv");
    if (!destinationPath) return;
    const result = await exportRecords({
      destinationPath,
      format: "csv",
      recordIds: [...selected],
      maskEmailLocalPart: true,
    });
    setNotice(`Exported ${result.recordCount} records.`);
    await queryClient.invalidateQueries({ queryKey: ["exports"] });
  }

  const hits = indexed.data?.hits ?? [];
  const allVisibleSelected =
    hits.length > 0 && hits.every((hit) => selected.has(hit.recordId));
  const directPercent = directProgress?.totalBytes
    ? Math.min(
        100,
        (directProgress.sourceBytesScanned / directProgress.totalBytes) * 100,
      )
    : 0;
  const visibleDirectHits = (directProgress?.hits ?? []).slice(
    directOffset,
    directOffset + limit,
  );
  const indexedQueryKind = detectQueryKind(query);
  const directQueries = parseDirectQueries(directQuery);
  const directQueryKind =
    directQueries.length > 1
      ? "Batch"
      : detectQueryKind(directQueries[0] ?? "");

  return (
    <div>
      <PageHeader
        description="Choose fast indexed lookup or a one-time scan of local files and archives."
        title="Search"
      />
      <Tabs
        onValueChange={(value) => setSurface(value as "index" | "direct")}
        value={surface}
      >
        <TabsList className="grid h-auto w-full grid-cols-1 gap-px rounded-none bg-border p-px group-data-horizontal/tabs:h-auto sm:grid-cols-2">
          <TabsTrigger
            className="h-auto min-w-0 items-start justify-start rounded-none bg-background p-4 text-left whitespace-normal data-active:bg-card"
            value="index"
          >
            <DatabaseIcon />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <span>Indexed search</span>
              <span className="text-xs font-normal text-muted-foreground">
                Repeated lookup across smaller datasets you added.
              </span>
            </span>
            <Badge variant="outline">Fast</Badge>
          </TabsTrigger>
          <TabsTrigger
            className="h-auto min-w-0 items-start justify-start rounded-none bg-background p-4 text-left whitespace-normal data-active:bg-card"
            value="direct"
          >
            <FileSearchIcon />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <span>Live scan for large files</span>
              <span className="text-xs font-normal text-muted-foreground">
                Search TXT, ZIP, RAR, and GZIP without indexing first.
              </span>
            </span>
            <Badge>Recommended for huge files</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="index">
          <div className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-4">
            <DashboardCard className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Indexed search</CardTitle>
                <CardDescription>
                  Searches the persistent local index. Best for repeated lookup.
                </CardDescription>
                <CardAction>
                  <Badge variant="outline">Fast repeat lookup</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitSearch();
                  }}
                >
                  <InputGroup>
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      aria-label="Search query"
                      autoFocus
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitSearch();
                        }
                      }}
                      placeholder="Name, email, domain, username, phone, IP, or URL"
                      value={query}
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        disabled={indexed.isFetching}
                        size="sm"
                        type="submit"
                      >
                        {indexed.isFetching ? (
                          <Spinner data-icon="inline-start" />
                        ) : null}
                        {indexed.isFetching ? "Searching…" : "Search"}
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                  <div className="flex flex-wrap gap-2">
                    <Select
                      items={modeItems}
                      onValueChange={(value) => setMode(value as SearchMode)}
                      value={mode}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {modeItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Select
                      items={fieldItems}
                      onValueChange={(value) => setField(String(value))}
                      value={field}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {fieldItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Select
                      items={datasetItems}
                      onValueChange={(value) => setDatasetId(String(value))}
                      value={datasetId}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {datasetItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Select
                      items={pageItems}
                      onValueChange={(value) => {
                        setLimit(Number(value));
                        setOffset(0);
                      }}
                      value={String(limit)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {pageItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  {indexedQueryKind ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        Detected: {indexedQueryKind}
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        Any safe field is enough. Narrow the field only when you
                        need fewer matches.
                      </p>
                    </div>
                  ) : null}
                </form>
              </CardContent>
            </DashboardCard>

            <DashboardCard className="gap-0 lg:col-span-4">
              <CardHeader className="border-b">
                <CardTitle>Results</CardTitle>
                <CardDescription>
                  {indexed.data
                    ? `${indexed.data.total.toLocaleString()} matches`
                    : "Search to load local evidence."}
                </CardDescription>
                {indexed.isFetching ? (
                  <CardAction>
                    <Badge variant="outline">
                      <Spinner />
                      Searching local index
                    </Badge>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="px-0">
                {hits.length ? (
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 ps-4">
                          <Checkbox
                            aria-label="Select visible results"
                            checked={allVisibleSelected}
                            onCheckedChange={(checked) => {
                              setSelected((current) => {
                                const next = new Set(current);
                                hits.forEach((hit) =>
                                  checked
                                    ? next.add(hit.recordId)
                                    : next.delete(hit.recordId),
                                );
                                return next;
                              });
                            }}
                          />
                        </TableHead>
                        <TableHead className="w-5/12">Evidence</TableHead>
                        <TableHead className="w-1/6">Dataset</TableHead>
                        <TableHead className="w-1/4">Source</TableHead>
                        <TableHead className="pe-4">Match</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hits.map((hit) => (
                        <TableRow key={hit.recordId}>
                          <TableCell className="ps-4">
                            <Checkbox
                              aria-label={`Select ${hit.recordId}`}
                              checked={selected.has(hit.recordId)}
                              onCheckedChange={(checked) =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(hit.recordId);
                                  else next.delete(hit.recordId);
                                  return next;
                                })
                              }
                            />
                          </TableCell>
                          <TableCell className="min-w-0 whitespace-normal">
                            <div className="flex flex-wrap gap-1">
                              {hit.fields.slice(0, 6).map((item) => (
                                <Badge
                                  className="h-auto max-w-full min-w-0 whitespace-normal"
                                  data-slot="search-field-value"
                                  key={`${hit.recordId}-${item.name}`}
                                  variant={
                                    item.sensitive ? "secondary" : "outline"
                                  }
                                >
                                  <span className="shrink-0">{item.name}:</span>
                                  <span className="min-w-0 break-all text-left">
                                    {formatSearchDisplay(item.displayValue)}
                                  </span>
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-0 whitespace-normal">
                            <p className="break-all">{hit.datasetName}</p>
                          </TableCell>
                          <TableCell className="min-w-0 whitespace-normal">
                            <p className="break-all text-xs">
                              {hit.sourceFile}
                            </p>
                            <p className="break-all font-mono text-xs text-muted-foreground">
                              {hit.sourceLocation}
                            </p>
                          </TableCell>
                          <TableCell className="pe-4 text-xs break-words whitespace-normal text-muted-foreground">
                            {hit.matchReason}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty className="min-h-72 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        {indexed.isFetching ? <Spinner /> : <SearchIcon />}
                      </EmptyMedia>
                      <EmptyTitle>
                        {indexed.isFetching
                          ? "Searching"
                          : submittedQuery
                            ? "No matches"
                            : "Search the index"}
                      </EmptyTitle>
                      <EmptyDescription>
                        Enter a value to search the local index.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
              {indexed.data ? (
                <PaginationControls
                  label="search results"
                  limit={limit}
                  offset={offset}
                  onOffsetChange={setOffset}
                  total={indexed.data.total}
                />
              ) : null}
              <CardFooter className="justify-between gap-2 rounded-none bg-background">
                <p className="text-xs text-muted-foreground">
                  {notice || `${selected.size} selected`}
                </p>
                <div className="flex gap-2">
                  <Dialog>
                    <DialogTrigger
                      render={
                        <Button
                          disabled={!submittedQuery}
                          size="sm"
                          variant="outline"
                        />
                      }
                    >
                      <SaveIcon data-icon="inline-start" />
                      Save view
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Save search view</DialogTitle>
                        <DialogDescription>
                          Store this query and its current filters locally.
                        </DialogDescription>
                      </DialogHeader>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="saved-search-name">
                            Name
                          </FieldLabel>
                          <Input
                            id="saved-search-name"
                            onChange={(event) =>
                              setSaveName(event.target.value)
                            }
                            value={saveName}
                          />
                        </Field>
                      </FieldGroup>
                      <DialogFooter>
                        <Button
                          disabled={!saveName.trim()}
                          onClick={() =>
                            void saveSearch(
                              saveName.trim(),
                              submittedQuery,
                              JSON.stringify({ mode, field, datasetId }),
                            ).then(() => {
                              setNotice("Saved view created.");
                              setSaveName("");
                              void queryClient.invalidateQueries({
                                queryKey: ["saved-searches"],
                              });
                            })
                          }
                        >
                          Save
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button
                    disabled={!selected.size}
                    onClick={() => void exportSelected()}
                    size="sm"
                  >
                    Export selected
                  </Button>
                </div>
              </CardFooter>
            </DashboardCard>
          </div>
        </TabsContent>

        <TabsContent value="direct">
          <div className="flex flex-col gap-px bg-border p-px">
            <DashboardCard className="gap-0">
              <CardHeader className="border-b">
                <CardTitle>Direct file scan</CardTitle>
                <CardDescription>
                  Stream files and compressed archives without adding a dataset
                  or extracting them to disk.
                </CardDescription>
                <CardAction>
                  <Badge variant="outline">
                    {directProgress?.status === "paused"
                      ? `Paused at ${directPercent.toFixed(0)}%`
                      : directProgress?.status === "running"
                        ? `${directPercent.toFixed(0)}% scanned`
                        : "No index created"}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                <div className="flex flex-col gap-3 bg-background p-4">
                  <FieldGroup>
                    <Field>
                      <FieldLabel>1. Choose files or a folder</FieldLabel>
                      <div className="min-h-24 border bg-card p-3">
                        {sourcePaths.length ? (
                          <div className="flex flex-col gap-2">
                            {sourcePaths.map((path) => (
                              <div
                                className="flex items-center gap-2"
                                key={path}
                              >
                                <FileSearchIcon />
                                <span className="min-w-0 truncate font-mono text-xs">
                                  {path}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex min-h-16 items-center justify-center text-xs text-muted-foreground">
                            Choose files or a folder to define the scan scope.
                          </div>
                        )}
                      </div>
                    </Field>
                  </FieldGroup>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        void selectDirectSearchSources("files").then(
                          setSourcePaths,
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      <ArchiveIcon data-icon="inline-start" />
                      Choose files
                    </Button>
                    <Button
                      onClick={() =>
                        void selectDirectSearchSources("folder").then(
                          setSourcePaths,
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      <FolderOpenIcon data-icon="inline-start" />
                      Choose folder
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-4 bg-background p-4">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="direct-scan-query">
                        2. Enter values
                      </FieldLabel>
                      <InputGroup>
                        <InputGroupTextarea
                          aria-label="Direct scan query"
                          id="direct-scan-query"
                          onChange={(event) =>
                            setDirectQuery(event.target.value)
                          }
                          placeholder="One value, or paste up to 512 values with one per line"
                          rows={3}
                          value={directQuery}
                        />
                        <InputGroupAddon align="block-end" className="border-t">
                          <SearchIcon />
                          <InputGroupText>
                            {directQueries.length || 0}{" "}
                            {directQueries.length === 1 ? "value" : "values"}
                          </InputGroupText>
                          <Select
                            items={modeItems}
                            onValueChange={(value) =>
                              setDirectMode(value as SearchMode)
                            }
                            value={directMode}
                          >
                            <SelectTrigger size="sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {modeItems.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </InputGroupAddon>
                      </InputGroup>
                    </Field>
                  </FieldGroup>
                  {directQueryKind ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        Detected: {directQueryKind}
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        {directQueryKind === "Batch"
                          ? "Every value is matched in one pass, avoiding repeated scans of the same huge source."
                          : directQueryKind === "Name"
                            ? "All name tokens can match across columns or email separators."
                            : "Contains matching works best for unknown source formats."}
                      </p>
                    </div>
                  ) : null}
                  {directError ? (
                    <Alert variant="destructive">
                      <AlertTitle>Scan could not start</AlertTitle>
                      <AlertDescription>{directError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Collapsible>
                    <CollapsibleTrigger
                      render={<Button size="sm" variant="ghost" />}
                    >
                      <SlidersHorizontalIcon data-icon="inline-start" />
                      Scan options
                      <ChevronDownIcon data-icon="inline-end" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3">
                      <FieldGroup>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>Include archive entries</FieldTitle>
                            <FieldDescription>
                              Stream ZIP, RAR, and GZIP content without
                              extracting it to disk.
                            </FieldDescription>
                          </FieldContent>
                          <Switch
                            checked={includeArchives}
                            onCheckedChange={setIncludeArchives}
                          />
                        </Field>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>Worker limit</FieldTitle>
                            <FieldDescription>
                              Use one worker for a physical HDD. Extra workers
                              can cause slower random seeking.
                            </FieldDescription>
                          </FieldContent>
                          <Select
                            items={workerItems}
                            onValueChange={(value) =>
                              setDirectWorkerLimit(Number(value))
                            }
                            value={String(directWorkerLimit)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {workerItems.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>Result cap</FieldTitle>
                            <FieldDescription>
                              Stop collecting rows after this many matches.
                            </FieldDescription>
                          </FieldContent>
                          <Select
                            items={resultCapItems}
                            onValueChange={(value) =>
                              setDirectMaxResults(Number(value))
                            }
                            value={String(directMaxResults)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {resultCapItems.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      </FieldGroup>
                    </CollapsibleContent>
                  </Collapsible>
                  {directProgress ? (
                    <Progress value={directPercent}>
                      <ProgressLabel className="flex items-center gap-2">
                        {directProgress.status === "running" ? (
                          <Spinner />
                        ) : null}
                        {directProgress.message}
                      </ProgressLabel>
                      <ProgressValue>
                        {() => `${directPercent.toFixed(0)}%`}
                      </ProgressValue>
                    </Progress>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    {directProgress?.status === "running" ? (
                      <Button
                        onClick={() =>
                          void pauseDirectSearch(directProgress.jobId)
                        }
                        size="sm"
                        variant="outline"
                      >
                        <PauseIcon data-icon="inline-start" />
                        Pause
                      </Button>
                    ) : null}
                    {directProgress?.status === "paused" ? (
                      <Button
                        onClick={() =>
                          void resumeDirectSearch(directProgress.jobId)
                        }
                        size="sm"
                        variant="outline"
                      >
                        <PlayIcon data-icon="inline-start" />
                        Resume
                      </Button>
                    ) : null}
                    {directProgress &&
                    ["running", "paused"].includes(directProgress.status) ? (
                      <Button
                        onClick={() =>
                          void cancelDirectSearch(directProgress.jobId)
                        }
                        size="sm"
                        variant="outline"
                      >
                        <SquareIcon data-icon="inline-start" />
                        Cancel
                      </Button>
                    ) : null}
                    <Button
                      disabled={
                        !sourcePaths.length ||
                        !directQuery.trim() ||
                        ["running", "paused"].includes(
                          directProgress?.status ?? "",
                        ) ||
                        directSearch.isPending
                      }
                      onClick={() => {
                        setDirectOffset(0);
                        directSearch.mutate();
                      }}
                      size="sm"
                    >
                      {directSearch.isPending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <SearchIcon data-icon="inline-start" />
                      )}
                      {directSearch.isPending ? "Starting…" : "Start scan"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </DashboardCard>

            <div className="grid grid-cols-2 gap-px sm:grid-cols-3 xl:grid-cols-6">
              {[
                [
                  "Source progress",
                  `${formatBytes(directProgress?.sourceBytesScanned ?? 0)} / ${formatBytes(directProgress?.totalBytes ?? 0)}`,
                ],
                [
                  "Decoded content",
                  formatBytes(directProgress?.contentBytesScanned ?? 0),
                ],
                [
                  "Throughput",
                  `${formatBytes(directProgress?.bytesPerSecond ?? 0)}/s`,
                ],
                [
                  "Time remaining",
                  directProgress?.status === "completed"
                    ? "Done"
                    : formatDuration(
                        directProgress?.estimatedRemainingMs ?? null,
                      ),
                ],
                [
                  "Files visited",
                  `${directProgress?.filesScanned ?? 0} / ${directProgress?.sourceCount ?? 0}`,
                ],
                ["Matches", String(directProgress?.matches ?? 0)],
              ].map(([label, value]) => (
                <DashboardCard key={label}>
                  <CardHeader>
                    <CardDescription>{label}</CardDescription>
                    <CardTitle className="font-mono text-xl tabular-nums">
                      {value}
                    </CardTitle>
                  </CardHeader>
                </DashboardCard>
              ))}
            </div>

            <DashboardCard className="gap-0">
              <CardHeader className="border-b">
                <CardTitle>Direct scan results</CardTitle>
                <CardDescription>
                  Matching source lines and archive entries. Nothing is added to
                  the permanent index.
                </CardDescription>
                <CardAction>
                  <Badge variant="outline">
                    {directProgress?.hits.length ?? 0} shown
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="px-0">
                {visibleDirectHits.length ? (
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-1/4 ps-6">Source</TableHead>
                        <TableHead className="w-1/6">Location</TableHead>
                        <TableHead className="w-5/12">Excerpt</TableHead>
                        <TableHead className="pe-6">Match</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleDirectHits.map((hit) => (
                        <TableRow key={hit.id}>
                          <TableCell className="min-w-0 ps-6 whitespace-normal">
                            <p className="break-all">
                              {hit.archiveEntry ?? hit.sourceFile}
                            </p>
                            {hit.archiveEntry ? (
                              <p className="break-all text-xs text-muted-foreground">
                                {hit.sourceFile}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-xs break-all whitespace-normal">
                            {hit.sourceLocation}
                          </TableCell>
                          <TableCell className="font-mono text-xs break-all whitespace-pre-wrap">
                            {formatSearchDisplay(hit.excerpt)}
                          </TableCell>
                          <TableCell className="pe-6 text-xs whitespace-normal text-muted-foreground">
                            <p className="break-all font-mono text-foreground">
                              {hit.matchedQuery}
                            </p>
                            <p className="break-words">{hit.matchReason}</p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty className="min-h-56 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FileSearchIcon />
                      </EmptyMedia>
                      <EmptyTitle>No direct scan results</EmptyTitle>
                      <EmptyDescription>
                        Choose a source, enter a value, then start the scan.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
              {directProgress?.hits.length ? (
                <PaginationControls
                  label="direct scan results"
                  limit={limit}
                  offset={directOffset}
                  onOffsetChange={setDirectOffset}
                  total={directProgress.hits.length}
                />
              ) : null}
            </DashboardCard>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

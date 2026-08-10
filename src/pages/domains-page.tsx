import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertCircleIcon,
  Globe2Icon,
  LoaderCircleIcon,
  SearchIcon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDomainDetails, listDomains, rebuildDomains } from "@/lib/desktop";
import { formatCount } from "@/lib/format";

const pageSize = 25;

export function DomainsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [hostname, setHostname] = useState<string | null>(null);
  const [hostnameQuery, setHostnameQuery] = useState("");
  const [datasetId, setDatasetId] = useState("all");
  const [recordOffset, setRecordOffset] = useState(0);
  const [repairNotice, setRepairNotice] = useState("");

  const domainRepair = useMutation({
    mutationFn: rebuildDomains,
    onSuccess: async (count) => {
      setRepairNotice(`${formatCount(count)} domain groups linked`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["domains"] }),
        queryClient.invalidateQueries({ queryKey: ["domain-details"] }),
      ]);
    },
    onError: (error) =>
      setRepairNotice(`Domain rebuild failed: ${String(error)}`),
  });

  const domains = useQuery({
    queryKey: ["domains", submittedQuery, offset],
    queryFn: () => listDomains(submittedQuery, offset, pageSize),
    placeholderData: keepPreviousData,
  });

  const activeDomain =
    selectedDomain ?? domains.data?.groups[0]?.registrableDomain ?? null;

  const details = useQuery({
    queryKey: [
      "domain-details",
      activeDomain,
      hostname,
      hostnameQuery,
      datasetId,
      recordOffset,
    ],
    queryFn: () =>
      getDomainDetails(
        activeDomain ?? "",
        hostname,
        hostnameQuery || null,
        datasetId === "all" ? null : datasetId,
        recordOffset,
        pageSize,
      ),
    enabled: Boolean(activeDomain),
    placeholderData: keepPreviousData,
  });

  const datasetItems = [
    { label: "All linked datasets", value: "all" },
    ...(details.data?.breaches ?? []).map((breach) => ({
      label: `${breach.datasetName} (${breach.recordCount})`,
      value: breach.datasetId,
    })),
  ];

  return (
    <div>
      <PageHeader
        actions={
          <Button
            disabled={domainRepair.isPending}
            onClick={() => domainRepair.mutate()}
            size="sm"
            variant="outline"
          >
            {domainRepair.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            {domainRepair.isPending ? "Rebuilding links…" : "Rebuild links"}
          </Button>
        }
        description="Find a domain, filter its subdomains, and inspect every linked source line."
        title="Domains"
      />
      {repairNotice ? (
        <p className="mb-3 text-xs text-muted-foreground" role="status">
          {repairNotice}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-px bg-border p-px xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <DashboardCard className="min-w-0 gap-0">
          <CardHeader className="border-b">
            <CardTitle>Domain groups</CardTitle>
            <CardDescription>
              {domains.data?.total ?? 0} parent domains
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setOffset(0);
                setSelectedDomain(null);
                setSubmittedQuery(query.trim());
              }}
            >
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search domains"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search domains"
                  value={query}
                />
              </InputGroup>
            </form>
            <div className="flex flex-col gap-1">
              {(domains.data?.groups ?? []).map((group) => (
                <Button
                  className="h-auto w-full justify-between px-3 py-2"
                  key={group.registrableDomain}
                  onClick={() => {
                    const reloadActiveDomain =
                      activeDomain === group.registrableDomain;
                    setSelectedDomain(group.registrableDomain);
                    setHostname(null);
                    setDatasetId("all");
                    setRecordOffset(0);
                    if (reloadActiveDomain) void details.refetch();
                  }}
                  variant={
                    activeDomain === group.registrableDomain
                      ? "secondary"
                      : "ghost"
                  }
                >
                  <span className="truncate">{group.registrableDomain}</span>
                  <Badge variant="outline">
                    {formatCount(group.recordCount)}
                  </Badge>
                </Button>
              ))}
            </div>
          </CardContent>
          {domains.data ? (
            <PaginationControls
              label="domain groups"
              limit={pageSize}
              offset={offset}
              onOffsetChange={setOffset}
              total={domains.data.total}
            />
          ) : null}
        </DashboardCard>

        <DashboardCard className="min-w-0 gap-0">
          <CardHeader className="border-b">
            <CardTitle>{activeDomain ?? "Domain evidence"}</CardTitle>
            <CardDescription>
              {details.isPending
                ? "Loading linked records…"
                : details.isError
                  ? "Linked records could not be loaded."
                  : details.data
                    ? `${details.data.totalRecords.toLocaleString()} linked records`
                    : "Select a domain group."}
            </CardDescription>
          </CardHeader>
          {activeDomain ? (
            <>
              <CardContent className="flex flex-col gap-4 border-b p-4">
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Subdomains
                  </p>
                  <InputGroup>
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      aria-label="Filter subdomains"
                      onChange={(event) => {
                        setHostnameQuery(event.target.value);
                        setHostname(null);
                        setRecordOffset(0);
                      }}
                      placeholder="Filter hostnames"
                      value={hostnameQuery}
                    />
                  </InputGroup>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        setHostname(null);
                        setRecordOffset(0);
                      }}
                      size="sm"
                      variant={hostname === null ? "secondary" : "outline"}
                    >
                      All hosts
                    </Button>
                    {(details.data?.hostnames ?? []).map((item) => (
                      <Button
                        key={item.id}
                        onClick={() => {
                          setHostname(item.hostname);
                          setRecordOffset(0);
                        }}
                        size="sm"
                        variant={
                          hostname === item.hostname ? "secondary" : "outline"
                        }
                      >
                        {item.hostname}
                        <Badge variant="outline">{item.recordCount}</Badge>
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {(details.data?.breaches ?? []).map((breach) => (
                      <Badge key={breach.datasetId} variant="outline">
                        {breach.datasetName} · {breach.recordCount}
                      </Badge>
                    ))}
                  </div>
                  <Select
                    items={datasetItems}
                    onValueChange={(value) => {
                      setDatasetId(String(value));
                      setRecordOffset(0);
                    }}
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
                </div>
              </CardContent>
              <CardContent className="px-0">
                {details.isPending ? (
                  <Empty className="min-h-64 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <LoaderCircleIcon className="animate-spin" />
                      </EmptyMedia>
                      <EmptyTitle>Loading linked lines</EmptyTitle>
                      <EmptyDescription>
                        Reading the selected domain from the local index.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : details.isError ? (
                  <Empty className="min-h-64 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <AlertCircleIcon />
                      </EmptyMedia>
                      <EmptyTitle>Could not load linked lines</EmptyTitle>
                      <EmptyDescription>
                        {String(details.error)}
                      </EmptyDescription>
                      <Button
                        onClick={() => void details.refetch()}
                        size="sm"
                        variant="outline"
                      >
                        Try again
                      </Button>
                    </EmptyHeader>
                  </Empty>
                ) : details.data?.records.length ? (
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-48 ps-6">Source line</TableHead>
                        <TableHead className="hidden w-44 2xl:table-cell">
                          Dataset
                        </TableHead>
                        <TableHead>Line contents</TableHead>
                        <TableHead className="hidden w-44 pe-6 2xl:table-cell">
                          Parser
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.data.records.map((record) => (
                        <TableRow key={record.recordId}>
                          <TableCell className="min-w-0 ps-6">
                            <p className="truncate text-xs">
                              {record.sourceFile}
                            </p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {record.sourceLocation}
                            </p>
                            <div className="mt-1 min-w-0 2xl:hidden">
                              <p
                                className="truncate text-xs text-muted-foreground"
                                title={record.datasetName}
                              >
                                {record.datasetName}
                              </p>
                              <p
                                className="truncate font-mono text-[11px] text-muted-foreground"
                                title={record.parser}
                              >
                                {record.parser}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="hidden min-w-0 2xl:table-cell">
                            <p className="truncate" title={record.datasetName}>
                              {record.datasetName}
                            </p>
                          </TableCell>
                          <TableCell className="min-w-0 whitespace-normal">
                            <div className="flex min-w-0 max-w-full flex-wrap gap-1">
                              {record.fields.map((field) => (
                                <Badge
                                  className="h-auto max-w-full min-w-0 whitespace-normal py-1 text-left leading-snug [overflow-wrap:anywhere]"
                                  key={`${record.recordId}-${field.name}`}
                                  title={`${field.name}: ${field.displayValue}`}
                                  variant={
                                    field.sensitive ? "secondary" : "outline"
                                  }
                                >
                                  {field.name}: {field.displayValue}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="hidden min-w-0 pe-6 font-mono text-xs text-muted-foreground 2xl:table-cell">
                            <p className="truncate" title={record.parser}>
                              {record.parser}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty className="min-h-64 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Globe2Icon />
                      </EmptyMedia>
                      <EmptyTitle>No linked lines</EmptyTitle>
                      <EmptyDescription>
                        Adjust the hostname or dataset filter.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
              {details.data ? (
                <PaginationControls
                  label="domain evidence"
                  limit={pageSize}
                  offset={recordOffset}
                  onOffsetChange={setRecordOffset}
                  total={details.data.totalRecords}
                />
              ) : null}
            </>
          ) : (
            <Empty className="min-h-96 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Globe2Icon />
                </EmptyMedia>
                <EmptyTitle>Select a domain</EmptyTitle>
                <EmptyDescription>Linked evidence loads here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  FingerprintIcon,
  LinkIcon,
  ListChecksIcon,
  RefreshCwIcon,
  SearchIcon,
  UserRoundCheckIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  applyIdentityAction,
  createManualIdentity,
  listIdentities,
  listIdentityMembers,
  rebuildIdentities,
  searchIdentityRecords,
} from "@/lib/desktop";
import { formatCount } from "@/lib/format";

const memberLimit = 25;

export function IdentitiesPage() {
  const queryClient = useQueryClient();
  const automaticRebuildStarted = useRef(false);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [identityFilter, setIdentityFilter] = useState("");
  const [memberOffset, setMemberOffset] = useState(0);
  const [manualQuery, setManualQuery] = useState("");
  const [submittedManualQuery, setSubmittedManualQuery] = useState("");
  const [manualOffset, setManualOffset] = useState(0);
  const [manualName, setManualName] = useState("");
  const [manualSelection, setManualSelection] = useState<Set<string>>(
    new Set(),
  );
  const [notice, setNotice] = useState("");

  const identities = useQuery({
    queryKey: ["identities"],
    queryFn: listIdentities,
  });
  const identityList = useMemo(() => identities.data ?? [], [identities.data]);
  const filteredIdentities = useMemo(() => {
    const needle = identityFilter.trim().toLowerCase();
    if (!needle) return identityList;
    return identityList.filter((identity) =>
      [
        identity.displayLabel,
        identity.linkType,
        identity.userStatus,
        identity.confidenceLevel,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [identityFilter, identityList]);
  const activeIdentity = selectedIdentity ?? identityList[0]?.id ?? null;

  const members = useQuery({
    queryKey: ["identity-members", activeIdentity, memberOffset],
    queryFn: () =>
      listIdentityMembers(
        activeIdentity ?? "",
        memberOffset,
        memberLimit,
        true,
      ),
    enabled: Boolean(activeIdentity),
  });

  const manualResults = useQuery({
    queryKey: ["identity-builder-search", submittedManualQuery, manualOffset],
    queryFn: () =>
      searchIdentityRecords({
        query: submittedManualQuery,
        mode: "contains",
        datasetId: null,
        fieldType: null,
        offset: manualOffset,
        limit: memberLimit,
      }),
    enabled: Boolean(submittedManualQuery),
  });

  const rebuild = useMutation({
    mutationFn: rebuildIdentities,
    onSuccess: async (count) => {
      setNotice(`Rebuilt ${formatCount(count)} automatic groups`);
      await queryClient.invalidateQueries({ queryKey: ["identities"] });
    },
    onError: (error) => setNotice(`Identity analysis failed: ${String(error)}`),
  });
  const create = useMutation({
    mutationFn: () =>
      createManualIdentity({
        name: manualName.trim(),
        recordIds: [...manualSelection],
      }),
    onSuccess: async (id) => {
      setNotice("Manual identity created");
      setManualName("");
      setManualSelection(new Set());
      setSelectedIdentity(id);
      await queryClient.invalidateQueries({ queryKey: ["identities"] });
    },
  });

  const rebuildGroups = rebuild.mutate;
  useEffect(() => {
    if (
      !identities.isSuccess ||
      identityList.length > 0 ||
      automaticRebuildStarted.current
    ) {
      return;
    }
    automaticRebuildStarted.current = true;
    rebuildGroups();
  }, [identities.isSuccess, identityList.length, rebuildGroups]);

  const selectedSummary = identityList.find(
    (item) => item.id === activeIdentity,
  );
  const totalMembers = identityList.reduce(
    (total, identity) => total + identity.memberCount,
    0,
  );
  const confirmedCount = identityList.filter(
    (identity) => identity.userStatus === "confirmed",
  ).length;
  const reviewCount = identityList.filter(
    (identity) => identity.userStatus !== "confirmed",
  ).length;
  const identityStats: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
  }> = [
    {
      label: "Groups",
      value: formatCount(identityList.length),
      icon: FingerprintIcon,
    },
    {
      label: "Linked records",
      value: formatCount(totalMembers),
      icon: LinkIcon,
    },
    {
      label: "Confirmed",
      value: formatCount(confirmedCount),
      icon: UserRoundCheckIcon,
    },
    {
      label: "Needs review",
      value: formatCount(reviewCount),
      icon: ListChecksIcon,
    },
  ];

  async function applyAction(action: "confirm" | "reject") {
    if (!selectedSummary) return;
    await applyIdentityAction({
      action,
      groupId: selectedSummary.id,
      recordIds: [],
      targetGroupId: null,
    });
    setNotice(
      action === "confirm" ? "Identity confirmed" : "Identity rejected",
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["identities"] }),
      queryClient.invalidateQueries({
        queryKey: ["identity-members", selectedSummary.id],
      }),
    ]);
  }

  return (
    <div>
      <PageHeader
        actions={
          <Button
            disabled={rebuild.isPending}
            onClick={() => rebuild.mutate()}
            size="sm"
            variant="outline"
          >
            {rebuild.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {rebuild.isPending ? "Analyzing…" : "Rebuild groups"}
          </Button>
        }
        description="Review automatic groups or create an identity from selected evidence."
        title="Identities"
      />

      <Tabs defaultValue="groups">
        <TabsList variant="line">
          <TabsTrigger value="groups">Collection</TabsTrigger>
          <TabsTrigger value="builder">Build identity</TabsTrigger>
        </TabsList>

        <TabsContent value="groups">
          <div className="grid grid-cols-2 gap-px bg-border p-px lg:grid-cols-4">
            {identityStats.map(({ icon: Icon, label, value }) => (
              <DashboardCard key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="font-mono text-2xl tabular-nums">
                    {value}
                  </CardTitle>
                  <CardAction>
                    <Icon />
                  </CardAction>
                </CardHeader>
              </DashboardCard>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-[19rem_1fr]">
            <DashboardCard className="gap-0">
              <CardHeader className="border-b">
                <CardTitle>Identity collection</CardTitle>
                <CardDescription>
                  {formatCount(filteredIdentities.length)} visible groups
                </CardDescription>
              </CardHeader>
              <CardContent className="border-b p-3">
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Filter identities"
                    onChange={(event) => setIdentityFilter(event.target.value)}
                    placeholder="Filter groups"
                    value={identityFilter}
                  />
                </InputGroup>
              </CardContent>
              <CardContent className="px-0">
                {filteredIdentities.length ? (
                  <ScrollArea className="h-[31rem]">
                    <div className="flex flex-col">
                      {filteredIdentities.map((identity) => (
                        <Button
                          className="h-auto w-full justify-start rounded-none px-4 py-3"
                          key={identity.id}
                          onClick={() => {
                            setSelectedIdentity(identity.id);
                            setMemberOffset(0);
                          }}
                          variant={
                            identity.id === activeIdentity
                              ? "secondary"
                              : "ghost"
                          }
                        >
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block truncate font-medium">
                              {identity.displayLabel}
                            </span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">
                              {identity.linkType.replaceAll("_", " ")} ·{" "}
                              {formatCount(identity.memberCount)} records
                            </span>
                          </span>
                          <Badge variant="outline">{identity.userStatus}</Badge>
                        </Button>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <Empty className="min-h-72 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FingerprintIcon />
                      </EmptyMedia>
                      <EmptyTitle>No matching groups</EmptyTitle>
                      <EmptyDescription>
                        Rebuild automatic groups or change the filter.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </DashboardCard>

            {selectedSummary ? (
              <DashboardCard className="gap-0">
                <CardHeader className="border-b">
                  <CardTitle>{selectedSummary.displayLabel}</CardTitle>
                  <CardDescription>
                    {selectedSummary.explanation.replaceAll("_", " ")}
                  </CardDescription>
                  <CardAction>
                    <div className="flex gap-2">
                      <Badge variant="outline">
                        {selectedSummary.confidenceLevel}
                      </Badge>
                      <Badge
                        variant={
                          selectedSummary.userStatus === "confirmed"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {selectedSummary.userStatus}
                      </Badge>
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-px bg-border p-px">
                  {[
                    [
                      "Linked evidence",
                      formatCount(
                        members.data?.total ?? selectedSummary.memberCount,
                      ),
                    ],
                    [
                      "Link type",
                      selectedSummary.linkType.replaceAll("_", " "),
                    ],
                    ["Review state", notice || selectedSummary.userStatus],
                  ].map(([label, value]) => (
                    <div className="bg-background p-4" key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 truncate font-mono text-sm">{value}</p>
                    </div>
                  ))}
                </CardContent>
                <CardContent className="px-0">
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-3/5 ps-6">
                          Record values
                        </TableHead>
                        <TableHead className="pe-6">Context</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(members.data?.members ?? []).map((member) => {
                        const values = member.fields
                          .filter(
                            (field) =>
                              !["password", "password_hash", "salt"].includes(
                                field.fieldType,
                              ),
                          )
                          .map((field) => field.displayValue);
                        return (
                          <TableRow key={member.recordId}>
                            <TableCell className="whitespace-normal ps-6">
                              <p className="font-mono text-xs break-all">
                                {values.join(" | ") || "No displayable values"}
                              </p>
                            </TableCell>
                            <TableCell className="whitespace-normal pe-6">
                              <p className="truncate text-xs font-medium">
                                {member.datasetName}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {member.sourceFile}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">
                                  {member.sourceLocation}
                                </span>
                                <Badge variant="outline">
                                  {member.userStatus}
                                </Badge>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
                {members.data ? (
                  <PaginationControls
                    label="identity members"
                    limit={memberLimit}
                    offset={memberOffset}
                    onOffsetChange={setMemberOffset}
                    total={members.data.total}
                  />
                ) : null}
                <CardFooter className="justify-between gap-2 rounded-none bg-background">
                  <p className="text-xs text-muted-foreground">
                    Confirm only after reviewing linked source rows.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => void applyAction("reject")}
                      size="sm"
                      variant="outline"
                    >
                      <XIcon data-icon="inline-start" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => void applyAction("confirm")}
                      size="sm"
                    >
                      <CheckIcon data-icon="inline-start" />
                      Confirm
                    </Button>
                  </div>
                </CardFooter>
              </DashboardCard>
            ) : (
              <DashboardCard>
                <Empty className="min-h-[31rem] rounded-none border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FingerprintIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      {rebuild.isPending
                        ? "Analyzing identifiers"
                        : "No repeated identities yet"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {rebuild.isPending
                        ? "Emails and phone numbers are being grouped in the background. You can keep using the app."
                        : "Automatic identities require the same email, phone number, or service ID in at least two records."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </DashboardCard>
            )}
          </div>
        </TabsContent>

        <TabsContent value="builder">
          <div className="grid grid-cols-1 gap-px bg-border p-px lg:grid-cols-[1fr_20rem]">
            <DashboardCard className="gap-0">
              <CardHeader className="border-b">
                <CardTitle>Find evidence</CardTitle>
                <CardDescription>
                  Search the index and select only reviewed rows.
                </CardDescription>
              </CardHeader>
              <CardContent className="border-b p-4">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setManualOffset(0);
                    setSubmittedManualQuery(manualQuery.trim());
                  }}
                >
                  <InputGroup>
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      aria-label="Find identity evidence"
                      onChange={(event) => setManualQuery(event.target.value)}
                      placeholder="Email, username, phone, or account ID"
                      value={manualQuery}
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        disabled={manualResults.isFetching}
                        size="sm"
                        type="submit"
                      >
                        {manualResults.isFetching ? (
                          <Spinner data-icon="inline-start" />
                        ) : null}
                        {manualResults.isFetching ? "Searching…" : "Search"}
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                </form>
              </CardContent>
              <CardContent className="px-0">
                {manualResults.data?.hits.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 ps-4" />
                        <TableHead>Evidence</TableHead>
                        <TableHead className="pe-6">Context</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {manualResults.data.hits.map((hit) => (
                        <TableRow key={hit.recordId}>
                          <TableCell className="ps-4">
                            <Checkbox
                              aria-label={`Select ${hit.recordId}`}
                              checked={manualSelection.has(hit.recordId)}
                              onCheckedChange={(checked) =>
                                setManualSelection((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(hit.recordId);
                                  else next.delete(hit.recordId);
                                  return next;
                                })
                              }
                            />
                          </TableCell>
                          <TableCell className="max-w-2xl">
                            <p className="font-mono text-xs break-all">
                              {hit.fields
                                .filter(
                                  (field) =>
                                    ![
                                      "password",
                                      "password_hash",
                                      "salt",
                                    ].includes(field.fieldType),
                                )
                                .slice(0, 8)
                                .map((field) => field.displayValue)
                                .join(" | ") || "No displayable values"}
                            </p>
                          </TableCell>
                          <TableCell className="whitespace-normal pe-6">
                            <p className="truncate text-xs font-medium">
                              {hit.datasetName}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {hit.sourceLocation}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty className="min-h-80 rounded-none border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        {manualResults.isFetching ? (
                          <Spinner />
                        ) : (
                          <SearchIcon />
                        )}
                      </EmptyMedia>
                      <EmptyTitle>
                        {manualResults.isFetching
                          ? "Searching identity evidence"
                          : "Find a person or account"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {manualResults.isFetching
                          ? "Checking the local index for matching records."
                          : "Search, review the matching rows, then select the evidence to bundle."}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
              {manualResults.data ? (
                <PaginationControls
                  label="identity builder results"
                  limit={memberLimit}
                  offset={manualOffset}
                  onOffsetChange={setManualOffset}
                  total={manualResults.data.total}
                />
              ) : null}
            </DashboardCard>

            <DashboardCard className="gap-0">
              <CardHeader>
                <CardTitle>Identity bundle</CardTitle>
                <CardDescription>
                  {formatCount(manualSelection.size)} selected records
                </CardDescription>
                <CardAction>
                  <UsersIcon />
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="identity-name">
                      Identity name
                    </FieldLabel>
                    <Input
                      id="identity-name"
                      onChange={(event) => setManualName(event.target.value)}
                      placeholder="Reviewed identity"
                      value={manualName}
                    />
                    <FieldDescription>
                      The name stays local and does not change source data.
                    </FieldDescription>
                  </Field>
                </FieldGroup>

                <Empty className="min-h-48 flex-1 rounded-none border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FingerprintIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      {manualSelection.size
                        ? `${formatCount(manualSelection.size)} records ready`
                        : "No evidence selected"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {manualSelection.size
                        ? "Name the bundle, then create the reviewed identity."
                        : "Select reviewed evidence from the search results to build this identity."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
              <CardFooter className="mt-auto rounded-none bg-background">
                <Button
                  className="w-full"
                  disabled={
                    !manualName.trim() ||
                    !manualSelection.size ||
                    create.isPending
                  }
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <UsersIcon data-icon="inline-start" />
                  )}
                  {create.isPending ? "Creating…" : "Create identity"}
                </Button>
              </CardFooter>
            </DashboardCard>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

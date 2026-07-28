import { useState, type FormEvent } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BadgeCheck,
  GitMerge,
  IdCard,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";

import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { Input } from "../components/ui/input";
import { PaginationControls } from "../components/ui/pagination-controls";
import {
  applyIdentityAction,
  createManualIdentity,
  listIdentities,
  listIdentityMembers,
  rebuildIdentities,
  searchRecords,
  type IdentityActionInput,
  type SearchHit,
} from "../lib/desktop";

const builderPageSize = 25;
const memberPageSize = 25;

export function IdentitiesPage() {
  const queryClient = useQueryClient();
  const [builderDraft, setBuilderDraft] = useState("");
  const [builderQuery, setBuilderQuery] = useState("");
  const [builderOffset, setBuilderOffset] = useState(0);
  const [identityName, setIdentityName] = useState("");
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(
    new Set(),
  );
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [lastEvent, setLastEvent] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [memberOffset, setMemberOffset] = useState(0);
  const [notice, setNotice] = useState("");

  const identities = useQuery({
    queryKey: ["identities"],
    queryFn: listIdentities,
  });
  const builderResults = useQuery({
    queryKey: ["identity-builder", builderQuery, builderOffset],
    queryFn: () =>
      searchRecords({
        query: builderQuery,
        mode: "contains",
        datasetId: null,
        fieldType: null,
        offset: builderOffset,
        limit: builderPageSize,
      }),
    enabled: builderQuery.length >= 2,
    placeholderData: keepPreviousData,
  });
  const members = useQuery({
    queryKey: ["identity-members", openGroup, memberOffset],
    queryFn: () =>
      listIdentityMembers(openGroup ?? "", memberOffset, memberPageSize),
    enabled: Boolean(openGroup),
    placeholderData: keepPreviousData,
  });
  const action = useMutation({
    mutationFn: (input: IdentityActionInput) => applyIdentityAction(input),
    onSuccess: async (eventId) => {
      setLastEvent(eventId);
      setMergeSource(null);
      setMergeTarget("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["identities"] }),
        queryClient.invalidateQueries({ queryKey: ["identity-members"] }),
      ]);
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "Identity review could not be applied",
      ),
  });
  const createIdentity = useMutation({
    mutationFn: createManualIdentity,
    onSuccess: async () => {
      setNotice(
        `${selectedRecords.size.toLocaleString()} records bundled as ${identityName.trim()}`,
      );
      setIdentityName("");
      setSelectedRecords(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["identities"] }),
        queryClient.invalidateQueries({ queryKey: ["overview-stats"] }),
      ]);
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "Manual identity could not be created",
      ),
  });
  const rebuild = useMutation({
    mutationFn: rebuildIdentities,
    onSuccess: async (count) => {
      setNotice(
        `${count.toLocaleString()} matching automatic identities are ready`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["identities"] }),
        queryClient.invalidateQueries({ queryKey: ["overview-stats"] }),
      ]);
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "Automatic identities could not be rebuilt",
      ),
  });

  function submitBuilder(event: FormEvent) {
    event.preventDefault();
    const query = builderDraft.trim();
    if (query.length < 2) return;
    setBuilderOffset(0);
    setBuilderQuery(query);
    setSelectedRecords(new Set());
  }

  function toggleRecord(recordId: string) {
    setSelectedRecords((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  function apply(
    actionName: IdentityActionInput["action"],
    groupId: string,
    targetGroupId: string | null = null,
  ) {
    action.mutate({
      action: actionName,
      groupId,
      recordIds: [],
      targetGroupId,
    });
  }

  function openMembers(groupId: string) {
    setOpenGroup((current) => (current === groupId ? null : groupId));
    setMemberOffset(0);
  }

  function createBundle() {
    const name = identityName.trim();
    if (!name || selectedRecords.size < 2) return;
    createIdentity.mutate({
      name,
      recordIds: [...selectedRecords],
    });
  }

  return (
    <div className="page page--identities">
      <PageHeader
        title="Identities"
        description="Bundle related records automatically or build a reviewed identity yourself."
        meta="LOCAL + REVIEWABLE"
        action={
          <div className="identity-page-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={rebuild.isPending}
              onClick={() => rebuild.mutate()}
            >
              {rebuild.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {rebuild.isPending ? "Finding matches" : "Find automatic matches"}
            </Button>
            {lastEvent ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={action.isPending}
                onClick={() => apply("undo", lastEvent)}
              >
                <RotateCcw />
                Undo review
              </Button>
            ) : null}
          </div>
        }
      />

      {notice ? <p className="notice-line">{notice}</p> : null}

      <Card className="identity-builder" size="sm">
        <CardHeader className="border-b">
          <CardTitle>Build an identity</CardTitle>
          <CardDescription>
            Search any identifier, select matching records, then give the bundle
            a clear name.
          </CardDescription>
          <CardAction>
            <span className="identity-builder__privacy">
              <ShieldCheck />
              Local only
            </span>
          </CardAction>
        </CardHeader>
        <CardContent className="identity-builder__content">
          <form className="identity-builder__search" onSubmit={submitBuilder}>
            <Search aria-hidden="true" />
            <Input
              aria-label="Find records for an identity"
              placeholder="Search an email, username, phone, domain, or other identifier"
              value={builderDraft}
              maxLength={512}
              onChange={(event) => setBuilderDraft(event.target.value)}
            />
            <Button type="submit" variant="primary">
              Search records
            </Button>
          </form>

          {builderResults.isError ? (
            <p className="import-error" role="alert">
              {String(builderResults.error)}
            </p>
          ) : builderQuery ? (
            <div className="identity-builder__results">
              <div className="identity-builder__bundle">
                <div>
                  <strong>
                    {builderResults.data?.total.toLocaleString() ?? "0"} matches
                  </strong>
                  <span>
                    {selectedRecords.size.toLocaleString()} selected across
                    pages
                  </span>
                </div>
                <Input
                  aria-label="Identity name"
                  placeholder="Identity name"
                  value={identityName}
                  maxLength={120}
                  onChange={(event) => setIdentityName(event.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={
                    selectedRecords.size < 2 ||
                    !identityName.trim() ||
                    createIdentity.isPending
                  }
                  onClick={createBundle}
                >
                  {createIdentity.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Users />
                  )}
                  Bundle {selectedRecords.size || ""}
                </Button>
              </div>
              {builderResults.isLoading ? (
                <div className="loading-line">
                  <LoaderCircle className="animate-spin" />
                  Searching indexed records
                </div>
              ) : builderResults.data?.hits.length ? (
                <>
                  <div className="identity-builder__table">
                    {builderResults.data.hits.map((hit) => (
                      <IdentitySearchRow
                        key={hit.recordId}
                        hit={hit}
                        checked={selectedRecords.has(hit.recordId)}
                        onChange={() => toggleRecord(hit.recordId)}
                      />
                    ))}
                  </div>
                  <PaginationControls
                    label="identity search results"
                    offset={builderOffset}
                    total={builderResults.data.total}
                    pageSize={builderPageSize}
                    busy={builderResults.isFetching}
                    onOffsetChange={setBuilderOffset}
                  />
                </>
              ) : (
                <p className="identity-builder__empty">
                  No records contain this value.
                </p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="identity-collection">
        <header>
          <div>
            <h2>Identity bundles</h2>
            <p>
              Automatic cards require at least two exact matching records.
              Manual cards contain only records you selected.
            </p>
          </div>
          <span className="font-mono">
            {(identities.data?.length ?? 0).toLocaleString()} identities
          </span>
        </header>

        {identities.isLoading ? (
          <div className="loading-line">
            <LoaderCircle className="animate-spin" />
            Loading identities
          </div>
        ) : identities.data?.length ? (
          <div className="identity-bento">
            {identities.data.map((identity) => {
              const manual = identity.linkType === "manual_bundle";
              return (
                <Card
                  className="identity-card"
                  data-manual={manual}
                  key={identity.id}
                  size="sm"
                >
                  <CardHeader>
                    <CardTitle>
                      <IdCard />
                      <span>{identity.displayLabel}</span>
                    </CardTitle>
                    <CardDescription className="font-mono">
                      {identity.id.slice(0, 12)}
                    </CardDescription>
                    <CardAction>
                      <span className="identity-card__type">
                        {manual ? "Manual" : "Automatic"}
                      </span>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="identity-card__body">
                    <div>
                      <strong className="font-mono">
                        {identity.memberCount.toLocaleString()}
                      </strong>
                      <span>linked records</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Confidence</dt>
                        <dd>{identity.confidenceLevel}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{identity.userStatus}</dd>
                      </div>
                      <div>
                        <dt>Rule</dt>
                        <dd>{identity.explanation.replaceAll("_", " ")}</dd>
                      </div>
                    </dl>
                  </CardContent>
                  {mergeSource === identity.id ? (
                    <div className="identity-card__merge">
                      <select
                        aria-label="Merge target"
                        value={mergeTarget}
                        onChange={(event) => setMergeTarget(event.target.value)}
                      >
                        <option value="">Choose target identity</option>
                        {identities.data
                          .filter((candidate) => candidate.id !== identity.id)
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.displayLabel}
                            </option>
                          ))}
                      </select>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!mergeTarget || action.isPending}
                        onClick={() =>
                          apply("merge", identity.id, mergeTarget || null)
                        }
                      >
                        Merge
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMergeSource(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                  <CardFooter className="identity-card__actions">
                    {!manual ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={action.isPending}
                          onClick={() => apply("confirm", identity.id)}
                        >
                          <BadgeCheck />
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={action.isPending}
                          onClick={() => apply("reject", identity.id)}
                        >
                          <XCircle />
                          Reject
                        </Button>
                      </>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={action.isPending}
                      onClick={() => setMergeSource(identity.id)}
                    >
                      <GitMerge />
                      Merge
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={action.isPending}
                      onClick={() => openMembers(identity.id)}
                    >
                      <Users />
                      {openGroup === identity.id ? "Hide" : "Members"}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={IdCard}
            title="No matching identities yet"
            description="Use the builder above, or scan indexed records for repeated exact emails, phones, and service-scoped IDs."
            detail="Automatic grouping never guesses from similar names or usernames."
            action={
              <Button
                variant="primary"
                disabled={rebuild.isPending}
                onClick={() => rebuild.mutate()}
              >
                <RefreshCw />
                Find automatic matches
              </Button>
            }
          />
        )}
      </section>

      {openGroup ? (
        <Card className="identity-members-panel" size="sm">
          <CardHeader className="border-b">
            <CardTitle>Identity members</CardTitle>
            <CardDescription>
              Every row keeps its original dataset and source line.
            </CardDescription>
            <CardAction>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpenGroup(null)}
              >
                Close
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {members.isLoading ? (
              <div className="loading-line">
                <LoaderCircle className="animate-spin" />
                Loading members
              </div>
            ) : members.data?.members.length ? (
              <div className="identity-members-table">
                {members.data.members.map((member) => (
                  <article key={member.recordId}>
                    <span>
                      <strong>{member.datasetName}</strong>
                      <small>{member.sourceFile}</small>
                    </span>
                    <span className="source-location">
                      {member.sourceLocation}
                    </span>
                    <em>{member.userStatus}</em>
                  </article>
                ))}
              </div>
            ) : (
              <p className="identity-builder__empty">No linked records.</p>
            )}
          </CardContent>
          {members.data ? (
            <CardFooter>
              <PaginationControls
                label="identity members"
                offset={memberOffset}
                total={members.data.total}
                pageSize={memberPageSize}
                busy={members.isFetching}
                onOffsetChange={setMemberOffset}
              />
            </CardFooter>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function IdentitySearchRow({
  hit,
  checked,
  onChange,
}: {
  hit: SearchHit;
  checked: boolean;
  onChange: () => void;
}) {
  const primary =
    hit.fields.find((field) => field.fieldType === "email") ??
    hit.fields.find((field) => !field.sensitive) ??
    hit.fields[0];
  return (
    <label>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>
        <strong className="font-mono">
          {primary?.displayValue || "Masked record"}
        </strong>
        <small>
          {hit.datasetName} · {hit.sourceFile}
        </small>
      </span>
      <span className="source-location">{hit.sourceLocation}</span>
    </label>
  );
}

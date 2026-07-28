import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  GitMerge,
  IdCard,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Scissors,
  ShieldQuestion,
  Unlink,
  Users,
  XCircle,
} from "lucide-react";

import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import {
  applyIdentityAction,
  listIdentities,
  listIdentityMembers,
  rebuildIdentities,
  type IdentityActionInput,
} from "../lib/desktop";

export function IdentitiesPage() {
  const queryClient = useQueryClient();
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [lastEvent, setLastEvent] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(),
  );
  const [notice, setNotice] = useState("");
  const identities = useQuery({
    queryKey: ["identities"],
    queryFn: listIdentities,
  });
  const action = useMutation({
    mutationFn: (input: IdentityActionInput) => applyIdentityAction(input),
    onSuccess: async (eventId) => {
      setLastEvent(eventId);
      setMergeSource(null);
      setMergeTarget("");
      setOpenGroup(null);
      setSelectedMembers(new Set());
      await queryClient.invalidateQueries({ queryKey: ["identities"] });
    },
  });
  const rebuild = useMutation({
    mutationFn: rebuildIdentities,
    onSuccess: async (count) => {
      setNotice(
        `${count.toLocaleString()} deterministic identity groups are ready`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["identities"] }),
        queryClient.invalidateQueries({ queryKey: ["overview-stats"] }),
      ]);
    },
    onError: (error) => {
      setNotice(
        error instanceof Error
          ? error.message
          : "Identity groups could not be rebuilt",
      );
    },
  });
  const members = useQuery({
    queryKey: ["identity-members", openGroup],
    queryFn: () => listIdentityMembers(openGroup ?? ""),
    enabled: Boolean(openGroup),
  });

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

  function toggleMember(recordId: string) {
    setSelectedMembers((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  return (
    <div className="page">
      <PageHeader
        title="Identities"
        description="Review automatically created, deterministic identity links."
        meta="AUTOMATIC + REVIEWABLE"
        action={
          <div className="identity-page-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={rebuild.isPending}
              onClick={() => rebuild.mutate()}
            >
              {rebuild.isPending ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              {rebuild.isPending ? "Building groups" : "Rebuild groups"}
            </Button>
            {lastEvent ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={action.isPending}
                onClick={() => apply("undo", lastEvent)}
              >
                <RotateCcw size={14} />
                Undo last review
              </Button>
            ) : null}
          </div>
        }
      />
      {notice ? <p className="notice-line">{notice}</p> : null}
      <section className="identity-explainer">
        <ShieldQuestion size={17} />
        <div>
          <strong>
            Yes—identity groups are created automatically during import.
          </strong>
          <span>
            Grouping only uses exact normalized emails and phones, or matching
            IDs from the same service. It never guesses from usernames or fuzzy
            similarity, and every automatic link can be reviewed here.
          </span>
        </div>
      </section>
      {identities.isLoading ? (
        <div className="loading-line">
          <LoaderCircle className="animate-spin" size={16} />
          Loading deterministic groups
        </div>
      ) : identities.data?.length ? (
        <section className="identity-list">
          <header className="identity-list__head">
            <span>Identity</span>
            <span>Evidence</span>
            <span>Members</span>
            <span>Review</span>
          </header>
          {identities.data.map((identity) => (
            <article className="identity-row" key={identity.id}>
              <div className="identity-row__name">
                <IdCard size={16} />
                <span>
                  <strong>{identity.displayLabel}</strong>
                  <small className="font-mono">
                    {identity.id.slice(0, 12)}
                  </small>
                </span>
              </div>
              <div className="identity-evidence">
                <span>
                  <BadgeCheck size={13} />
                  {identity.confidenceLevel} confidence
                </span>
                <small>{identity.explanation.replaceAll("_", " ")}</small>
              </div>
              <span className="font-mono">
                {identity.memberCount.toLocaleString()}
                <small className="identity-review-state">
                  {identity.userStatus}
                </small>
              </span>
              <div className="identity-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() => apply("confirm", identity.id)}
                >
                  <BadgeCheck size={14} />
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() => apply("reject", identity.id)}
                >
                  <XCircle size={14} />
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() => setMergeSource(identity.id)}
                >
                  <GitMerge size={14} />
                  Merge
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() => {
                    setOpenGroup(
                      openGroup === identity.id ? null : identity.id,
                    );
                    setSelectedMembers(new Set());
                  }}
                >
                  <Users size={14} />
                  Members
                </Button>
              </div>
              {mergeSource === identity.id ? (
                <div className="identity-merge">
                  <GitMerge size={15} />
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
                    Confirm merge
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
              {openGroup === identity.id ? (
                <div className="identity-members">
                  <div className="identity-members__head">
                    <span>Select records for a new reviewed identity</span>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!selectedMembers.size || action.isPending}
                      onClick={() =>
                        action.mutate({
                          action: "split",
                          groupId: identity.id,
                          recordIds: [...selectedMembers],
                          targetGroupId: null,
                        })
                      }
                    >
                      <Scissors size={14} />
                      Split {selectedMembers.size || ""}
                    </Button>
                  </div>
                  {members.isLoading ? (
                    <span className="loading-line">
                      <LoaderCircle className="animate-spin" size={14} />
                      Loading members
                    </span>
                  ) : (
                    members.data?.map((member) => (
                      <label key={member.recordId}>
                        <input
                          type="checkbox"
                          checked={selectedMembers.has(member.recordId)}
                          onChange={() => toggleMember(member.recordId)}
                        />
                        <span>
                          <strong>{member.datasetName}</strong>
                          <small className="source-location">
                            {member.sourceFile} · {member.sourceLocation}
                          </small>
                        </span>
                        <em>{member.userStatus}</em>
                      </label>
                    ))
                  )}
                </div>
              ) : null}
            </article>
          ))}
          <div className="identity-policy">
            <ShieldQuestion size={16} />
            <div>
              <strong>Conservative grouping policy</strong>
              <span>
                “Automatic” means created by those strict import rules. Confirm,
                reject, merge, split, and undo preserve an audit trail.
              </span>
            </div>
            <Unlink size={16} />
          </div>
        </section>
      ) : (
        <EmptyState
          icon={IdCard}
          title="No identity groups"
          description="Exact normalized emails, phones, and service-scoped identifiers will form explainable groups after indexing."
          detail="A username alone never creates an automatic merge."
          action={
            <Button
              variant="primary"
              disabled={rebuild.isPending}
              onClick={() => rebuild.mutate()}
            >
              {rebuild.isPending ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              Build from indexed records
            </Button>
          }
        />
      )}
      {action.isError ? (
        <p className="import-error" role="alert">
          Identity review could not be applied.
        </p>
      ) : null}
    </div>
  );
}

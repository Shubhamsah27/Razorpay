import { useEffect, useMemo, useRef, useState } from "react";
import { rupees, titleise } from "../lib/format";
import { caseStatus, wasStoppedByGuard } from "../lib/caseStatus";
import type { CaseAudit } from "../types";

export type QueueFilter =
  | "all"
  | "recovered"
  | "blocked"
  | "reconciled"
  | "razorpay"
  | "review";

const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "recovered", label: "Recovered" },
  { key: "blocked", label: "Stopped" },
  { key: "review", label: "Reviewed" },
  { key: "reconciled", label: "Reconciled" },
  { key: "razorpay", label: "Razorpay-backed" },
];

export function matchesFilter(audit: CaseAudit, filter: QueueFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "recovered":
      return audit.incrementalPaise > 0;
    case "blocked":
      // Guard-stopped, not merely action-less: a case can settle organically
      // before its first action was ever due.
      return wasStoppedByGuard(audit) && audit.actions.length === 0;
    case "review":
      return audit.decisions.some((decision) => decision.guard.decision === "review");
    case "reconciled":
      return audit.actions.some((action) => action.reconciled);
    case "razorpay":
      return audit.actions.some((action) => action.executionDomain === "razorpay");
  }
}

const STATUS_BADGE: Record<string, string> = {
  recovered: "green",
  reconciled: "amber",
  organic: "neutral",
  stopped: "red",
  unrecovered: "neutral",
};

function statusBadge(audit: CaseAudit) {
  const status = caseStatus(audit);
  return <span className={`badge ${STATUS_BADGE[status]}`}>{titleise(status)}</span>;
}

interface CaseQueueProps {
  cases: CaseAudit[];
  selectedId: string;
  onSelect(caseId: string): void;
}

export function CaseQueue({ cases, selectedId, onSelect }: CaseQueueProps) {
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cases.filter((audit) => {
      if (!matchesFilter(audit, filter)) return false;
      if (needle === "") return true;
      return (
        audit.caseId.includes(needle) ||
        audit.diagnosis.failureClass.includes(needle.replace(/\s+/g, "_"))
      );
    });
  }, [cases, filter, query]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((entry) => [
          entry.key,
          cases.filter((audit) => matchesFilter(audit, entry.key)).length,
        ]),
      ) as Record<QueueFilter, number>,
    [cases],
  );

  // j/k moves through the queue, the way an operator tool should.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "j" && event.key !== "k") return;
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.isContentEditable)) return;

      const index = visible.findIndex((audit) => audit.caseId === selectedId);
      if (index === -1) return;
      const next = event.key === "j" ? index + 1 : index - 1;
      const candidate = visible[next];
      if (candidate === undefined) return;
      event.preventDefault();
      onSelect(candidate.caseId);
      listRef.current
        ?.querySelector(`[data-case="${candidate.caseId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, selectedId, onSelect]);

  return (
    <div className="card queue">
      <div className="queue-head">
        <span>At-risk queue</span>
        <span style={{ marginLeft: "auto", letterSpacing: 0, textTransform: "none" }}>
          {visible.length} of {cases.length}
        </span>
      </div>

      <div className="queue-controls">
        <input
          className="queue-search"
          placeholder="Search class or id…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search cases"
        />
        <div className="queue-filters">
          {FILTERS.map((entry) => (
            <button
              type="button"
              key={entry.key}
              className={`queue-filter ${filter === entry.key ? "active" : ""}`}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
              <span className="queue-filter-count">{counts[entry.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="queue-list" ref={listRef}>
        {visible.length === 0 ? (
          <div className="empty">No cases match this filter.</div>
        ) : (
          visible.map((audit) => (
            <button
              type="button"
              key={audit.caseId}
              data-case={audit.caseId}
              className={`queue-item ${audit.caseId === selectedId ? "active" : ""}`}
              onClick={() => onSelect(audit.caseId)}
            >
              <div className="queue-item-top">
                <span className="queue-class">{titleise(audit.diagnosis.failureClass)}</span>
                <span className="queue-amount">{rupees(audit.amountPaise)}</span>
              </div>
              <div className="queue-item-bottom">
                {statusBadge(audit)}
                {audit.actions.some((action) => action.executionDomain === "razorpay") && (
                  <span className="badge razorpay">
                    <span className="badge-dot" />
                    RZP
                  </span>
                )}
                <span className="queue-id">{audit.caseId.replace("case_", "#")}</span>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="queue-foot">
        <kbd>j</kbd>
        <kbd>k</kbd>
        to move through cases
      </div>
    </div>
  );
}

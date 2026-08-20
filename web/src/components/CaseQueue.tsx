import { rupees, titleise } from "../lib/format";
import type { CaseAudit } from "../types";

function statusBadge(audit: CaseAudit) {
  if (audit.actions.length === 0) {
    const blocked = audit.decisions[0]?.outcome ?? "no action";
    return <span className="badge red">{titleise(blocked)}</span>;
  }
  if (audit.actions.some((action) => action.reconciled)) {
    return <span className="badge amber">reconciled</span>;
  }
  if (audit.incrementalPaise > 0) return <span className="badge green">recovered</span>;
  return <span className="badge neutral">in flight</span>;
}

interface CaseQueueProps {
  cases: CaseAudit[];
  selectedId: string;
  onSelect(caseId: string): void;
}

export function CaseQueue({ cases, selectedId, onSelect }: CaseQueueProps) {
  return (
    <div className="card queue">
      <div className="queue-head">
        <span>At-risk queue</span>
        <span style={{ marginLeft: "auto", letterSpacing: 0, textTransform: "none" }}>
          {cases.length} cases
        </span>
      </div>
      <div className="queue-list">
        {cases.map((audit) => (
          <button
            type="button"
            key={audit.caseId}
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
        ))}
      </div>
    </div>
  );
}

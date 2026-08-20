import { motion } from "framer-motion";
import { rupees, titleise } from "../lib/format";
import type { ActionAudit, CaseAudit, DecisionRecord } from "../types";

type StageStatus = "passed" | "stopped" | "unreached";

interface Stage {
  key: string;
  label: string;
  value: string;
  detail: string;
  status: StageStatus;
  domain?: "simulated" | "razorpay";
}

const STATUS_COLOR: Record<StageStatus, string> = {
  passed: "var(--rzp-blue-light)",
  stopped: "#ff6b72",
  unreached: "var(--faint)",
};

/** Attempt numbers this case actually considered, in order. */
export function attemptNumbers(audit: CaseAudit): number[] {
  const numbers = new Set<number>();
  for (const decision of audit.decisions) numbers.add(decision.attemptNumber);
  for (const action of audit.actions) numbers.add(action.attemptNumber);
  return [...numbers].sort((left, right) => left - right);
}

/**
 * Builds the runtime path for ONE attempt.
 *
 * Decision and action are matched by attemptNumber and nothing else. Mixing the
 * first decision with another attempt's action is what produced the earlier bug
 * where a case showed a positive expected value beside a block.
 */
export function buildStages(
  audit: CaseAudit,
  decision: DecisionRecord | undefined,
  action: ActionAudit | undefined,
): Stage[] {
  const guardDecision = decision?.guard.decision ?? "none";
  const stoppedByGuard =
    decision !== undefined &&
    (decision.outcome === "blocked" ||
      decision.outcome === "not_supported" ||
      decision.outcome === "rejected");

  const reachedAction = action !== undefined;
  const reconciled = action?.reconciled ?? false;
  const delivered = action?.state === "succeeded";

  // Credit belongs to the attempt whose action actually earned it.
  const earnedIncremental =
    reachedAction && audit.incrementalPaise > 0 && action.customerResponded;

  return [
    {
      key: "event",
      label: "Event",
      value: audit.event.entity,
      detail: audit.event.errorReason ?? audit.event.errorCode ?? "no error code",
      status: "passed",
    },
    {
      key: "diagnosis",
      label: "Diagnosis",
      value: titleise(audit.diagnosis.failureClass),
      detail: `${audit.diagnosis.source} · ${(audit.diagnosis.confidence * 100).toFixed(0)}%`,
      status: "passed",
    },
    {
      key: "value",
      label: "Expected value",
      value: decision === undefined ? "—" : rupees(decision.expectedValuePaise, 0),
      detail: decision === undefined ? "no decision recorded" : `via ${decision.channel}`,
      status: decision === undefined ? "unreached" : "passed",
    },
    {
      key: "guard",
      label: "Safety guard",
      value: titleise(guardDecision),
      detail: stoppedByGuard
        ? (decision?.guard.rules.find((rule) => rule.decision === "blocked")?.rule ??
          decision?.note ??
          "stopped")
        : `${decision?.guard.rules.length ?? 0} rules evaluated`,
      status: stoppedByGuard ? "stopped" : decision === undefined ? "unreached" : "passed",
    },
    {
      key: "action",
      label: "Durable action",
      value: reachedAction ? titleise(action.actionKind) : "None",
      detail: reachedAction ? action.referenceId.slice(0, 22) : "no external effect",
      status: reachedAction ? "passed" : "unreached",
      domain: action?.executionDomain,
    },
    {
      key: "provider",
      label: "Provider",
      value: reachedAction ? (reconciled ? "Reconciled" : titleise(action.state)) : "—",
      detail: reachedAction
        ? reconciled
          ? "outcome_unknown → reconciling"
          : delivered
            ? "confirmed on first call"
            : "not delivered"
        : "never contacted",
      status: reachedAction ? "passed" : "unreached",
    },
    {
      key: "outcome",
      label: "Outcome",
      value: earnedIncremental
        ? rupees(audit.incrementalPaise, 0)
        : reachedAction
          ? "No response"
          : "—",
      detail: earnedIncremental
        ? "credited as incremental"
        : reachedAction
          ? "customer did not act on this attempt"
          : "this attempt took no action",
      status: earnedIncremental ? "passed" : "unreached",
    },
  ];
}

interface PipelineFlowProps {
  audit: CaseAudit;
  attempt: number;
  onAttemptChange(attempt: number): void;
}

export function PipelineFlow({ audit, attempt, onAttemptChange }: PipelineFlowProps) {
  const attempts = attemptNumbers(audit);
  const decision = audit.decisions.find((entry) => entry.attemptNumber === attempt);
  const action = audit.actions.find((entry) => entry.attemptNumber === attempt);
  const stages = buildStages(audit, decision, action);

  return (
    <div>
      {attempts.length > 1 && (
        <div className="attempt-switch" role="tablist" aria-label="Attempt">
          {attempts.map((number) => {
            const entry = audit.decisions.find((d) => d.attemptNumber === number);
            const stopped =
              entry !== undefined && entry.outcome !== "approved";
            return (
              <button
                type="button"
                role="tab"
                key={number}
                aria-selected={number === attempt}
                className={`attempt-tab ${number === attempt ? "active" : ""}`}
                onClick={() => onAttemptChange(number)}
              >
                Attempt {number}
                <span className={`attempt-pip ${stopped ? "stopped" : "ok"}`} />
              </button>
            );
          })}
        </div>
      )}

      <div className="pipeline" data-attempt={attempt}>
        {stages.map((stage, index) => (
          <div className="pipeline-cell" key={stage.key}>
            {index > 0 && (
              <div className="pipeline-link" aria-hidden="true">
                <motion.span
                  className="pipeline-link-fill"
                  initial={false}
                  animate={{ opacity: stage.status === "unreached" ? 0.25 : 1 }}
                  transition={{ duration: 0.3 }}
                  style={{ background: STATUS_COLOR[stage.status] }}
                />
              </div>
            )}

            <motion.div
              className={`pipeline-node ${stage.status}`}
              key={`${attempt}-${stage.key}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="pipeline-label">
                <span
                  className="pipeline-dot"
                  style={{
                    background: STATUS_COLOR[stage.status],
                    boxShadow:
                      stage.status === "unreached"
                        ? "none"
                        : `0 0 9px ${STATUS_COLOR[stage.status]}88`,
                  }}
                />
                {stage.label}
              </div>
              <div className="pipeline-value">{stage.value}</div>
              <div className="pipeline-detail">{stage.detail}</div>
              {stage.domain !== undefined && (
                <span
                  className={`badge ${stage.domain === "razorpay" ? "razorpay" : "simulated"}`}
                >
                  <span className="badge-dot" />
                  {stage.domain === "razorpay" ? "Razorpay" : "Simulated"}
                </span>
              )}
            </motion.div>
          </div>
        ))}
      </div>
    </div>
  );
}

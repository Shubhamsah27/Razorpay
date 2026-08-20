import { motion } from "framer-motion";
import { rupees, titleise } from "../lib/format";
import type { CaseAudit } from "../types";

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

/**
 * Recoup's runtime path, rendered against one real case. A case that the guard
 * stops visibly halts at that node instead of quietly showing nothing, which is
 * the behaviour worth seeing.
 */
function buildStages(audit: CaseAudit): Stage[] {
  const first = audit.decisions[0];
  const guardDecision = first?.guard.decision ?? "none";
  const stoppedAtGuard =
    first !== undefined && (first.outcome === "blocked" || first.outcome === "not_supported");
  const rejectedAtReview = first?.outcome === "rejected";
  const action = audit.actions[0];
  const reconciled = audit.actions.some((entry) => entry.reconciled);
  const delivered = audit.actions.some((entry) => entry.state === "succeeded");

  const reachedAction = action !== undefined;
  const blockedEarly = stoppedAtGuard || rejectedAtReview;

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
      value: first === undefined ? "—" : rupees(first.expectedValuePaise, 0),
      detail: first === undefined ? "no decision" : `via ${first.channel}`,
      status: first === undefined ? "unreached" : "passed",
    },
    {
      key: "guard",
      label: "Safety guard",
      value: titleise(guardDecision),
      detail: blockedEarly
        ? (first?.guard.rules.find((rule) => rule.decision === "blocked")?.rule ??
          "stopped")
        : `${first?.guard.rules.length ?? 0} rules evaluated`,
      status: blockedEarly ? "stopped" : first === undefined ? "unreached" : "passed",
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
      value: audit.incrementalPaise > 0 ? rupees(audit.incrementalPaise, 0) : audit.paid ? "Organic" : "Unrecovered",
      detail:
        audit.incrementalPaise > 0
          ? "credited as incremental"
          : audit.paid
            ? "would have paid anyway"
            : "no recovery",
      status: audit.incrementalPaise > 0 ? "passed" : "unreached",
    },
  ];
}

export function PipelineFlow({ audit }: { audit: CaseAudit }) {
  const stages = buildStages(audit);

  return (
    <div className="pipeline">
      {stages.map((stage, index) => (
        <div className="pipeline-cell" key={stage.key}>
          {index > 0 && (
            <div className="pipeline-link" aria-hidden="true">
              <motion.span
                className="pipeline-link-fill"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: stage.status === "unreached" ? 0.18 : 1 }}
                transition={{ duration: 0.4, delay: index * 0.07, ease: "easeOut" }}
                style={{ background: STATUS_COLOR[stage.status] }}
              />
            </div>
          )}

          <motion.div
            className={`pipeline-node ${stage.status}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
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
              <span className={`badge ${stage.domain === "razorpay" ? "razorpay" : "simulated"}`}>
                <span className="badge-dot" />
                {stage.domain === "razorpay" ? "Razorpay" : "Simulated"}
              </span>
            )}
          </motion.div>
        </div>
      ))}
    </div>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { hourLabel, percent, rupees, titleise } from "../lib/format";
import type { CaseAudit, GuardRule } from "../types";
import { ActionTimeline } from "./ActionTimeline";

const RULE_ICON: Record<string, { glyph: string; color: string; background: string }> = {
  blocked: { glyph: "✕", color: "#f2545b", background: "rgba(242,84,91,0.14)" },
  review: { glyph: "!", color: "#f4b942", background: "rgba(244,185,66,0.14)" },
  automatic: { glyph: "✓", color: "#34d399", background: "rgba(52,211,153,0.14)" },
};

function RuleRow({ rule }: { rule: GuardRule }) {
  const icon = RULE_ICON[rule.decision] ?? RULE_ICON.automatic!;
  return (
    <div className="rule">
      <span
        className="rule-icon"
        style={{ color: icon.color, background: icon.background }}
        aria-hidden="true"
      >
        {icon.glyph}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="rule-name">{rule.rule}</div>
        <div className="rule-detail">{rule.detail}</div>
      </div>
    </div>
  );
}

function sourceBadge(source: string) {
  if (source === "rule") return <span className="badge neutral">deterministic rule</span>;
  if (source === "ai") return <span className="badge razorpay">AI interpreted</span>;
  return <span className="badge amber">safe fallback</span>;
}

export function CaseDetail({ audit }: { audit: CaseAudit }) {
  const decision = audit.decisions[0];
  const guardRules = audit.decisions.flatMap((entry) => entry.guard.rules);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={audit.caseId}
        className="card detail"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="detail-head">
          <div>
            <div className="detail-title">{titleise(audit.diagnosis.failureClass)}</div>
            <div style={{ display: "flex", gap: 7, marginTop: 8, flexWrap: "wrap" }}>
              {sourceBadge(audit.diagnosis.source)}
              <span className="badge neutral">
                confidence {percent(audit.diagnosis.confidence, 0)}
              </span>
              {audit.hasOptedOut && <span className="badge red">opted out</span>}
              {audit.riskScore >= 0.55 && <span className="badge red">high risk</span>}
              {audit.paid ? (
                <span className="badge green">recovered</span>
              ) : (
                <span className="badge neutral">unrecovered</span>
              )}
            </div>
          </div>
          <div className="detail-amount">
            <div className="detail-amount-value">{rupees(audit.amountPaise, 2)}</div>
            <div className="metric-label" style={{ marginTop: 2 }}>
              {audit.incrementalPaise > 0 ? "incremental" : "at risk"}
            </div>
          </div>
        </div>

        <div className="detail-grid">
          <div className="block" style={{ gridColumn: "1 / -1" }}>
            <div className="block-title">Evidence — as Razorpay delivered it</div>
            <div className="evidence">
              entity&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{audit.event.entity}
              <br />
              code&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{audit.event.errorCode ?? "—"}
              <br />
              reason&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{audit.event.errorReason ?? "—"}
              <br />
              source&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{audit.event.errorSource ?? "—"}
              <br />
              step&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{audit.event.errorStep ?? "—"}
              <br />
              description {audit.event.errorDescription}
            </div>
            <div className="rationale">{audit.diagnosis.rationale}</div>
          </div>

          <div className="block">
            <div className="block-title">Decision</div>
            <div className="kv">
              <span className="kv-key">intent</span>
              <span className="kv-val" style={{ maxWidth: "60%" }}>
                {decision?.intent ?? "—"}
              </span>
            </div>
            <div className="kv">
              <span className="kv-key">expected value</span>
              <span className="kv-val">
                {decision === undefined ? "—" : rupees(decision.expectedValuePaise, 0)}
              </span>
            </div>
            <div className="kv">
              <span className="kv-key">risk score</span>
              <span className="kv-val">{audit.riskScore.toFixed(2)}</span>
            </div>
            <div className="kv">
              <span className="kv-key">outcome</span>
              <span className="kv-val">{titleise(decision?.outcome ?? "none")}</span>
            </div>
            {audit.paidAtHour !== null && (
              <div className="kv">
                <span className="kv-key">settled</span>
                <span className="kv-val">{hourLabel(audit.paidAtHour)}</span>
              </div>
            )}
          </div>

          <div className="block">
            <div className="block-title">Safety guard</div>
            {guardRules.length === 0 ? (
              <div className="rule-detail">No rule fired; the action ran automatically.</div>
            ) : (
              guardRules.map((rule, index) => <RuleRow rule={rule} key={`${rule.rule}-${index}`} />)
            )}
          </div>

          <div className="block" style={{ gridColumn: "1 / -1" }}>
            <div className="block-title">
              Action ledger
              <span style={{ color: "var(--faint)", textTransform: "none", letterSpacing: 0 }}>
                — one durable identity per external effect
              </span>
            </div>
            {audit.actions.length === 0 ? (
              <div className="empty">
                No action was taken on this case.
                <br />
                <span style={{ color: "var(--faint)" }}>
                  {audit.decisions[0]?.note ?? "The guard stopped every proposal."}
                </span>
              </div>
            ) : (
              audit.actions.map((action, index) => (
                <ActionTimeline action={action} index={index} key={action.actionKey} />
              ))
            )}
          </div>

          {audit.exceptions.length > 0 && (
            <div className="block" style={{ gridColumn: "1 / -1" }}>
              <div className="block-title">Open exceptions</div>
              {audit.exceptions.map((exception, index) => (
                <div className="rule" key={index}>
                  <span
                    className="rule-icon"
                    style={{ color: "#f4b942", background: "rgba(244,185,66,0.14)" }}
                  >
                    !
                  </span>
                  <div>
                    <div className="rule-name">{exception.kind}</div>
                    <div className="rule-detail">{exception.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

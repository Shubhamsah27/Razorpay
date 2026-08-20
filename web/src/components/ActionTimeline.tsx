import { motion } from "framer-motion";
import { hourLabel, STATE_COLOR, titleise } from "../lib/format";
import type { ActionAudit } from "../types";

function DomainBadge({ domain }: { domain: "simulated" | "razorpay" }) {
  return domain === "razorpay" ? (
    <span className="badge razorpay">
      <span className="badge-dot" />
      Razorpay Test Mode
    </span>
  ) : (
    <span className="badge simulated">
      <span className="badge-dot" />
      Simulated
    </span>
  );
}

export function ActionTimeline({ action, index }: { action: ActionAudit; index: number }) {
  return (
    <motion.div
      className={`action-card ${action.executionDomain}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="action-head">
        <span className="action-kind">{titleise(action.actionKind)}</span>
        <DomainBadge domain={action.executionDomain} />
        {action.reconciled && <span className="badge amber">reconciled</span>}
        {action.customerResponded && <span className="badge green">customer paid</span>}
        <span className="queue-id">attempt {action.attemptNumber}</span>
      </div>

      <div className="kv">
        <span className="kv-key">reference_id</span>
        <span className="kv-val mono">{action.referenceId}</span>
      </div>
      <div className="kv">
        <span className="kv-key">provider id</span>
        <span className="kv-val mono">{action.providerId ?? "—"}</span>
      </div>
      <div className="kv">
        <span className="kv-key">channel · scheduled</span>
        <span className="kv-val">
          {action.channel} · {hourLabel(action.scheduledAtHour)}
        </span>
      </div>
      <div className="kv">
        <span className="kv-key">provider calls</span>
        <span className="kv-val">{action.attemptCount}</span>
      </div>

      <div className="timeline" style={{ marginTop: 14 }}>
        {action.transitions.map((transition, position) => (
          <motion.div
            className="tl-node"
            key={`${transition.to}-${position}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.06 + position * 0.05 + 0.1, duration: 0.26 }}
          >
            <span
              className="tl-dot"
              style={{
                background: STATE_COLOR[transition.to] ?? "#6f7583",
                boxShadow: `0 0 10px ${STATE_COLOR[transition.to] ?? "#6f7583"}66`,
              }}
            />
            <div className="tl-state" style={{ color: STATE_COLOR[transition.to] ?? "#e9eaee" }}>
              {transition.to}
            </div>
            <div className="tl-reason">{transition.reason}</div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

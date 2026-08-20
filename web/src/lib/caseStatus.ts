import type { CaseAudit } from "../types";

export type CaseStatus =
  | "recovered"
  | "reconciled"
  | "organic"
  | "stopped"
  | "unrecovered";

/**
 * True when the guard (or a frozen class / declined review) actually stopped
 * this case.
 *
 * Deliberately NOT `actions.length === 0`: a case can end with no action because
 * it settled organically before the first action was due, which is not the same
 * thing as being blocked.
 */
export function wasStoppedByGuard(audit: CaseAudit): boolean {
  return audit.decisions.some(
    (decision) =>
      decision.outcome === "blocked" ||
      decision.outcome === "rejected" ||
      decision.outcome === "not_supported" ||
      decision.guard.rules.some((rule) => rule.decision === "blocked"),
  );
}

/** The single status a case is shown as, in the queue and in the 3D field. */
export function caseStatus(audit: CaseAudit): CaseStatus {
  if (audit.actions.some((action) => action.reconciled)) return "reconciled";
  if (audit.incrementalPaise > 0) return "recovered";
  if (wasStoppedByGuard(audit) && audit.actions.length === 0) return "stopped";
  if (audit.paid) return "organic";
  return "unrecovered";
}

export const STATUS_COLOR: Record<CaseStatus, string> = {
  recovered: "#7ea0ff",
  reconciled: "#a08a4c",
  organic: "#40566d",
  stopped: "#d1495b",
  unrecovered: "#192839",
};

/** Compact labels for the field legend, which sits in a tight strip. */
export const STATUS_SHORT: Record<CaseStatus, string> = {
  recovered: "Recovered",
  reconciled: "Reconciled",
  organic: "Paid anyway",
  stopped: "Stopped",
  unrecovered: "Unrecovered",
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  recovered: "Recovered by Recoup",
  reconciled: "Reconciled with provider",
  organic: "Would have paid anyway",
  stopped: "Stopped by guard",
  unrecovered: "Unrecovered",
};

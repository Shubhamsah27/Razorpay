import type { CaseLatents, FailureClass, PlannedAction } from "./types";
import { keyedRange } from "../sim/rng";

const NS = "signal";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Everything a policy is allowed to see. Ground-truth latents — whether the
 * customer would have paid anyway, whether the case is really fraud — are
 * deliberately absent, so no arm can peek at the answer it is being scored on.
 */
export interface CaseView {
  caseId: string;
  failureClass: FailureClass;
  amountPaise: number;
  /** Observable: the merchant's own suppression list. */
  hasOptedOut: boolean;
  /** Noisy proxy for engagement, not the latent itself. */
  priorPaymentSuccessRate: number;
  /** Noisy risk signal. Correlated with fraud but not equal to it. */
  riskScore: number;
  /** Known payroll timing for salaried customers, when the merchant has it. */
  payrollWindowHour: number | null;
}

export interface ExecutedAction {
  action: PlannedAction;
  responded: boolean;
  costPaise: number;
}

export interface Policy {
  readonly name: string;
  /**
   * Returns the next action to schedule given what has already been revealed,
   * or null to stop working the case.
   */
  next(view: CaseView, history: ExecutedAction[]): PlannedAction | null;
}

export function toCaseView(masterSeed: string, latents: CaseLatents): CaseView {
  const engagementNoise = keyedRange(NS, masterSeed, -0.22, 0.22, latents.caseId, "engagement");
  const riskNoise = keyedRange(NS, masterSeed, -0.28, 0.28, latents.caseId, "risk");
  const payrollKnown = keyedRange(NS, masterSeed, 0, 1, latents.caseId, "payroll-known") < 0.55;

  return {
    caseId: latents.caseId,
    failureClass: latents.failureClass,
    amountPaise: latents.amountPaise,
    hasOptedOut: latents.optedOut,
    priorPaymentSuccessRate: clamp01(latents.responsiveness + engagementNoise),
    riskScore: clamp01((latents.isFraud ? 0.72 : 0.16) + riskNoise),
    payrollWindowHour: payrollKnown ? latents.salaryWindowHour : null,
  };
}

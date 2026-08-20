import type { CaseLatents, PlannedAction } from "../domain/types";
import { toCaseView, type CaseView, type ExecutedAction } from "../domain/view";
import type { Diagnosis } from "../diagnosis/classifier";
import { dispatch, reconcile, type RecoveryExecutor } from "../execution/executor";
import type { DecisionRecord } from "../policies/recoup";
import type { Policy } from "../domain/view";
import { toTimeBucket, type Oracle } from "../sim/oracle";
import { ActionStore, type ActionState } from "../store/actions";

/** Execution domain of an action, so the UI can never blur simulated and real. */
export type ExecutionDomain = "simulated" | "razorpay";

export function executionDomain(actionKind: string): ExecutionDomain {
  return actionKind.startsWith("razorpay_") ? "razorpay" : "simulated";
}

export interface ActionAudit {
  actionKey: string;
  referenceId: string;
  actionKind: string;
  executionDomain: ExecutionDomain;
  channel: string;
  attemptNumber: number;
  scheduledAtHour: number;
  state: ActionState;
  providerId: string | null;
  transitions: { from: string; to: string; reason: string }[];
  attemptCount: number;
  reconciled: boolean;
  /** Whether the customer responded, drawn from the shared outcome table. */
  customerResponded: boolean;
}

export interface CaseAudit {
  caseId: string;
  amountPaise: number;
  event: CaseView["event"];
  riskScore: number;
  hasOptedOut: boolean;
  diagnosis: Diagnosis;
  decisions: DecisionRecord[];
  actions: ActionAudit[];
  exceptions: { kind: string; detail: string }[];
  paid: boolean;
  paidAtHour: number | null;
  incrementalPaise: number;
}

const BASE_TIME_MS = Date.parse("2026-08-20T10:00:00.000Z");

function scheduledAtIso(hour: number): string {
  return new Date(BASE_TIME_MS + hour * 3_600_000).toISOString();
}

export interface RunCaseOptions {
  store: ActionStore;
  executor: RecoveryExecutor;
  policy: Policy;
  decisions: DecisionRecord[];
  oracle: Oracle;
  masterSeed: string;
  /** Actions above this value require a recorded human approval before running. */
  reviewer?: (action: PlannedAction) => boolean;
}

/**
 * The real runtime path: diagnose, plan, guard, persist a durable action, claim
 * it, call the provider, reconcile anything ambiguous, and record the outcome.
 *
 * Unlike the evaluation simulator this drives the actual store and executor, so
 * what the Recovery Desk shows is a genuine audit trail rather than a mock-up.
 */
export async function runCase(
  latents: CaseLatents,
  options: RunCaseOptions,
): Promise<CaseAudit> {
  const { store, executor, policy, oracle, masterSeed } = options;
  const view = toCaseView(masterSeed, latents);
  const history: ExecutedAction[] = [];
  const audits: ActionAudit[] = [];

  const decisionsBefore = options.decisions.length;
  let paidAtHour: number | null = null;
  let attributedActionKey: string | null = null;

  for (let step = 0; step < 6; step += 1) {
    const planned = policy.next(view, history);
    if (planned === null) break;
    if (paidAtHour !== null && planned.scheduledAtHour >= paidAtHour) break;
    if (latents.organicPayHour !== null && latents.organicPayHour <= planned.scheduledAtHour) {
      paidAtHour = latents.organicPayHour;
      break;
    }

    const row = store.createAction(
      {
        caseId: planned.caseId,
        actionKind: planned.actionKind,
        channel: planned.channel,
        scheduledAt: scheduledAtIso(planned.scheduledAtHour),
        attemptNumber: planned.attemptNumber,
      },
      "planned",
    );

    const needsApproval = options.reviewer?.(planned) ?? false;
    if (needsApproval) {
      store.transition(row.action_key, "awaiting_approval", "guard requested human review");
      store.recordApproval(row.action_key, "approved", "risk_ops", "reviewed in Recovery Desk");
      store.transition(row.action_key, "ready", "approved by risk_ops");
    } else {
      store.transition(row.action_key, "ready", "auto-approved by guard");
    }

    const outcome = await dispatch(store, executor, row.action_key);
    let reconciled = false;
    if (outcome === "outcome_unknown") {
      await reconcile(store, executor, row.action_key);
      reconciled = true;
    }

    const settled = store.get(row.action_key)!;
    const delivered = settled.state === "succeeded";

    // The customer can only respond to an effect that actually reached them.
    const cell = oracle.resolve(latents, {
      caseId: latents.caseId,
      actionKind: planned.actionKind,
      channel: planned.channel,
      timeBucket: toTimeBucket(planned.scheduledAtHour),
      attemptNumber: planned.attemptNumber,
    });
    const responded = delivered && cell.responded;

    audits.push({
      actionKey: settled.action_key,
      referenceId: settled.reference_id,
      actionKind: settled.action_kind,
      executionDomain: executionDomain(settled.action_kind),
      channel: settled.channel,
      attemptNumber: settled.attempt_number,
      scheduledAtHour: planned.scheduledAtHour,
      state: settled.state,
      providerId: settled.provider_id,
      transitions: store
        .transitions(settled.action_key)
        .map((entry) => ({ from: entry.from_state, to: entry.to_state, reason: entry.reason })),
      attemptCount: store.attemptCount(settled.action_key),
      reconciled,
      customerResponded: responded,
    });

    history.push({ action: planned, responded, costPaise: cell.contactCostPaise });

    if (responded) {
      const payHour = planned.scheduledAtHour + cell.responseLagHours;
      const withinWindow = payHour <= planned.scheduledAtHour + planned.attributionWindowHours;
      if (withinWindow) {
        if (latents.organicPayHour !== null && latents.organicPayHour <= payHour) {
          paidAtHour = latents.organicPayHour;
        } else {
          paidAtHour = payHour;
          attributedActionKey = settled.action_key;
        }
      }
    }
  }

  if (paidAtHour === null && latents.organicPayHour !== null) {
    paidAtHour = latents.organicPayHour;
  }

  const caseDecisions = options.decisions.slice(decisionsBefore);
  const diagnosis: Diagnosis = caseDecisions[0]?.diagnosis ?? {
    failureClass: "checkout_abandoned",
    confidence: 0,
    source: "fallback",
    rationale: "no decision was recorded for this case",
  };

  return {
    caseId: latents.caseId,
    amountPaise: latents.amountPaise,
    event: view.event,
    riskScore: view.riskScore,
    hasOptedOut: view.hasOptedOut,
    diagnosis,
    decisions: caseDecisions,
    actions: audits,
    exceptions: store
      .openExceptions()
      .filter((entry) => entry.case_id === latents.caseId)
      .map((entry) => ({ kind: entry.kind, detail: entry.detail })),
    paid: paidAtHour !== null,
    paidAtHour,
    incrementalPaise: attributedActionKey === null ? 0 : latents.amountPaise,
  };
}

import type { PlannedAction } from "../domain/types";
import type { CaseView, ExecutedAction, Policy } from "../domain/view";
import { diagnose, type AmbiguityInterpreter, type Diagnosis } from "../diagnosis/classifier";
import { fixtureInterpreter } from "../diagnosis/interpreter";
import {
  DEFAULT_GUARD_CONFIG,
  evaluateGuard,
  nextContactableHour,
  type GuardConfig,
  type GuardResult,
} from "../policy/guard";
import { chooseChannel, planFor } from "../policy/plans";

/** Hours a queued human review takes to come back. */
const REVIEW_LATENCY_HOURS = 4;
/** A reviewer rejects anything this risky, even when the value looks good. */
const REVIEW_REJECT_RISK = 0.5;

export type DecisionOutcome = "approved" | "blocked" | "rejected" | "not_supported";

export interface DecisionRecord {
  caseId: string;
  attemptNumber: number;
  diagnosis: Diagnosis;
  intent: string;
  actionKind: string;
  channel: string;
  scheduledAtHour: number;
  expectedValuePaise: number;
  guard: GuardResult;
  outcome: DecisionOutcome;
  note: string;
}

export interface RecoupPolicyOptions {
  interpreter?: AmbiguityInterpreter | null;
  guardConfig?: GuardConfig;
}

export interface RecoupPolicyBundle {
  policy: Policy;
  /** Append-only audit of every decision, including the ones that took no action. */
  decisions: DecisionRecord[];
}

export function createRecoupPolicy(options: RecoupPolicyOptions = {}): RecoupPolicyBundle {
  const interpreter = options.interpreter === undefined ? fixtureInterpreter : options.interpreter;
  const guardConfig = options.guardConfig ?? DEFAULT_GUARD_CONFIG;
  const decisions: DecisionRecord[] = [];

  const policy: Policy = {
    name: "recoup",

    next(view: CaseView, history: ExecutedAction[]): PlannedAction | null {
      const diagnosis = diagnose(view.event, interpreter);
      const plan = planFor(diagnosis.failureClass);
      const attemptNumber = history.length + 1;

      if (plan.maxAttempts === 0) {
        if (attemptNumber === 1) {
          decisions.push({
            caseId: view.caseId,
            attemptNumber,
            diagnosis,
            intent: plan.intent,
            actionKind: plan.actionKind,
            channel: "none",
            scheduledAtHour: 0,
            expectedValuePaise: 0,
            guard: {
              decision: "blocked",
              deferToHour: null,
              rules: [
                {
                  rule: "frozen_class",
                  decision: "blocked",
                  detail: plan.intent,
                },
              ],
            },
            outcome: "not_supported",
            note: plan.intent,
          });
        }
        return null;
      }

      if (attemptNumber > plan.maxAttempts) return null;

      const previous = history[history.length - 1];
      const baseHour =
        previous === undefined
          ? plan.firstActionDelayHours
          : previous.action.scheduledAtHour + plan.spacingHours;

      // Move an insufficient_funds nudge onto the customer's payroll window when
      // the merchant actually knows it.
      const scheduledAtHour =
        diagnosis.failureClass === "insufficient_funds" &&
        view.payrollWindowHour !== null &&
        attemptNumber === 1
          ? Math.max(plan.firstActionDelayHours, view.payrollWindowHour)
          : baseHour;

      const { channel, expectedValuePaise } = chooseChannel(
        view,
        diagnosis.failureClass,
        plan,
        scheduledAtHour,
        attemptNumber,
      );

      const candidate: PlannedAction = {
        actionId: `${view.caseId}:${plan.actionKind}:${attemptNumber}`,
        caseId: view.caseId,
        actionKind: plan.actionKind,
        channel,
        scheduledAtHour,
        attemptNumber,
        attributionWindowHours: plan.attributionWindowHours,
      };

      const guard = evaluateGuard(
        view,
        diagnosis,
        candidate,
        history,
        expectedValuePaise,
        guardConfig,
      );

      const record = (outcome: DecisionOutcome, note: string): void => {
        decisions.push({
          caseId: view.caseId,
          attemptNumber,
          diagnosis,
          intent: plan.intent,
          actionKind: plan.actionKind,
          channel,
          scheduledAtHour,
          expectedValuePaise,
          guard,
          outcome,
          note,
        });
      };

      if (guard.decision === "blocked") {
        record("blocked", guard.rules.find((rule) => rule.decision === "blocked")?.detail ?? "");
        return null;
      }

      let finalHour = guard.deferToHour ?? scheduledAtHour;

      if (guard.decision === "review") {
        if (view.riskScore >= REVIEW_REJECT_RISK) {
          record("rejected", "reviewer declined the action");
          return null;
        }
        // Approval costs time, and the action executes only after it lands. The
        // wait can push it back into quiet hours, so the timing rule is applied
        // again rather than trusting the pre-approval check.
        finalHour = nextContactableHour(finalHour + REVIEW_LATENCY_HOURS, guardConfig);
      }

      const approved: PlannedAction = { ...candidate, scheduledAtHour: finalHour };
      record("approved", guard.decision === "review" ? "approved by reviewer" : "auto-approved");
      return approved;
    },
  };

  return { policy, decisions };
}

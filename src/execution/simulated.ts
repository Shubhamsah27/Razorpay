import { keyedUnit } from "../sim/rng";
import type { ActionRow } from "../store/actions";
import type { ExecutionResult, ReconciliationResult, RecoveryExecutor } from "./executor";

export interface SimulatedFaults {
  /** Share of calls that return an ambiguous result. */
  indeterminateRate: number;
  /** Share of calls that fail definitively. */
  failureRate: number;
  /** Of the ambiguous calls, the share where the effect did land. */
  landedWhenIndeterminateRate: number;
}

export const NO_FAULTS: SimulatedFaults = {
  indeterminateRate: 0,
  failureRate: 0,
  landedWhenIndeterminateRate: 0,
};

/**
 * Stands in for a provider without leaving the process. Faults are drawn from
 * the action key, so a given action always fails the same way and the demo is
 * reproducible.
 *
 * The provider's hidden truth is tracked separately from what the caller is
 * told, which is what lets the reconciliation path be exercised honestly: the
 * executor can say "I don't know" while the simulated provider does know.
 */
export function createSimulatedExecutor(
  seed: string,
  faults: SimulatedFaults = NO_FAULTS,
  name = "simulated",
): RecoveryExecutor & { landed: Set<string> } {
  const landed = new Set<string>();

  return {
    name,
    landed,

    async execute(action: ActionRow): Promise<ExecutionResult> {
      const draw = keyedUnit("exec", seed, action.action_key);

      if (draw < faults.failureRate) {
        return { status: "failed", code: "SIMULATED_VALIDATION_ERROR", retryable: false };
      }

      if (draw < faults.failureRate + faults.indeterminateRate) {
        const didLand =
          keyedUnit("exec-landed", seed, action.action_key) < faults.landedWhenIndeterminateRate;
        if (didLand) landed.add(action.reference_id);
        return { status: "outcome_unknown", reason: "simulated network timeout" };
      }

      landed.add(action.reference_id);
      return {
        status: "succeeded",
        providerId: `sim_${action.action_key.slice(0, 12)}`,
        safeResponse: { reference_id: action.reference_id, status: "created" },
      };
    },

    async reconcile(action: ActionRow): Promise<ReconciliationResult> {
      if (landed.has(action.reference_id)) {
        return {
          status: "found",
          providerId: `sim_${action.action_key.slice(0, 12)}`,
          providerStatus: "created",
        };
      }
      return { status: "not_found" };
    },
  };
}

/**
 * Simulated messaging. Recoup never sends real customer messages, so this writes
 * to a ledger instead of a channel.
 */
export function createContactExecutor(
  ledger: { actionKey: string; channel: string; sentAt: string }[],
): RecoveryExecutor {
  return {
    name: "simulated_contact",

    async execute(action: ActionRow): Promise<ExecutionResult> {
      ledger.push({
        actionKey: action.action_key,
        channel: action.channel,
        sentAt: new Date().toISOString(),
      });
      return {
        status: "succeeded",
        providerId: `msg_${action.action_key.slice(0, 12)}`,
        safeResponse: { channel: action.channel },
      };
    },

    async reconcile(action: ActionRow): Promise<ReconciliationResult> {
      const entry = ledger.find((row) => row.actionKey === action.action_key);
      return entry === undefined
        ? { status: "not_found" }
        : {
            status: "found",
            providerId: `msg_${action.action_key.slice(0, 12)}`,
            providerStatus: "sent",
          };
    },
  };
}

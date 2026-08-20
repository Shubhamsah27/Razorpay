import type { ActionRow, ActionStore } from "../store/actions";

export type ExecutionResult =
  | { status: "succeeded"; providerId: string; safeResponse: Record<string, unknown> }
  | { status: "failed"; code: string; retryable: boolean }
  | { status: "outcome_unknown"; reason: string };

export type ReconciliationResult =
  | { status: "found"; providerId: string; providerStatus: string }
  | { status: "not_found" }
  | { status: "unknown"; reason: string };

export interface RecoveryExecutor {
  readonly name: string;
  execute(action: ActionRow): Promise<ExecutionResult>;
  reconcile(action: ActionRow): Promise<ReconciliationResult>;
}

export type DispatchOutcome =
  | "not_claimed"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "reconciled_succeeded"
  | "reconciled_failed"
  | "exception";

/**
 * Claim, call, and record. The claim happens in its own committed transaction
 * before the provider is contacted, so a crash at any point after this leaves a
 * durable record that the call may have gone out.
 */
export async function dispatch(
  store: ActionStore,
  executor: RecoveryExecutor,
  actionKey: string,
  leaseSeconds = 60,
): Promise<DispatchOutcome> {
  const { claimed } = store.claim(actionKey, leaseSeconds);
  if (!claimed) return "not_claimed";

  const action = store.get(actionKey);
  if (action === null) return "not_claimed";

  let result: ExecutionResult;
  try {
    result = await executor.execute(action);
  } catch (error) {
    // A thrown error tells us nothing about whether the provider acted, so it is
    // treated as unknown rather than as a failure we could safely repeat.
    result = { status: "outcome_unknown", reason: String(error) };
  }

  if (result.status === "succeeded") {
    store.markSucceeded(actionKey, result.providerId, JSON.stringify(result.safeResponse));
    return "succeeded";
  }

  if (result.status === "failed") {
    store.markFailed(actionKey, `${result.code} (retryable=${result.retryable})`);
    return "failed";
  }

  store.markOutcomeUnknown(actionKey, result.reason);
  return "outcome_unknown";
}

/**
 * Resolve an action whose provider outcome is unknown.
 *
 * This never re-sends the original request. It asks the provider what exists
 * under the action's unique reference, because the first call may already have
 * created it.
 */
export async function reconcile(
  store: ActionStore,
  executor: RecoveryExecutor,
  actionKey: string,
): Promise<DispatchOutcome> {
  const action = store.get(actionKey);
  if (action === null) return "exception";
  if (action.state !== "outcome_unknown" && action.state !== "reconciling") return "not_claimed";

  if (action.state === "outcome_unknown") store.beginReconciliation(actionKey);

  let result: ReconciliationResult;
  try {
    result = await executor.reconcile(action);
  } catch (error) {
    result = { status: "unknown", reason: String(error) };
  }

  if (result.status === "found") {
    store.recordReconciliation(actionKey, "found", result.providerId, result.providerStatus, "");
    store.markSucceeded(actionKey, result.providerId, "attached by reconciliation");
    return "reconciled_succeeded";
  }

  if (result.status === "not_found") {
    // The provider never created anything, so the effect definitively did not
    // happen and a fresh attempt is safe.
    store.recordReconciliation(actionKey, "not_found", null, null, "no matching reference");
    store.markFailed(actionKey, "provider has no record of this reference");
    return "reconciled_failed";
  }

  store.recordReconciliation(actionKey, "unknown", null, null, result.reason);
  store.raiseException(
    action.case_id,
    actionKey,
    "unresolved_provider_outcome",
    `reconciliation could not establish the outcome: ${result.reason}`,
  );
  return "exception";
}

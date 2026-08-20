import type { PlannedAction } from "../domain/types";
import type { CaseView, ExecutedAction, Policy } from "../domain/view";

const RETRY_INTERVAL_HOURS = 24;
const MAX_RETRIES = 3;
const RETRY_ATTRIBUTION_WINDOW_HOURS = 6;

/**
 * The industry-standard naive baseline: retry three times, 24 hours apart, on
 * every failure regardless of cause. These retries are simulator events only —
 * Recoup never issues a merchant-initiated card retry through Razorpay.
 */
export const fixedRetryPolicy: Policy = {
  name: "fixed_retry_3x24h",

  next(view: CaseView, history: ExecutedAction[]): PlannedAction | null {
    const attemptNumber = history.length + 1;
    if (attemptNumber > MAX_RETRIES) return null;

    return {
      actionId: `${view.caseId}:retry:${attemptNumber}`,
      caseId: view.caseId,
      actionKind: "simulated_retry",
      channel: "none",
      scheduledAtHour: attemptNumber * RETRY_INTERVAL_HOURS,
      attemptNumber,
      attributionWindowHours: RETRY_ATTRIBUTION_WINDOW_HOURS,
    };
  },
};

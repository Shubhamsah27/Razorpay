import {
  TIME_BUCKET_HOURS,
  type ActionKind,
  type ActionOutcome,
  type CaseLatents,
  type OutcomeKey,
} from "../domain/types";
import { CHANNEL_COST_PAISE, CHANNEL_EFFECTIVENESS, FAILURE_CLASS_PROFILES } from "./profiles";
import { keyedRange, keyedUnit } from "./rng";

const NS = "outcome";

/** Gateway cost of one merchant-initiated attempt, successful or not. */
const RETRY_ATTEMPT_COST_PAISE = 250;

const MAX_RESPONSE_PROBABILITY = 0.95;
const ATTEMPT_DECAY = 0.62;

export function toTimeBucket(hoursSinceFailure: number): number {
  return Math.max(0, Math.floor(hoursSinceFailure / TIME_BUCKET_HOURS));
}

function baseProbability(latents: CaseLatents, actionKind: ActionKind): number {
  const profile = FAILURE_CLASS_PROFILES[latents.failureClass];
  switch (actionKind) {
    case "simulated_retry":
      return profile.retrySuccessProb;
    case "razorpay_payment_link":
      return profile.paymentLinkProb;
    case "simulated_contact":
      return profile.contactOnlyProb;
    case "razorpay_subscription_observation":
      // Razorpay owns the recurring retry. Observing it changes nothing, so the
      // case can only resolve through its organic path.
      return 0;
  }
}

/**
 * How the passage of time moves conversion for this failure class. Depends only
 * on the case's own latents and the bucket in the key, never on what other
 * actions have already run.
 */
function timingMultiplier(latents: CaseLatents, timeBucket: number): number {
  const profile = FAILURE_CLASS_PROFILES[latents.failureClass];
  const hours = timeBucket * TIME_BUCKET_HOURS;

  if (latents.failureClass === "insufficient_funds") {
    const distance = Math.abs(hours - latents.salaryWindowHour);
    if (distance <= 24) return 1.75;
    return hours < latents.salaryWindowHour ? 0.45 : 0.85;
  }

  if (profile.retryImprovesWithTime) {
    // Transient outage clears: weak immediately, recovering over roughly 2 days.
    return 0.35 + 0.95 * (1 - Math.exp(-hours / 30));
  }

  if (latents.failureClass === "otp_timeout" || latents.failureClass === "three_ds_drop") {
    // Purchase intent is hot for a few hours and then gone.
    return 0.55 + 0.85 * Math.exp(-hours / 20);
  }

  if (latents.failureClass === "checkout_abandoned") {
    return 0.5 + 0.8 * Math.exp(-hours / 48);
  }

  return 0.75 + 0.45 * Math.exp(-hours / 120);
}

function actionCostPaise(key: OutcomeKey): number {
  if (key.actionKind === "simulated_retry") return RETRY_ATTEMPT_COST_PAISE;
  if (key.actionKind === "razorpay_subscription_observation") return 0;
  return CHANNEL_COST_PAISE[key.channel] ?? 0;
}

export interface Oracle {
  responseProbability(latents: CaseLatents, key: OutcomeKey): number;
  resolve(latents: CaseLatents, key: OutcomeKey): ActionOutcome;
}

/**
 * The potential-outcome table. Conceptually every cell is drawn before any
 * policy runs; deriving each cell from a hash of its key is a lazy
 * materialisation of that table. An action reveals a cell, it never creates one,
 * so no arm can disturb another arm's draws.
 */
export function createOracle(masterSeed: string): Oracle {
  function responseProbability(latents: CaseLatents, key: OutcomeKey): number {
    if (latents.optedOut && key.actionKind !== "simulated_retry") return 0;

    const responsivenessMultiplier = 0.35 + 1.3 * latents.responsiveness;
    const probability =
      baseProbability(latents, key.actionKind) *
      (CHANNEL_EFFECTIVENESS[key.channel] ?? 1) *
      responsivenessMultiplier *
      ATTEMPT_DECAY ** (key.attemptNumber - 1) *
      timingMultiplier(latents, key.timeBucket);

    return Math.min(MAX_RESPONSE_PROBABILITY, Math.max(0, probability));
  }

  return {
    responseProbability,

    resolve(latents, key) {
      const parts = [
        key.caseId,
        key.actionKind,
        key.channel,
        key.timeBucket,
        key.attemptNumber,
      ] as const;

      const profile = FAILURE_CLASS_PROFILES[latents.failureClass];
      const isContact =
        key.actionKind === "simulated_contact" || key.actionKind === "razorpay_payment_link";

      // A merchant-initiated retry settles at once; a customer-initiated path
      // waits on the customer.
      const [lagMin, lagMax] =
        key.actionKind === "simulated_retry" ? [0, 0.5] : profile.responseLagHours;

      return {
        responded: keyedUnit(NS, masterSeed, ...parts) < responseProbability(latents, key),
        responseLagHours: keyedRange(NS, masterSeed, lagMin, lagMax, ...parts, "lag"),
        negativeResponse:
          isContact && (latents.optedOut || key.attemptNumber > latents.fatigueTolerance),
        contactCostPaise: actionCostPaise(key),
      };
    },
  };
}

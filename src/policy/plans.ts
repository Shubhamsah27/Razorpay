import { CHANNELS, type ActionKind, type Channel, type FailureClass } from "../domain/types";
import type { CaseView } from "../domain/view";
import { expectedValuePaise } from "./beliefs";

export interface RecoveryPlan {
  actionKind: ActionKind;
  /** Null when no action of any kind is supported for this class. */
  channel: Channel | null;
  firstActionDelayHours: number;
  spacingHours: number;
  maxAttempts: number;
  attributionWindowHours: number;
  intent: string;
}

/**
 * The supported recovery action per failure class. Every collection path here is
 * customer-initiated; none of them re-charges a card on the merchant's behalf.
 */
const PLANS: Record<FailureClass, RecoveryPlan> = {
  issuer_down: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 30,
    spacingHours: 36,
    maxAttempts: 2,
    attributionWindowHours: 72,
    intent: "Offer a customer-initiated Payment Link once the issuer outage has cleared",
  },
  gateway_timeout: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 24,
    spacingHours: 36,
    maxAttempts: 2,
    attributionWindowHours: 72,
    intent: "Wait for the final status, then offer a Payment Link if still unpaid",
  },
  insufficient_funds: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 72,
    spacingHours: 48,
    maxAttempts: 2,
    attributionWindowHours: 96,
    intent: "Schedule a Payment Link nudge near the customer's salary window",
  },
  otp_timeout: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 1,
    spacingHours: 24,
    maxAttempts: 2,
    attributionWindowHours: 48,
    intent: "Offer a fresh Payment Link while purchase intent is still warm",
  },
  three_ds_drop: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 1,
    spacingHours: 24,
    maxAttempts: 2,
    attributionWindowHours: 48,
    intent: "Offer a fresh Payment Link so the customer can retry authentication",
  },
  do_not_honour: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 12,
    spacingHours: 36,
    maxAttempts: 1,
    attributionWindowHours: 72,
    intent: "Offer another payment method through a Payment Link",
  },
  card_expired: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 3,
    spacingHours: 48,
    maxAttempts: 2,
    attributionWindowHours: 96,
    intent: "Request customer-initiated payment-method recovery",
  },
  mandate_revoked: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 6,
    spacingHours: 48,
    maxAttempts: 1,
    attributionWindowHours: 120,
    intent: "Request reauthorisation; always requires human review",
  },
  suspected_fraud: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 0,
    spacingHours: 0,
    maxAttempts: 0,
    attributionWindowHours: 0,
    intent: "Freeze the case: no retry, no contact, no collection",
  },
  checkout_abandoned: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 2,
    spacingHours: 30,
    maxAttempts: 2,
    attributionWindowHours: 72,
    intent: "Create and send a recovery Payment Link",
  },
  subscription_pending: {
    actionKind: "razorpay_subscription_observation",
    channel: "none",
    firstActionDelayHours: 6,
    spacingHours: 0,
    maxAttempts: 1,
    attributionWindowHours: 0,
    intent: "Observe Razorpay's own retries; do not intervene in parallel",
  },
  subscription_halted: {
    actionKind: "razorpay_payment_link",
    channel: null,
    firstActionDelayHours: 6,
    spacingHours: 48,
    maxAttempts: 2,
    attributionWindowHours: 120,
    intent: "Request customer action now that Razorpay's retries are exhausted",
  },
  invoice_overdue: {
    actionKind: "simulated_contact",
    channel: null,
    firstActionDelayHours: 12,
    spacingHours: 48,
    maxAttempts: 3,
    attributionWindowHours: 120,
    intent: "Send an escalating reminder sequence",
  },
};

export function planFor(failureClass: FailureClass): RecoveryPlan {
  return PLANS[failureClass];
}

const SELECTABLE_CHANNELS = CHANNELS.filter((channel) => channel !== "none");

/**
 * Picks the channel with the best expected value rather than a fixed default,
 * so a cheap email is used on small balances and a costlier high-conversion
 * channel is reserved for amounts that justify it.
 */
export function chooseChannel(
  view: CaseView,
  failureClass: FailureClass,
  plan: RecoveryPlan,
  scheduledAtHour: number,
  attemptNumber: number,
): { channel: Channel; expectedValuePaise: number } {
  if (plan.channel !== null) {
    return {
      channel: plan.channel,
      expectedValuePaise: expectedValuePaise(
        view,
        failureClass,
        plan.actionKind,
        plan.channel,
        scheduledAtHour,
        attemptNumber,
      ),
    };
  }

  let best: { channel: Channel; expectedValuePaise: number } = {
    channel: "email",
    expectedValuePaise: Number.NEGATIVE_INFINITY,
  };
  for (const channel of SELECTABLE_CHANNELS) {
    const value = expectedValuePaise(
      view,
      failureClass,
      plan.actionKind,
      channel,
      scheduledAtHour,
      attemptNumber,
    );
    if (value > best.expectedValuePaise) best = { channel, expectedValuePaise: value };
  }
  return best;
}

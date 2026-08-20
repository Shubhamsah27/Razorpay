import type { ActionKind, Channel, FailureClass } from "../domain/types";
import type { CaseView } from "../domain/view";

/**
 * The policy's own approximate model of the world.
 *
 * These coefficients are deliberately NOT the generative model in `src/sim`.
 * A production recovery system only ever has an estimate, and letting the policy
 * read the true probabilities would make the evaluation meaningless. Recoup must
 * win on decision quality under uncertainty, not on privileged information.
 */
interface ClassBelief {
  /** Believed Payment Link conversion at a good moment. */
  linkConversion: number;
  /** Believed conversion of a reminder with no collection surface. */
  contactConversion: number;
  /** Hours to wait before the first action. */
  preferredDelayHours: number;
  /** Whether waiting helps, because the blocking condition is transient. */
  improvesWithTime: boolean;
  /** Whether a customer-initiated collection path can help at all. */
  actionable: boolean;
}

const BELIEFS: Record<FailureClass, ClassBelief> = {
  issuer_down: {
    linkConversion: 0.4,
    contactConversion: 0.16,
    preferredDelayHours: 30,
    improvesWithTime: true,
    actionable: true,
  },
  gateway_timeout: {
    linkConversion: 0.38,
    contactConversion: 0.15,
    preferredDelayHours: 24,
    improvesWithTime: true,
    actionable: true,
  },
  insufficient_funds: {
    linkConversion: 0.3,
    contactConversion: 0.13,
    preferredDelayHours: 72,
    improvesWithTime: true,
    actionable: true,
  },
  otp_timeout: {
    linkConversion: 0.5,
    contactConversion: 0.2,
    preferredDelayHours: 1,
    improvesWithTime: false,
    actionable: true,
  },
  three_ds_drop: {
    linkConversion: 0.45,
    contactConversion: 0.18,
    preferredDelayHours: 1,
    improvesWithTime: false,
    actionable: true,
  },
  do_not_honour: {
    linkConversion: 0.26,
    contactConversion: 0.1,
    preferredDelayHours: 12,
    improvesWithTime: false,
    actionable: true,
  },
  card_expired: {
    linkConversion: 0.36,
    contactConversion: 0.15,
    preferredDelayHours: 3,
    improvesWithTime: false,
    actionable: true,
  },
  mandate_revoked: {
    linkConversion: 0.2,
    contactConversion: 0.11,
    preferredDelayHours: 6,
    improvesWithTime: false,
    actionable: true,
  },
  suspected_fraud: {
    linkConversion: 0.0,
    contactConversion: 0.0,
    preferredDelayHours: 0,
    improvesWithTime: false,
    actionable: false,
  },
  checkout_abandoned: {
    linkConversion: 0.33,
    contactConversion: 0.14,
    preferredDelayHours: 2,
    improvesWithTime: false,
    actionable: true,
  },
  subscription_pending: {
    linkConversion: 0.18,
    contactConversion: 0.08,
    preferredDelayHours: 96,
    improvesWithTime: true,
    actionable: false,
  },
  subscription_halted: {
    linkConversion: 0.27,
    contactConversion: 0.12,
    preferredDelayHours: 6,
    improvesWithTime: false,
    actionable: true,
  },
  invoice_overdue: {
    linkConversion: 0.34,
    contactConversion: 0.22,
    preferredDelayHours: 12,
    improvesWithTime: false,
    actionable: true,
  },
};

const BELIEVED_CHANNEL_LIFT: Record<Channel, number> = {
  none: 1.0,
  sms: 0.9,
  email: 0.78,
  whatsapp: 1.1,
};

const BELIEVED_CHANNEL_COST_PAISE: Record<Channel, number> = {
  none: 0,
  sms: 18,
  email: 2,
  whatsapp: 65,
};

const BELIEVED_ATTEMPT_DECAY = 0.6;

/**
 * Believed chance that the Nth contact irritates the customer into leaving.
 * Indexed by attempt number; the first approach is treated as free.
 */
const BELIEVED_FATIGUE_RISK = [0, 0, 0.28, 0.55, 0.8];

/** Believed value of the relationship, as a multiple of the amount at risk. */
const BELIEVED_CUSTOMER_VALUE_MULTIPLE = 1.25;

function believedFatigueRisk(attemptNumber: number): number {
  return BELIEVED_FATIGUE_RISK[attemptNumber] ?? 0.9;
}

export function beliefFor(failureClass: FailureClass): ClassBelief {
  return BELIEFS[failureClass];
}

function believedTiming(belief: ClassBelief, view: CaseView, scheduledAtHour: number): number {
  if (view.payrollWindowHour !== null) {
    const distance = Math.abs(scheduledAtHour - view.payrollWindowHour);
    if (distance <= 24) return 1.6;
  }
  if (belief.improvesWithTime) {
    return 0.4 + 0.9 * (1 - Math.exp(-scheduledAtHour / 34));
  }
  return 0.6 + 0.8 * Math.exp(-scheduledAtHour / 26);
}

export function estimateConversion(
  view: CaseView,
  failureClass: FailureClass,
  actionKind: ActionKind,
  channel: Channel,
  scheduledAtHour: number,
  attemptNumber: number,
): number {
  const belief = BELIEFS[failureClass];
  if (!belief.actionable) return 0;

  const base =
    actionKind === "razorpay_payment_link"
      ? belief.linkConversion
      : actionKind === "simulated_contact"
        ? belief.contactConversion
        : 0;

  const engagement = 0.45 + 1.2 * view.priorPaymentSuccessRate;
  const estimate =
    base *
    engagement *
    BELIEVED_CHANNEL_LIFT[channel] *
    BELIEVED_ATTEMPT_DECAY ** (attemptNumber - 1) *
    believedTiming(belief, view, scheduledAtHour);

  return Math.min(0.9, Math.max(0, estimate));
}

export interface ValueBreakdown {
  incrementalConversion: number;
  grossValuePaise: number;
  channelCostPaise: number;
  /** Expected relationship damage from pressing an already-contacted customer. */
  fatigueCostPaise: number;
  expectedValuePaise: number;
}

/**
 * Expected value of an action in paise, net of three costs: the channel spend,
 * the chance we are paying to reach someone who would have paid anyway, and the
 * relationship damage of contacting the same person again.
 *
 * Pricing fatigue is what stops the policy from degenerating into "contact
 * everyone repeatedly", which buys revenue with customer lifetime value.
 */
export function valueBreakdown(
  view: CaseView,
  failureClass: FailureClass,
  actionKind: ActionKind,
  channel: Channel,
  scheduledAtHour: number,
  attemptNumber: number,
): ValueBreakdown {
  const conversion = estimateConversion(
    view,
    failureClass,
    actionKind,
    channel,
    scheduledAtHour,
    attemptNumber,
  );
  // Believed chance the customer resolves on their own, which makes any spend on
  // them pure waste. Higher engagement means a higher chance of self-recovery.
  const believedOrganic = 0.1 + 0.28 * view.priorPaymentSuccessRate;
  const incrementalConversion = Math.max(0, conversion * (1 - believedOrganic));

  const grossValuePaise = incrementalConversion * view.amountPaise;
  const channelCostPaise = BELIEVED_CHANNEL_COST_PAISE[channel];
  const fatigueCostPaise =
    believedFatigueRisk(attemptNumber) *
    BELIEVED_CUSTOMER_VALUE_MULTIPLE *
    view.amountPaise;

  return {
    incrementalConversion,
    grossValuePaise,
    channelCostPaise,
    fatigueCostPaise,
    expectedValuePaise: grossValuePaise - channelCostPaise - fatigueCostPaise,
  };
}

export function expectedValuePaise(
  view: CaseView,
  failureClass: FailureClass,
  actionKind: ActionKind,
  channel: Channel,
  scheduledAtHour: number,
  attemptNumber: number,
): number {
  return valueBreakdown(
    view,
    failureClass,
    actionKind,
    channel,
    scheduledAtHour,
    attemptNumber,
  ).expectedValuePaise;
}

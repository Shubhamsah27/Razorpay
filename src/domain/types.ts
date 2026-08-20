export const FAILURE_CLASSES = [
  "issuer_down",
  "gateway_timeout",
  "insufficient_funds",
  "otp_timeout",
  "three_ds_drop",
  "do_not_honour",
  "card_expired",
  "mandate_revoked",
  "suspected_fraud",
  "checkout_abandoned",
  "subscription_pending",
  "subscription_halted",
  "invoice_overdue",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

/**
 * Execution domain of an action. The UI and report must never present a
 * `simulated_*` action as something Razorpay performed.
 */
export const ACTION_KINDS = [
  "simulated_retry",
  "simulated_contact",
  "razorpay_payment_link",
  "razorpay_subscription_observation",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export const CHANNELS = ["none", "sms", "email", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Hours per outcome time bucket. Bucketing keeps the outcome table finite. */
export const TIME_BUCKET_HOURS = 6;

/** Simulation horizon after the originating failure event. */
export const HORIZON_HOURS = 14 * 24;

export interface OutcomeKey {
  caseId: string;
  actionKind: ActionKind;
  channel: Channel;
  timeBucket: number;
  attemptNumber: number;
}

/**
 * Immutable per-case ground truth, drawn once from the master seed. Nothing a
 * policy does may alter these values.
 */
export interface CaseLatents {
  caseId: string;
  failureClass: FailureClass;
  amountPaise: number;
  /** Hours after the failure at which the customer pays unprompted, or null. */
  organicPayHour: number | null;
  isFraud: boolean;
  /** Latent willingness to act on any recovery attempt, 0..1. */
  responsiveness: number;
  /** Number of contacts this customer tolerates before reacting negatively. */
  fatigueTolerance: number;
  optedOut: boolean;
  /** Day of month funds typically arrive; drives insufficient_funds timing. */
  salaryDayOfMonth: number;
  /** Hours from the failure to the start of the case's salary window. */
  salaryWindowHour: number;
  /** Value destroyed when this customer churns after over-contacting. */
  churnPenaltyPaise: number;
  createdAtHour: number;
}

export interface ActionOutcome {
  responded: boolean;
  /** Hours after the action's scheduled time at which payment lands. */
  responseLagHours: number;
  negativeResponse: boolean;
  contactCostPaise: number;
}

export interface PlannedAction {
  actionId: string;
  caseId: string;
  actionKind: ActionKind;
  channel: Channel;
  /** Hours after the originating failure event. */
  scheduledAtHour: number;
  attemptNumber: number;
  /** Hours after scheduledAtHour during which a payment may be credited. */
  attributionWindowHours: number;
}

export interface CaseArmOutcome {
  caseId: string;
  paid: boolean;
  paidAtHour: number | null;
  paidAmountPaise: number;
  /** Null when the customer would have paid anyway. */
  attributedActionId: string | null;
  incrementalAmountPaise: number;
  actionCostPaise: number;
  churnPenaltyPaise: number;
  /** Reversal plus fee when money was collected on a fraudulent case. */
  chargebackPenaltyPaise: number;
  netValuePaise: number;
  contactsMade: number;
  falsePositiveContacts: number;
  /** True when this arm collected money on a case that is actually fraud. */
  fraudulentCollection: boolean;
  /** True when this arm chose to take no collection action on a fraud case. */
  fraudCorrectlyAvoided: boolean;
  actions: PlannedAction[];
}

export interface ArmResult {
  armName: string;
  cases: CaseArmOutcome[];
}

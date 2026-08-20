import type { FailureClass } from "../domain/types";

export interface FailureClassProfile {
  /** Relative frequency in the generated population. */
  weight: number;
  /** Chance the customer pays unprompted within the horizon. */
  organicPayProb: number;
  organicLagHours: [number, number];
  fraudProb: number;
  /**
   * Chance a merchant-initiated retry succeeds. Only the simulated fixed-policy
   * arm uses this; Recoup never issues such a retry through Razorpay.
   */
  retrySuccessProb: number;
  /** Retry success improves as the transient condition clears. */
  retryImprovesWithTime: boolean;
  /** Base conversion of a customer-initiated Payment Link. */
  paymentLinkProb: number;
  /** Base conversion of a reminder with no collection surface attached. */
  contactOnlyProb: number;
  /** Payment lands this long after the customer engages. */
  responseLagHours: [number, number];
  amountPaiseRange: [number, number];
}

const RUPEE = 100;

export const FAILURE_CLASS_PROFILES: Record<FailureClass, FailureClassProfile> = {
  issuer_down: {
    weight: 10,
    organicPayProb: 0.34,
    organicLagHours: [6, 96],
    fraudProb: 0.005,
    retrySuccessProb: 0.28,
    retryImprovesWithTime: true,
    paymentLinkProb: 0.46,
    contactOnlyProb: 0.18,
    responseLagHours: [0.5, 10],
    amountPaiseRange: [499 * RUPEE, 24_999 * RUPEE],
  },
  gateway_timeout: {
    weight: 7,
    organicPayProb: 0.3,
    organicLagHours: [2, 72],
    fraudProb: 0.01,
    retrySuccessProb: 0.24,
    retryImprovesWithTime: true,
    paymentLinkProb: 0.42,
    contactOnlyProb: 0.16,
    responseLagHours: [0.5, 8],
    amountPaiseRange: [299 * RUPEE, 19_999 * RUPEE],
  },
  insufficient_funds: {
    weight: 14,
    organicPayProb: 0.22,
    organicLagHours: [24, 240],
    fraudProb: 0.004,
    retrySuccessProb: 0.09,
    retryImprovesWithTime: true,
    paymentLinkProb: 0.31,
    contactOnlyProb: 0.14,
    responseLagHours: [1, 24],
    amountPaiseRange: [199 * RUPEE, 9_999 * RUPEE],
  },
  otp_timeout: {
    weight: 12,
    organicPayProb: 0.29,
    organicLagHours: [1, 48],
    fraudProb: 0.012,
    retrySuccessProb: 0.05,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.52,
    contactOnlyProb: 0.2,
    responseLagHours: [0.25, 6],
    amountPaiseRange: [149 * RUPEE, 14_999 * RUPEE],
  },
  three_ds_drop: {
    weight: 9,
    organicPayProb: 0.26,
    organicLagHours: [1, 48],
    fraudProb: 0.02,
    retrySuccessProb: 0.04,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.48,
    contactOnlyProb: 0.19,
    responseLagHours: [0.25, 6],
    amountPaiseRange: [149 * RUPEE, 14_999 * RUPEE],
  },
  do_not_honour: {
    weight: 8,
    organicPayProb: 0.14,
    organicLagHours: [12, 168],
    fraudProb: 0.05,
    retrySuccessProb: 0.03,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.27,
    contactOnlyProb: 0.1,
    responseLagHours: [1, 20],
    amountPaiseRange: [299 * RUPEE, 17_999 * RUPEE],
  },
  card_expired: {
    weight: 6,
    organicPayProb: 0.11,
    organicLagHours: [24, 240],
    fraudProb: 0.003,
    retrySuccessProb: 0.0,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.38,
    contactOnlyProb: 0.16,
    responseLagHours: [1, 36],
    amountPaiseRange: [199 * RUPEE, 11_999 * RUPEE],
  },
  mandate_revoked: {
    weight: 4,
    organicPayProb: 0.07,
    organicLagHours: [48, 288],
    fraudProb: 0.008,
    retrySuccessProb: 0.0,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.22,
    contactOnlyProb: 0.12,
    responseLagHours: [2, 48],
    amountPaiseRange: [499 * RUPEE, 29_999 * RUPEE],
  },
  suspected_fraud: {
    weight: 3,
    organicPayProb: 0.03,
    organicLagHours: [24, 240],
    fraudProb: 0.82,
    retrySuccessProb: 0.02,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.06,
    contactOnlyProb: 0.03,
    responseLagHours: [1, 24],
    amountPaiseRange: [999 * RUPEE, 74_999 * RUPEE],
  },
  checkout_abandoned: {
    weight: 13,
    organicPayProb: 0.13,
    organicLagHours: [2, 168],
    fraudProb: 0.006,
    retrySuccessProb: 0.0,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.34,
    contactOnlyProb: 0.15,
    responseLagHours: [0.5, 24],
    amountPaiseRange: [149 * RUPEE, 22_999 * RUPEE],
  },
  subscription_pending: {
    weight: 5,
    organicPayProb: 0.48,
    organicLagHours: [12, 168],
    fraudProb: 0.004,
    retrySuccessProb: 0.06,
    retryImprovesWithTime: true,
    paymentLinkProb: 0.19,
    contactOnlyProb: 0.08,
    responseLagHours: [1, 24],
    amountPaiseRange: [199 * RUPEE, 4_999 * RUPEE],
  },
  subscription_halted: {
    weight: 4,
    organicPayProb: 0.09,
    organicLagHours: [48, 288],
    fraudProb: 0.005,
    retrySuccessProb: 0.0,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.29,
    contactOnlyProb: 0.13,
    responseLagHours: [2, 48],
    amountPaiseRange: [199 * RUPEE, 6_999 * RUPEE],
  },
  invoice_overdue: {
    weight: 5,
    organicPayProb: 0.18,
    organicLagHours: [24, 288],
    fraudProb: 0.004,
    retrySuccessProb: 0.0,
    retryImprovesWithTime: false,
    paymentLinkProb: 0.36,
    contactOnlyProb: 0.24,
    responseLagHours: [2, 72],
    amountPaiseRange: [999 * RUPEE, 149_999 * RUPEE],
  },
};

export const CLASS_WEIGHTS = Object.entries(FAILURE_CLASS_PROFILES).map(
  ([value, profile]) => ({ value: value as FailureClass, weight: profile.weight }),
);

/** Marginal cost of one outbound message, in paise. */
export const CHANNEL_COST_PAISE: Record<string, number> = {
  none: 0,
  sms: 18,
  email: 2,
  whatsapp: 65,
};

/** Conversion multiplier by channel, independent of failure class. */
export const CHANNEL_EFFECTIVENESS: Record<string, number> = {
  none: 1.0,
  sms: 0.92,
  email: 0.74,
  whatsapp: 1.12,
};

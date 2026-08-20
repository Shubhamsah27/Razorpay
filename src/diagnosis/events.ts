import type { CaseLatents, FailureClass } from "../domain/types";
import { keyedPick, keyedUnit } from "../sim/rng";

const NS = "event";

/** Share of events whose evidence is too vague for the rule table. */
const AMBIGUOUS_RATE = 0.16;

export type EventEntity = "payment" | "subscription" | "invoice" | "checkout";

/** A Razorpay-shaped failure event, as the merchant's webhook would deliver it. */
export interface PaymentEvent {
  eventId: string;
  caseId: string;
  entity: EventEntity;
  amountPaise: number;
  createdAtHour: number;
  errorCode: string | null;
  errorReason: string | null;
  errorDescription: string;
  errorSource: string | null;
  errorStep: string | null;
  subscriptionStatus: "pending" | "halted" | "active" | null;
  invoiceDaysOverdue: number | null;
}

interface EventShape {
  entity: EventEntity;
  errorCode: string | null;
  errorReason: string | null;
  errorDescription: string;
  errorSource: string | null;
  errorStep: string | null;
  subscriptionStatus?: "pending" | "halted" | "active";
  invoiceDaysOverdue?: number;
}

const GATEWAY = "GATEWAY_ERROR";
const BAD_REQUEST = "BAD_REQUEST_ERROR";

const SHAPES: Record<FailureClass, EventShape[]> = {
  issuer_down: [
    {
      entity: "payment",
      errorCode: GATEWAY,
      errorReason: "payment_failed",
      errorDescription: "Payment processing failed because of an error at the bank's end.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
    {
      entity: "payment",
      errorCode: GATEWAY,
      errorReason: "issuer_unavailable",
      errorDescription: "The issuing bank is currently unavailable. Please try again later.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
  ],
  gateway_timeout: [
    {
      entity: "payment",
      errorCode: GATEWAY,
      errorReason: "server_error",
      errorDescription: "The request timed out while awaiting a response from the gateway.",
      errorSource: "gateway",
      errorStep: "payment_authorization",
    },
  ],
  insufficient_funds: [
    {
      entity: "payment",
      errorCode: BAD_REQUEST,
      errorReason: "insufficient_funds",
      errorDescription: "Your card has insufficient balance to complete this payment.",
      errorSource: "customer",
      errorStep: "payment_authorization",
    },
  ],
  otp_timeout: [
    {
      entity: "payment",
      errorCode: BAD_REQUEST,
      errorReason: "invalid_otp",
      errorDescription: "Payment failed because the OTP was not entered in time.",
      errorSource: "customer",
      errorStep: "payment_authentication",
    },
  ],
  three_ds_drop: [
    {
      entity: "payment",
      errorCode: BAD_REQUEST,
      errorReason: "payment_authentication_failed",
      errorDescription: "The customer did not complete 3D Secure authentication.",
      errorSource: "customer",
      errorStep: "payment_authentication",
    },
  ],
  do_not_honour: [
    {
      entity: "payment",
      errorCode: BAD_REQUEST,
      errorReason: "payment_failed",
      errorDescription: "The bank declined the transaction. Reason: do not honour.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
  ],
  card_expired: [
    {
      entity: "payment",
      errorCode: BAD_REQUEST,
      errorReason: "card_expired",
      errorDescription: "The card used for this payment has expired.",
      errorSource: "customer",
      errorStep: "payment_initiation",
    },
  ],
  mandate_revoked: [
    {
      entity: "subscription",
      errorCode: BAD_REQUEST,
      errorReason: "mandate_revoked",
      errorDescription: "The e-mandate for this subscription was cancelled by the customer.",
      errorSource: "customer",
      errorStep: "payment_initiation",
      subscriptionStatus: "halted",
    },
  ],
  suspected_fraud: [
    {
      entity: "payment",
      errorCode: BAD_REQUEST,
      errorReason: "payment_failed",
      errorDescription:
        "The transaction was declined by the issuer as a suspected fraudulent attempt.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
  ],
  checkout_abandoned: [
    {
      entity: "checkout",
      errorCode: null,
      errorReason: null,
      errorDescription: "Customer left the checkout page before completing payment.",
      errorSource: "customer",
      errorStep: "payment_initiation",
    },
  ],
  subscription_pending: [
    {
      entity: "subscription",
      errorCode: null,
      errorReason: null,
      errorDescription: "Subscription charge failed; Razorpay has scheduled automatic retries.",
      errorSource: "bank",
      errorStep: "payment_authorization",
      subscriptionStatus: "pending",
    },
  ],
  subscription_halted: [
    {
      entity: "subscription",
      errorCode: null,
      errorReason: null,
      errorDescription: "Subscription halted after all automatic retry attempts were exhausted.",
      errorSource: "bank",
      errorStep: "payment_authorization",
      subscriptionStatus: "halted",
    },
  ],
  invoice_overdue: [
    {
      entity: "invoice",
      errorCode: null,
      errorReason: null,
      errorDescription: "Invoice has passed its due date and remains unpaid.",
      errorSource: null,
      errorStep: null,
      invoiceDaysOverdue: 9,
    },
  ],
};

/**
 * Generic descriptions a real gateway returns when the issuer gives no detail.
 * They strip the explicit reason but keep the structural hints (source, step),
 * which is what makes interpretation a real task rather than a coin flip.
 */
const VAGUE_DESCRIPTIONS = [
  "Payment failed. Please contact your bank for more details.",
  "The payment could not be completed at this time.",
  "Transaction unsuccessful.",
];

/** Only card-payment failures degrade this way; invoice, checkout and
 * subscription events carry unambiguous structure. */
function canBeAmbiguous(shape: EventShape): boolean {
  return shape.entity === "payment";
}

export function buildEvent(masterSeed: string, latents: CaseLatents): PaymentEvent {
  const shape = keyedPick(
    NS,
    masterSeed,
    SHAPES[latents.failureClass] as EventShape[],
    latents.caseId,
    "shape",
  );
  const isAmbiguous =
    canBeAmbiguous(shape) && keyedUnit(NS, masterSeed, latents.caseId, "ambiguous") < AMBIGUOUS_RATE;

  const errorDescription = isAmbiguous
    ? keyedPick(NS, masterSeed, VAGUE_DESCRIPTIONS, latents.caseId, "vague")
    : shape.errorDescription;

  return {
    eventId: `evt_${latents.caseId}`,
    caseId: latents.caseId,
    entity: shape.entity,
    amountPaise: latents.amountPaise,
    createdAtHour: latents.createdAtHour,
    errorCode: shape.errorCode,
    errorReason: isAmbiguous ? "payment_failed" : shape.errorReason,
    errorDescription,
    errorSource: shape.errorSource,
    errorStep: shape.errorStep,
    subscriptionStatus: shape.subscriptionStatus ?? null,
    invoiceDaysOverdue: shape.invoiceDaysOverdue ?? null,
  };
}

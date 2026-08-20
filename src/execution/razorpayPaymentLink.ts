import type { ActionRow } from "../store/actions";
import type {
  ExecutionResult,
  ReconciliationResult,
  RecoveryExecutor,
} from "./executor";
import { razorpayCall, type RazorpayConfig } from "./razorpayClient";

/** Razorpay allows 30 Payment Links per business in Test Mode. */
export const TEST_MODE_LINK_CAP = 30;

interface PaymentLinkResponse {
  id: string;
  status: string;
  short_url: string;
  amount: number;
  reference_id: string;
}

interface PaymentLinkListResponse {
  payment_links: PaymentLinkResponse[];
}

export interface PaymentLinkExecutorOptions {
  config: RazorpayConfig;
  /** Amount resolver, so the executor never invents money. */
  amountPaiseFor(action: ActionRow): number;
  descriptionFor(action: ActionRow): string;
  callbackUrl?: string;
  /** Hard ceiling on links this process may create; guards the Test Mode cap. */
  linkBudget?: number;
}

/**
 * Creates customer-initiated Payment Links.
 *
 * Razorpay documents API-level idempotency for payouts, not for Payment Links,
 * so this adapter does not rely on an idempotency header. It leans on the unique
 * reference_id derived from the action key: if a create is ambiguous, the link is
 * found by that reference rather than created again.
 */
export function createPaymentLinkExecutor(
  options: PaymentLinkExecutorOptions,
): RecoveryExecutor & { linksCreated: number } {
  const budget = options.linkBudget ?? TEST_MODE_LINK_CAP;

  return {
    name: "razorpay_payment_link",
    linksCreated: 0,

    async execute(action: ActionRow): Promise<ExecutionResult> {
      if (this.linksCreated >= budget) {
        return {
          status: "failed",
          code: "LOCAL_TEST_MODE_BUDGET_EXHAUSTED",
          retryable: false,
        };
      }

      const result = await razorpayCall<PaymentLinkResponse>(
        options.config,
        "POST",
        "/v1/payment_links",
        {
          amount: options.amountPaiseFor(action),
          currency: "INR",
          accept_partial: false,
          description: options.descriptionFor(action),
          reference_id: action.reference_id,
          reminder_enable: false,
          // Recoup owns customer messaging, so Razorpay must not also send it.
          notify: { sms: false, email: false },
          notes: {
            case_id: action.case_id,
            action_key: action.action_key,
            policy_version: action.policy_version,
          },
          ...(options.callbackUrl === undefined
            ? {}
            : { callback_url: options.callbackUrl, callback_method: "get" }),
        },
      );

      if (result.kind === "ok") {
        this.linksCreated += 1;
        return {
          status: "succeeded",
          providerId: result.data.id,
          safeResponse: {
            id: result.data.id,
            status: result.data.status,
            short_url: result.data.short_url,
            reference_id: result.data.reference_id,
          },
        };
      }

      if (result.kind === "duplicate_reference") {
        // A previous attempt already created this link, so treat it as unknown
        // and let reconciliation attach the existing one.
        return { status: "outcome_unknown", reason: result.description };
      }

      if (result.kind === "indeterminate") {
        return { status: "outcome_unknown", reason: result.reason };
      }

      return { status: "failed", code: result.code, retryable: false };
    },

    async reconcile(action: ActionRow): Promise<ReconciliationResult> {
      const result = await razorpayCall<PaymentLinkListResponse>(
        options.config,
        "GET",
        `/v1/payment_links?reference_id=${encodeURIComponent(action.reference_id)}`,
      );

      if (result.kind !== "ok") {
        return {
          status: "unknown",
          reason: result.kind === "indeterminate" ? result.reason : result.kind,
        };
      }

      const match = result.data.payment_links.find(
        (link) => link.reference_id === action.reference_id,
      );
      if (match === undefined) return { status: "not_found" };

      return { status: "found", providerId: match.id, providerStatus: match.status };
    },
  };
}

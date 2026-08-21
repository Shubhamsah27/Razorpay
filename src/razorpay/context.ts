import { createPaymentLinkExecutor } from "../execution/razorpayPaymentLink";
import { razorpayConfigFromEnv, type RazorpayConfig } from "../execution/razorpayClient";
import { ActionStore, type ActionRow } from "../store/actions";

/**
 * Persistent store shared by the link creator, the webhook server and the
 * status reporter. They are separate processes, so this cannot be in-memory.
 */
export const STORE_PATH = process.env.RECOUP_DB ?? "recoup-testmode.sqlite";

/** Deliberately below Razorpay's documented 30-link Test Mode cap. */
export const TEST_MODE_LINK_BUDGET = 15;

export const WEBHOOK_PATH = "/webhooks/razorpay";

export interface TestModeContext {
  config: RazorpayConfig;
  store: ActionStore;
  webhookSecret: string;
}

function fail(message: string): never {
  // Never echo credential material, only which variable is unusable.
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * Loads Test Mode credentials from the environment. Bun reads .env
 * automatically; nothing here logs or returns a credential to a caller that
 * might print it.
 */
export function loadContext(): TestModeContext {
  let config: RazorpayConfig | null;
  try {
    config = razorpayConfigFromEnv();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  if (config === null) {
    fail(
      "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set. Add them to .env (which is gitignored).",
    );
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (webhookSecret === undefined || webhookSecret === "") {
    fail("RAZORPAY_WEBHOOK_SECRET is not set. Add it to .env (which is gitignored).");
  }

  return { config, store: new ActionStore(STORE_PATH), webhookSecret };
}

export function paymentLinkExecutor(context: TestModeContext, amountPaise: number) {
  return createPaymentLinkExecutor({
    config: context.config,
    amountPaiseFor: () => amountPaise,
    descriptionFor: (action: ActionRow) => `Recoup recovery for ${action.case_id}`,
    linkBudget: TEST_MODE_LINK_BUDGET,
    ...(process.env.RECOUP_CALLBACK_URL === undefined
      ? {}
      : { callbackUrl: process.env.RECOUP_CALLBACK_URL }),
  });
}

/** Confirms credentials load without revealing any part of them. */
export function credentialSummary(): string {
  return "Razorpay Test Mode credentials loaded from environment (values not shown).";
}

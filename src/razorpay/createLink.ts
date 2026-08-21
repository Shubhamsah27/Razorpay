import { dispatch, reconcile } from "../execution/executor";
import { rupeesLabel } from "./format";
import { credentialSummary, loadContext, paymentLinkExecutor } from "./context";

/**
 * Creates one real Payment Link in Razorpay Test Mode through the full
 * production path: durable action identity, atomic claim committed before the
 * call, and reconciliation if the outcome comes back ambiguous.
 */
const caseId = process.argv[2] ?? `case_live_${Date.now().toString(36)}`;
const amountPaise = Number(process.argv[3] ?? 149_900);

if (!Number.isInteger(amountPaise) || amountPaise < 100) {
  console.error("\n  Amount must be an integer in paise, at least 100 (Rs 1.00).\n");
  process.exit(1);
}

const context = loadContext();
const executor = paymentLinkExecutor(context, amountPaise);

console.log(`\n${credentialSummary()}`);
console.log(`Case          ${caseId}`);
console.log(`Amount        ${rupeesLabel(amountPaise)}`);

const action = context.store.createAction(
  {
    caseId,
    actionKind: "razorpay_payment_link",
    channel: "sms",
    scheduledAt: new Date().toISOString(),
    attemptNumber: 1,
  },
  "planned",
);

context.store.transition(action.action_key, "ready", "auto-approved by guard");

console.log(`action_key    ${action.action_key}`);
console.log(`reference_id  ${action.reference_id}`);
console.log("");

const outcome = await dispatch(context.store, executor, action.action_key);
console.log(`dispatch      ${outcome}`);

if (outcome === "outcome_unknown") {
  console.log("Provider result was ambiguous; reconciling by reference_id rather than re-creating.");
  console.log(`reconcile     ${await reconcile(context.store, executor, action.action_key)}`);
}

const settled = context.store.get(action.action_key)!;
console.log(`state         ${settled.state}`);
console.log(`provider_id   ${settled.provider_id ?? "-"}`);

const attempt = context.store.database
  .query(
    `SELECT detail FROM execution_attempt
      WHERE action_key = ? ORDER BY attempt_index DESC LIMIT 1`,
  )
  .get(action.action_key) as { detail: string | null } | null;

if (attempt?.detail != null) {
  try {
    const parsed = JSON.parse(attempt.detail) as { short_url?: string; status?: string };
    if (parsed.short_url !== undefined) {
      console.log("");
      console.log("  Pay this link in Test Mode to fire the webhook:");
      console.log(`  ${parsed.short_url}`);
      console.log("");
      console.log("  Test card 4111 1111 1111 1111 · any future expiry · any CVV.");
    }
  } catch {
    // Non-JSON detail simply means there is no link to surface.
  }
}

console.log("");
context.store.close();

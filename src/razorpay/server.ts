import { ingestWebhook } from "../store/webhooks";
import { WEBHOOK_PATH, credentialSummary, loadContext } from "./context";
import { rupeesLabel } from "./format";

const PORT = Number(process.env.RECOUP_PORT ?? 8787);

const context = loadContext();

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment_link?: { entity?: { reference_id?: string; id?: string; status?: string } };
    payment?: { entity?: { amount?: number; id?: string } };
  };
}

/** Events that mean money actually arrived. */
const PAID_EVENTS = new Set(["payment_link.paid", "payment_link.partially_paid"]);

function handleEvent(body: RazorpayWebhookBody, receiptId: number): string {
  const event = body.event ?? "unknown";
  const link = body.payload?.payment_link?.entity;
  const referenceId = link?.reference_id;

  if (referenceId === undefined) return `${event}: no reference_id, nothing to attribute`;

  const action = context.store.getByReferenceId(referenceId);
  if (action === null) return `${event}: reference_id ${referenceId} is not one of ours`;

  if (!PAID_EVENTS.has(event)) {
    return `${event}: recorded against ${action.case_id}, no outcome change`;
  }

  const amountPaise = body.payload?.payment?.entity?.amount ?? 0;

  // The receipt insert and this outcome share one transaction, so a redelivery
  // can never double-count the recovery.
  const inserted = context.store.recordOutcome({
    caseId: action.case_id,
    actionKey: action.action_key,
    kind: "recovered",
    amountPaise,
    attributed: true,
    occurredAt: new Date().toISOString(),
    webhookReceiptId: receiptId,
  });

  return inserted
    ? `${event}: ${action.case_id} recovered ${rupeesLabel(amountPaise)}`
    : `${event}: ${action.case_id} already recorded, ignored`;
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, path: WEBHOOK_PATH });
    }

    if (url.pathname !== WEBHOOK_PATH) {
      return new Response("not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    // The signature covers the exact bytes Razorpay sent; parsing first and
    // re-serialising would change them and fail verification.
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") ?? "";
    const eventId = request.headers.get("x-razorpay-event-id");

    let summary = "";
    const result = ingestWebhook(
      context.store,
      { provider: "razorpay", eventId, rawBody, signature },
      context.webhookSecret,
      (receiptId) => {
        let parsed: RazorpayWebhookBody = {};
        try {
          parsed = JSON.parse(rawBody) as RazorpayWebhookBody;
        } catch {
          parsed = {};
        }
        summary = handleEvent(parsed, receiptId);
      },
    );

    const stamp = new Date().toISOString();
    if (result.status === "invalid_signature") {
      console.log(`${stamp}  REJECTED  signature did not verify`);
      return new Response("invalid signature", { status: 400 });
    }
    if (result.status === "duplicate") {
      console.log(`${stamp}  DUPLICATE ignored, already processed`);
      return Response.json({ status: "duplicate" });
    }

    console.log(`${stamp}  ACCEPTED  ${summary}`);
    return Response.json({ status: "processed" });
  },
});

console.log(`\n${credentialSummary()}`);
console.log(`Recoup webhook listener on http://localhost:${server.port}`);
console.log(`  webhook path   ${WEBHOOK_PATH}`);
console.log(`  health         /health`);
console.log("\nExpose this port with a tunnel and register the public URL in the");
console.log("Razorpay Dashboard under Settings > Webhooks, subscribing to");
console.log("payment_link.paid, payment_link.partially_paid and payment_link.expired.\n");

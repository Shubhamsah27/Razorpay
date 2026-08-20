import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ActionStore } from "./actions";

export interface WebhookDelivery {
  provider: string;
  /** Provider event id. Falls back to a hash of the verified body when absent. */
  eventId: string | null;
  rawBody: string;
  signature: string;
}

export type WebhookResult =
  | { status: "processed"; receiptId: number }
  | { status: "duplicate" }
  | { status: "invalid_signature" };

/**
 * Razorpay signs the webhook body with HMAC-SHA256 under the endpoint secret and
 * sends it in X-Razorpay-Signature.
 *
 * Two details matter: the signature is checked against the untouched bytes —
 * parsing and re-serialising would change them and fail verification — and the
 * comparison is constant-time, so a forged signature cannot be discovered one
 * byte at a time.
 */
export function signBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(signBody(rawBody, secret), "utf8");
  if (given.length !== wanted.length) return false;
  return timingSafeEqual(given, wanted);
}

export function hashBody(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

/**
 * Records the delivery identity before doing anything with it. The unique
 * constraint on (provider, event_id) is what makes a redelivered webhook a
 * no-op instead of a second state transition or a duplicate outcome.
 */
export function ingestWebhook(
  store: ActionStore,
  delivery: WebhookDelivery,
  secret: string,
  apply: (receiptId: number) => void,
): WebhookResult {
  if (!verifySignature(delivery.rawBody, delivery.signature, secret)) {
    return { status: "invalid_signature" };
  }

  const bodyHash = hashBody(delivery.rawBody);
  const eventId = delivery.eventId ?? bodyHash;
  const db = store.database;

  const run = db.transaction((): WebhookResult => {
    const inserted = db
      .query(
        `INSERT OR IGNORE INTO webhook_receipt (provider, event_id, body_hash, received_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(delivery.provider, eventId, bodyHash, new Date().toISOString());

    if (inserted.changes === 0) return { status: "duplicate" };

    const receiptId = Number(inserted.lastInsertRowid);
    // The state change and the receipt commit together, so a crash mid-apply
    // cannot leave the delivery marked as seen but unprocessed.
    apply(receiptId);
    return { status: "processed", receiptId };
  });

  return run();
}

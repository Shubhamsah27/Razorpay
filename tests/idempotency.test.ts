import { beforeEach, describe, expect, test } from "bun:test";
import {
  dispatch,
  reconcile,
  type ExecutionResult,
  type ReconciliationResult,
  type RecoveryExecutor,
} from "../src/execution/executor";
import {
  ActionStore,
  deriveActionKey,
  deriveReferenceId,
  type ActionInput,
} from "../src/store/actions";
import { hashBody, ingestWebhook, signBody, verifySignature } from "../src/store/webhooks";

const SECRET = "test_webhook_secret";

const INTENT: ActionInput = {
  caseId: "case_00001",
  actionKind: "razorpay_payment_link",
  channel: "sms",
  scheduledAt: "2026-08-20T10:00:00.000Z",
  attemptNumber: 1,
};

let store: ActionStore;

beforeEach(() => {
  store = new ActionStore(":memory:");
});

function scriptedExecutor(
  results: ExecutionResult[],
  reconciliation: ReconciliationResult = { status: "not_found" },
): RecoveryExecutor & { calls: number } {
  let index = 0;
  return {
    name: "scripted",
    calls: 0,
    async execute(): Promise<ExecutionResult> {
      this.calls += 1;
      const result = results[Math.min(index, results.length - 1)]!;
      index += 1;
      return result;
    },
    async reconcile(): Promise<ReconciliationResult> {
      return reconciliation;
    },
  };
}

describe("durable action identity", () => {
  test("the same intent always derives the same key", () => {
    expect(deriveActionKey(INTENT)).toBe(deriveActionKey({ ...INTENT }));
  });

  test("a different attempt number is a different action", () => {
    expect(deriveActionKey({ ...INTENT, attemptNumber: 2 })).not.toBe(deriveActionKey(INTENT));
  });

  test("a different scheduled time is a different action", () => {
    expect(deriveActionKey({ ...INTENT, scheduledAt: "2026-08-20T11:00:00.000Z" })).not.toBe(
      deriveActionKey(INTENT),
    );
  });

  test("repeated approval creates exactly one action", () => {
    const first = store.createAction(INTENT);
    const second = store.createAction(INTENT);
    const third = store.createAction(INTENT);

    expect(second.action_key).toBe(first.action_key);
    expect(third.action_key).toBe(first.action_key);

    const count = store.database
      .query(`SELECT COUNT(*) AS count FROM action`)
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  test("the reference id is unique and within Razorpay's 40-character limit", () => {
    const keys = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const row = store.createAction({ ...INTENT, caseId: `case_${index}` });
      expect(row.reference_id.length).toBeLessThanOrEqual(40);
      keys.add(row.reference_id);
    }
    expect(keys.size).toBe(500);
  });

  test("the reference id is derived from the action key, not generated randomly", () => {
    const row = store.createAction(INTENT);
    expect(row.reference_id).toBe(deriveReferenceId(row.action_key));
  });
});

describe("atomic claim", () => {
  test("only one of many concurrent claims wins", () => {
    const row = store.createAction(INTENT, "ready");
    const results = Array.from({ length: 25 }, () => store.claim(row.action_key));
    expect(results.filter((result) => result.claimed).length).toBe(1);
  });

  test("a claim inserts exactly one execution attempt", () => {
    const row = store.createAction(INTENT, "ready");
    for (let index = 0; index < 10; index += 1) store.claim(row.action_key);
    expect(store.attemptCount(row.action_key)).toBe(1);
  });

  test("an action that is not ready cannot be claimed", () => {
    const row = store.createAction(INTENT, "awaiting_approval");
    expect(store.claim(row.action_key).claimed).toBe(false);
  });

  test("a succeeded action cannot be claimed again", async () => {
    const row = store.createAction(INTENT, "ready");
    const executor = scriptedExecutor([
      { status: "succeeded", providerId: "plink_1", safeResponse: {} },
    ]);
    await dispatch(store, executor, row.action_key);

    expect(store.claim(row.action_key).claimed).toBe(false);
    expect(store.get(row.action_key)!.state).toBe("succeeded");
  });
});

describe("state machine", () => {
  test("a failed action cannot be resurrected in place", () => {
    const row = store.createAction(INTENT, "ready");
    store.claim(row.action_key);
    store.markFailed(row.action_key, "hard decline");

    expect(store.transition(row.action_key, "ready", "retry")).toBe(false);
    expect(store.transition(row.action_key, "executing", "retry")).toBe(false);
    expect(store.get(row.action_key)!.state).toBe("failed");
  });

  test("a genuine retry uses a new attempt number and a new key", () => {
    const first = store.createAction(INTENT, "ready");
    store.claim(first.action_key);
    store.markFailed(first.action_key, "hard decline");

    const second = store.createAction({ ...INTENT, attemptNumber: 2 }, "ready");
    expect(second.action_key).not.toBe(first.action_key);
    expect(store.claim(second.action_key).claimed).toBe(true);
  });

  test("blocked and rejected are terminal", () => {
    const blocked = store.createAction(INTENT);
    store.transition(blocked.action_key, "blocked", "guard");
    expect(store.transition(blocked.action_key, "ready", "override")).toBe(false);

    const rejected = store.createAction({ ...INTENT, attemptNumber: 9 }, "awaiting_approval");
    store.transition(rejected.action_key, "rejected", "reviewer declined");
    expect(store.transition(rejected.action_key, "ready", "override")).toBe(false);
  });

  test("every transition is recorded in an append-only log", () => {
    const row = store.createAction(INTENT, "ready");
    store.claim(row.action_key);
    store.markOutcomeUnknown(row.action_key, "timeout");
    store.beginReconciliation(row.action_key);
    store.markSucceeded(row.action_key, "plink_9", "attached");

    expect(store.transitions(row.action_key).map((entry) => entry.to_state)).toEqual([
      "executing",
      "outcome_unknown",
      "reconciling",
      "succeeded",
    ]);
  });
});

describe("ambiguous provider results", () => {
  test("a timeout never triggers a second create call", async () => {
    const row = store.createAction(INTENT, "ready");
    const executor = scriptedExecutor([{ status: "outcome_unknown", reason: "socket timeout" }]);

    expect(await dispatch(store, executor, row.action_key)).toBe("outcome_unknown");
    // The worker tries again; the claim must refuse because the state left `ready`.
    expect(await dispatch(store, executor, row.action_key)).toBe("not_claimed");
    expect(executor.calls).toBe(1);
  });

  test("a thrown error is treated as unknown, not as a safe failure", async () => {
    const row = store.createAction(INTENT, "ready");
    const executor: RecoveryExecutor = {
      name: "throwing",
      async execute(): Promise<ExecutionResult> {
        throw new Error("connection reset");
      },
      async reconcile(): Promise<ReconciliationResult> {
        return { status: "not_found" };
      },
    };

    expect(await dispatch(store, executor, row.action_key)).toBe("outcome_unknown");
    expect(store.get(row.action_key)!.state).toBe("outcome_unknown");
  });

  test("reconciliation attaches an existing Payment Link found by reference id", async () => {
    const row = store.createAction(INTENT, "ready");
    const executor = scriptedExecutor([{ status: "outcome_unknown", reason: "timeout" }], {
      status: "found",
      providerId: "plink_existing",
      providerStatus: "created",
    });

    await dispatch(store, executor, row.action_key);
    expect(await reconcile(store, executor, row.action_key)).toBe("reconciled_succeeded");

    const settled = store.get(row.action_key)!;
    expect(settled.state).toBe("succeeded");
    expect(settled.provider_id).toBe("plink_existing");
  });

  test("a provider with no record lets the effect be marked failed", async () => {
    const row = store.createAction(INTENT, "ready");
    const executor = scriptedExecutor([{ status: "outcome_unknown", reason: "timeout" }], {
      status: "not_found",
    });

    await dispatch(store, executor, row.action_key);
    expect(await reconcile(store, executor, row.action_key)).toBe("reconciled_failed");
    expect(store.get(row.action_key)!.state).toBe("failed");
  });

  test("an unresolvable outcome raises an exception instead of guessing", async () => {
    const row = store.createAction(INTENT, "ready");
    const executor = scriptedExecutor([{ status: "outcome_unknown", reason: "timeout" }], {
      status: "unknown",
      reason: "provider API unreachable",
    });

    await dispatch(store, executor, row.action_key);
    expect(await reconcile(store, executor, row.action_key)).toBe("exception");
    expect(store.openExceptions()).toHaveLength(1);
    expect(store.get(row.action_key)!.state).toBe("reconciling");
  });

  test("an expired lease is reclaimed only into reconciliation, never back to ready", () => {
    const row = store.createAction(INTENT, "ready");
    store.claim(row.action_key, -1);

    expect(store.reclaimExpiredLeases()).toEqual([row.action_key]);
    expect(store.get(row.action_key)!.state).toBe("outcome_unknown");
    expect(store.claim(row.action_key).claimed).toBe(false);
  });

  test("a restart after the provider request does not recreate the Payment Link", async () => {
    const row = store.createAction(INTENT, "ready");
    store.claim(row.action_key, -1);

    // Process dies here. A new worker starts and sweeps stale leases.
    store.reclaimExpiredLeases();

    const executor = scriptedExecutor([], {
      status: "found",
      providerId: "plink_created_before_crash",
      providerStatus: "created",
    });
    expect(await reconcile(store, executor, row.action_key)).toBe("reconciled_succeeded");
    expect(executor.calls).toBe(0);
    expect(store.get(row.action_key)!.provider_id).toBe("plink_created_before_crash");
  });
});

describe("webhook idempotency", () => {
  const body = JSON.stringify({ event: "payment_link.paid", payload: { id: "plink_1" } });
  const signature = signBody(body, SECRET);

  test("a valid signature verifies and a tampered body does not", () => {
    expect(verifySignature(body, signature, SECRET)).toBe(true);
    expect(verifySignature(`${body} `, signature, SECRET)).toBe(false);
    expect(verifySignature(body, "deadbeef", SECRET)).toBe(false);
  });

  test("an invalid signature is rejected before anything is recorded", () => {
    let applied = 0;
    const result = ingestWebhook(
      store,
      { provider: "razorpay", eventId: "evt_1", rawBody: body, signature: "bad" },
      SECRET,
      () => {
        applied += 1;
      },
    );

    expect(result.status).toBe("invalid_signature");
    expect(applied).toBe(0);
  });

  test("a redelivered webhook produces one transition and one outcome", () => {
    let applied = 0;
    const delivery = { provider: "razorpay", eventId: "evt_1", rawBody: body, signature };

    const first = ingestWebhook(store, delivery, SECRET, () => {
      applied += 1;
    });
    const second = ingestWebhook(store, delivery, SECRET, () => {
      applied += 1;
    });
    const third = ingestWebhook(store, delivery, SECRET, () => {
      applied += 1;
    });

    expect(first.status).toBe("processed");
    expect(second.status).toBe("duplicate");
    expect(third.status).toBe("duplicate");
    expect(applied).toBe(1);
  });

  test("with no event id, the verified body hash is the identity", () => {
    let applied = 0;
    const delivery = { provider: "razorpay", eventId: null, rawBody: body, signature };

    ingestWebhook(store, delivery, SECRET, () => {
      applied += 1;
    });
    ingestWebhook(store, delivery, SECRET, () => {
      applied += 1;
    });

    expect(applied).toBe(1);
    const receipt = store.database
      .query(`SELECT event_id FROM webhook_receipt`)
      .get() as { event_id: string };
    expect(receipt.event_id).toBe(hashBody(body));
  });

  test("a failure while applying rolls back the receipt so the delivery can be retried", () => {
    const delivery = { provider: "razorpay", eventId: "evt_boom", rawBody: body, signature };

    expect(() =>
      ingestWebhook(store, delivery, SECRET, () => {
        throw new Error("apply failed");
      }),
    ).toThrow();

    const count = store.database
      .query(`SELECT COUNT(*) AS count FROM webhook_receipt`)
      .get() as { count: number };
    expect(count.count).toBe(0);

    let applied = 0;
    expect(
      ingestWebhook(store, delivery, SECRET, () => {
        applied += 1;
      }).status,
    ).toBe("processed");
    expect(applied).toBe(1);
  });
});

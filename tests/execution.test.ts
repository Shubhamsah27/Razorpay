import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { dispatch, reconcile } from "../src/execution/executor";
import { createPaymentLinkExecutor } from "../src/execution/razorpayPaymentLink";
import { razorpayConfigFromEnv, type RazorpayConfig } from "../src/execution/razorpayClient";
import { createSimulatedExecutor } from "../src/execution/simulated";
import { ActionStore, type ActionInput } from "../src/store/actions";

type Scenario =
  | "ok"
  | "validation_error"
  | "duplicate_reference"
  | "server_error"
  | "rate_limited"
  | "hang";

let scenario: Scenario = "ok";
let createCalls = 0;
const createdReferences = new Set<string>();

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/v1/payment_links" && request.method === "POST") {
      createCalls += 1;
      const body = (await request.json()) as { reference_id: string; amount: number };

      switch (scenario) {
        case "validation_error":
          return Response.json(
            { error: { code: "BAD_REQUEST_ERROR", description: "amount must be at least 100" } },
            { status: 400 },
          );
        case "duplicate_reference":
          return Response.json(
            {
              error: {
                code: "BAD_REQUEST_ERROR",
                description: "The reference_id provided already exists for another payment link",
              },
            },
            { status: 400 },
          );
        case "server_error":
          return Response.json({ error: { description: "internal error" } }, { status: 502 });
        case "rate_limited":
          return Response.json({ error: { description: "too many requests" } }, { status: 429 });
        case "hang":
          await Bun.sleep(5000);
          return Response.json({}, { status: 200 });
        case "ok":
          createdReferences.add(body.reference_id);
          return Response.json({
            id: `plink_${body.reference_id.slice(-8)}`,
            status: "created",
            short_url: "https://rzp.io/i/test",
            amount: body.amount,
            reference_id: body.reference_id,
          });
      }
    }

    if (url.pathname === "/v1/payment_links" && request.method === "GET") {
      // The whole provider is unreachable in this scenario, lookups included.
      if (scenario === "hang") await Bun.sleep(5000);
      const reference = url.searchParams.get("reference_id") ?? "";
      const links = createdReferences.has(reference)
        ? [
            {
              id: `plink_${reference.slice(-8)}`,
              status: "created",
              short_url: "https://rzp.io/i/test",
              amount: 10000,
              reference_id: reference,
            },
          ]
        : [];
      return Response.json({ payment_links: links });
    }

    return new Response("not found", { status: 404 });
  },
});

afterAll(() => {
  server.stop(true);
});

const config: RazorpayConfig = {
  keyId: "rzp_test_fake",
  keySecret: "secret",
  baseUrl: `http://localhost:${server.port}`,
  timeoutMs: 300,
};

const INTENT: ActionInput = {
  caseId: "case_00001",
  actionKind: "razorpay_payment_link",
  channel: "sms",
  scheduledAt: "2026-08-20T10:00:00.000Z",
  attemptNumber: 1,
};

let store: ActionStore;

function executor() {
  return createPaymentLinkExecutor({
    config,
    amountPaiseFor: () => 10_000,
    descriptionFor: () => "Complete your payment",
  });
}

beforeEach(() => {
  store = new ActionStore(":memory:");
  scenario = "ok";
  createCalls = 0;
  createdReferences.clear();
});

describe("payment link adapter", () => {
  test("a successful create records the provider id", async () => {
    const row = store.createAction(INTENT, "ready");
    expect(await dispatch(store, executor(), row.action_key)).toBe("succeeded");
    expect(store.get(row.action_key)!.provider_id).toStartWith("plink_");
  });

  test("the outbound request carries the derived reference id", async () => {
    const row = store.createAction(INTENT, "ready");
    await dispatch(store, executor(), row.action_key);
    expect(createdReferences.has(row.reference_id)).toBe(true);
  });

  test("a definite validation error fails the action without reconciliation", async () => {
    scenario = "validation_error";
    const row = store.createAction(INTENT, "ready");
    expect(await dispatch(store, executor(), row.action_key)).toBe("failed");
    expect(store.get(row.action_key)!.state).toBe("failed");
  });

  test("a 5xx is indeterminate, not a failure", async () => {
    scenario = "server_error";
    const row = store.createAction(INTENT, "ready");
    expect(await dispatch(store, executor(), row.action_key)).toBe("outcome_unknown");
  });

  test("rate limiting is indeterminate", async () => {
    scenario = "rate_limited";
    const row = store.createAction(INTENT, "ready");
    expect(await dispatch(store, executor(), row.action_key)).toBe("outcome_unknown");
  });

  test("a timeout is indeterminate and does not retry the create", async () => {
    scenario = "hang";
    const row = store.createAction(INTENT, "ready");
    expect(await dispatch(store, executor(), row.action_key)).toBe("outcome_unknown");
    expect(await dispatch(store, executor(), row.action_key)).toBe("not_claimed");
    expect(createCalls).toBe(1);
  });

  test("a duplicate reference is treated as unknown so the existing link is attached", async () => {
    // The link exists at the provider, but this attempt is told it is a duplicate.
    const row = store.createAction(INTENT, "ready");
    createdReferences.add(row.reference_id);
    scenario = "duplicate_reference";

    expect(await dispatch(store, executor(), row.action_key)).toBe("outcome_unknown");

    scenario = "ok";
    expect(await reconcile(store, executor(), row.action_key)).toBe("reconciled_succeeded");
    expect(store.get(row.action_key)!.state).toBe("succeeded");
  });

  test("reconciliation after a timeout attaches the link the provider actually made", async () => {
    const row = store.createAction(INTENT, "ready");
    createdReferences.add(row.reference_id);
    scenario = "hang";
    await dispatch(store, executor(), row.action_key);

    scenario = "ok";
    expect(await reconcile(store, executor(), row.action_key)).toBe("reconciled_succeeded");
    expect(store.get(row.action_key)!.provider_id).toBe(`plink_${row.reference_id.slice(-8)}`);
  });

  test("reconciliation finding nothing marks the action failed", async () => {
    const row = store.createAction(INTENT, "ready");
    scenario = "hang";
    await dispatch(store, executor(), row.action_key);

    scenario = "ok";
    expect(await reconcile(store, executor(), row.action_key)).toBe("reconciled_failed");
  });

  test("reconciliation that cannot reach the provider raises an exception", async () => {
    const row = store.createAction(INTENT, "ready");
    scenario = "hang";
    await dispatch(store, executor(), row.action_key);
    expect(await reconcile(store, executor(), row.action_key)).toBe("exception");
    expect(store.openExceptions()).toHaveLength(1);
  });

  test("the Test Mode link budget stops runaway creation", async () => {
    const capped = createPaymentLinkExecutor({
      config,
      amountPaiseFor: () => 10_000,
      descriptionFor: () => "Complete your payment",
      linkBudget: 2,
    });

    const outcomes: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const row = store.createAction({ ...INTENT, attemptNumber: index + 1 }, "ready");
      outcomes.push(await dispatch(store, capped, row.action_key));
    }

    expect(outcomes).toEqual(["succeeded", "succeeded", "failed", "failed"]);
  });
});

describe("live-key safety", () => {
  test("a live key is refused outright", () => {
    expect(() =>
      razorpayConfigFromEnv({
        RAZORPAY_KEY_ID: "rzp_live_abc123",
        RAZORPAY_KEY_SECRET: "secret",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Test Mode only/);
  });

  test("missing credentials yield no config rather than a broken one", () => {
    expect(razorpayConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  test("a test key is accepted", () => {
    const parsed = razorpayConfigFromEnv({
      RAZORPAY_KEY_ID: "rzp_test_abc123",
      RAZORPAY_KEY_SECRET: "secret",
    } as NodeJS.ProcessEnv);
    expect(parsed?.keyId).toBe("rzp_test_abc123");
  });
});

describe("simulated executor", () => {
  test("faults are reproducible for the same action", async () => {
    const faults = {
      indeterminateRate: 0.3,
      failureRate: 0.1,
      landedWhenIndeterminateRate: 0.5,
    };
    const first = createSimulatedExecutor("seed", faults);
    const second = createSimulatedExecutor("seed", faults);

    const row = store.createAction(INTENT, "ready");
    const a = await first.execute(row);
    const b = await second.execute(row);
    expect(a).toEqual(b);
  });

  test("an ambiguous call whose effect landed reconciles to found", async () => {
    const always = createSimulatedExecutor("seed", {
      indeterminateRate: 1,
      failureRate: 0,
      landedWhenIndeterminateRate: 1,
    });
    const row = store.createAction(INTENT, "ready");

    expect(await dispatch(store, always, row.action_key)).toBe("outcome_unknown");
    expect(await reconcile(store, always, row.action_key)).toBe("reconciled_succeeded");
  });

  test("an ambiguous call whose effect never landed reconciles to failed", async () => {
    const always = createSimulatedExecutor("seed", {
      indeterminateRate: 1,
      failureRate: 0,
      landedWhenIndeterminateRate: 0,
    });
    const row = store.createAction(INTENT, "ready");

    expect(await dispatch(store, always, row.action_key)).toBe("outcome_unknown");
    expect(await reconcile(store, always, row.action_key)).toBe("reconciled_failed");
  });
});

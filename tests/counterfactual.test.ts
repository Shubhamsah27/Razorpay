import { describe, expect, test } from "bun:test";
import type { PlannedAction } from "../src/domain/types";
import type { CaseView, ExecutedAction, Policy } from "../src/domain/view";
import { runArm, simulateCase } from "../src/eval/simulate";
import { fixedRetryPolicy } from "../src/policies/fixedPolicy";
import { noActionPolicy } from "../src/policies/noAction";
import { createOracle, toTimeBucket } from "../src/sim/oracle";
import { generateCase, generatePopulation } from "../src/sim/world";

const SEED = "test-seed-alpha";
const population = generatePopulation({ masterSeed: SEED, caseCount: 300 });

function linkPolicy(hours: number[], name = "link_policy"): Policy {
  return {
    name,
    next(view: CaseView, history: ExecutedAction[]): PlannedAction | null {
      const attemptNumber = history.length + 1;
      const scheduledAtHour = hours[history.length];
      if (scheduledAtHour === undefined) return null;
      return {
        actionId: `${view.caseId}:link:${attemptNumber}`,
        caseId: view.caseId,
        actionKind: "razorpay_payment_link",
        channel: "sms",
        scheduledAtHour,
        attemptNumber,
        attributionWindowHours: 72,
      };
    },
  };
}

describe("shared potential outcomes", () => {
  test("arm order does not change per-case results", () => {
    const forward = [noActionPolicy, fixedRetryPolicy, linkPolicy([4, 30])].map((policy) =>
      runArm(SEED, population, policy),
    );
    const reversed = [linkPolicy([4, 30]), fixedRetryPolicy, noActionPolicy]
      .map((policy) => runArm(SEED, population, policy))
      .reverse();

    expect(reversed).toEqual(forward);
  });

  test("the same keyed action resolves identically in every arm", () => {
    const oracle = createOracle(SEED);
    for (const latents of population.slice(0, 50)) {
      const key = {
        caseId: latents.caseId,
        actionKind: "razorpay_payment_link" as const,
        channel: "sms" as const,
        timeBucket: toTimeBucket(30),
        attemptNumber: 1,
      };
      expect(oracle.resolve(latents, key)).toEqual(oracle.resolve(latents, key));
      expect(createOracle(SEED).resolve(latents, key)).toEqual(oracle.resolve(latents, key));
    }
  });

  test("an unrelated extra action does not shift another action's outcome", () => {
    const oracle = createOracle(SEED);
    const latents = population[0]!;
    const target = {
      caseId: latents.caseId,
      actionKind: "razorpay_payment_link" as const,
      channel: "sms" as const,
      timeBucket: toTimeBucket(30),
      attemptNumber: 1,
    };

    const before = oracle.resolve(latents, target);
    // Reveal a pile of unrelated cells first.
    for (const bucket of [0, 1, 2, 8, 20]) {
      oracle.resolve(latents, { ...target, actionKind: "simulated_contact", timeBucket: bucket });
      oracle.resolve(latents, { ...target, channel: "email", timeBucket: bucket });
    }

    expect(oracle.resolve(latents, target)).toEqual(before);
  });

  test("a case's latents do not depend on population size", () => {
    const small = generatePopulation({ masterSeed: SEED, caseCount: 5 });
    const large = generatePopulation({ masterSeed: SEED, caseCount: 5000 });
    expect(large.slice(0, 5)).toEqual(small);
    expect(generateCase(SEED, "case_00003")).toEqual(small[3]!);
  });

  test("different master seeds give different but reproducible populations", () => {
    const other = generatePopulation({ masterSeed: "test-seed-beta", caseCount: 300 });
    expect(other).not.toEqual(population);
    expect(generatePopulation({ masterSeed: "test-seed-beta", caseCount: 300 })).toEqual(other);
  });
});

describe("attribution", () => {
  test("organic payers are never counted as incremental recovery", () => {
    const oracle = createOracle(SEED);
    const policy = linkPolicy([2, 26, 50]);

    for (const latents of population) {
      const outcome = simulateCase(oracle, SEED, latents, policy);
      if (outcome.attributedActionId === null) continue;

      // Credit is only given when the action beat the organic path.
      expect(outcome.paidAtHour).not.toBeNull();
      if (latents.organicPayHour !== null) {
        expect(outcome.paidAtHour!).toBeLessThan(latents.organicPayHour);
      }
    }
  });

  test("the no-action arm recovers exactly the organic payers and spends nothing", () => {
    const arm = runArm(SEED, population, noActionPolicy);
    for (const [index, outcome] of arm.cases.entries()) {
      const latents = population[index]!;
      expect(outcome.paid).toBe(latents.organicPayHour !== null);
      expect(outcome.paidAtHour).toBe(latents.organicPayHour);
      expect(outcome.incrementalAmountPaise).toBe(0);
      expect(outcome.actionCostPaise).toBe(0);
    }
  });

  test("payment outside the attribution window earns no credit", () => {
    const oracle = createOracle(SEED);
    const narrow: Policy = {
      name: "narrow_window",
      next: (view, history) =>
        history.length > 0
          ? null
          : {
              actionId: `${view.caseId}:link:1`,
              caseId: view.caseId,
              actionKind: "razorpay_payment_link",
              channel: "sms",
              scheduledAtHour: 6,
              attemptNumber: 1,
              attributionWindowHours: 0,
            },
    };

    for (const latents of population) {
      const outcome = simulateCase(oracle, SEED, latents, narrow);
      expect(outcome.incrementalAmountPaise).toBe(0);
    }
  });
});

describe("provider boundary", () => {
  test("only the fixed baseline issues merchant-initiated retries", () => {
    const recoupLike = runArm(SEED, population, linkPolicy([4, 30]));
    const retryKinds = recoupLike.cases
      .flatMap((outcome) => outcome.actions)
      .map((action) => action.actionKind);
    expect(retryKinds).not.toContain("simulated_retry");

    const baseline = runArm(SEED, population, fixedRetryPolicy);
    const baselineKinds = new Set(
      baseline.cases.flatMap((outcome) => outcome.actions).map((action) => action.actionKind),
    );
    expect([...baselineKinds]).toEqual(["simulated_retry"]);
  });

  test("observing a subscription retry cannot recover a case on its own", () => {
    const oracle = createOracle(SEED);
    const observe: Policy = {
      name: "observe_only",
      next: (view, history) =>
        history.length > 0
          ? null
          : {
              actionId: `${view.caseId}:observe:1`,
              caseId: view.caseId,
              actionKind: "razorpay_subscription_observation",
              channel: "none",
              scheduledAtHour: 12,
              attemptNumber: 1,
              attributionWindowHours: 240,
            },
    };

    for (const latents of population) {
      const outcome = simulateCase(oracle, SEED, latents, observe);
      expect(outcome.incrementalAmountPaise).toBe(0);
      expect(outcome.actionCostPaise).toBe(0);
    }
  });
});

describe("determinism", () => {
  test("repeated evaluation runs are identical", () => {
    expect(runArm(SEED, population, fixedRetryPolicy)).toEqual(
      runArm(SEED, population, fixedRetryPolicy),
    );
  });
});

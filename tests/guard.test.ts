import { describe, expect, test } from "bun:test";
import type { PlannedAction } from "../src/domain/types";
import { toCaseView, type CaseView, type ExecutedAction } from "../src/domain/view";
import type { Diagnosis } from "../src/diagnosis/classifier";
import { runArm } from "../src/eval/simulate";
import { createRecoupPolicy } from "../src/policies/recoup";
import { DEFAULT_GUARD_CONFIG, evaluateGuard } from "../src/policy/guard";
import { generatePopulation } from "../src/sim/world";

const SEED = "test-seed-alpha";
const population = generatePopulation({ masterSeed: SEED, caseCount: 400 });

const baseView: CaseView = {
  ...toCaseView(SEED, population[0]!),
  hasOptedOut: false,
  riskScore: 0.1,
  priorPaymentSuccessRate: 0.6,
  amountPaise: 5_000_00,
};

const cleanDiagnosis: Diagnosis = {
  failureClass: "checkout_abandoned",
  confidence: 0.96,
  source: "rule",
  rationale: "test",
};

function link(overrides: Partial<PlannedAction> = {}): PlannedAction {
  return {
    actionId: "a1",
    caseId: baseView.caseId,
    actionKind: "razorpay_payment_link",
    channel: "sms",
    scheduledAtHour: 4,
    attemptNumber: 1,
    attributionWindowHours: 72,
    ...overrides,
  };
}

function executed(action: PlannedAction): ExecutedAction {
  return { action, responded: false, costPaise: 18 };
}

const HIGH_VALUE = 10_00_000_00;

describe("safety guard", () => {
  test("a clean, valuable action runs automatically", () => {
    const result = evaluateGuard(baseView, cleanDiagnosis, link(), [], HIGH_VALUE);
    expect(result.decision).toBe("automatic");
  });

  test("opt-out blocks contact regardless of value", () => {
    const result = evaluateGuard(
      { ...baseView, hasOptedOut: true },
      cleanDiagnosis,
      link(),
      [],
      HIGH_VALUE,
    );
    expect(result.decision).toBe("blocked");
    expect(result.rules.map((rule) => rule.rule)).toContain("opt_out");
  });

  test("a fraud diagnosis blocks collection even with a clean risk score", () => {
    const result = evaluateGuard(
      baseView,
      { ...cleanDiagnosis, failureClass: "suspected_fraud" },
      link(),
      [],
      HIGH_VALUE,
    );
    expect(result.decision).toBe("blocked");
    expect(result.rules.map((rule) => rule.rule)).toContain("fraud_diagnosis");
  });

  test("a high risk score blocks even when the diagnosis looks benign", () => {
    const result = evaluateGuard(
      { ...baseView, riskScore: 0.9 },
      cleanDiagnosis,
      link(),
      [],
      HIGH_VALUE,
    );
    expect(result.decision).toBe("blocked");
  });

  test("the kill switch blocks an otherwise automatic action", () => {
    const result = evaluateGuard(baseView, cleanDiagnosis, link(), [], HIGH_VALUE, {
      ...DEFAULT_GUARD_CONFIG,
      killSwitchEngaged: true,
    });
    expect(result.decision).toBe("blocked");
    expect(result.rules.map((rule) => rule.rule)).toContain("kill_switch");
  });

  test("contact caps override confidence and value", () => {
    const history = [
      executed(link({ actionId: "a1", scheduledAtHour: 0, attemptNumber: 1 })),
      executed(link({ actionId: "a2", scheduledAtHour: 30, attemptNumber: 2 })),
      executed(link({ actionId: "a3", scheduledAtHour: 60, attemptNumber: 3 })),
    ];
    const result = evaluateGuard(
      baseView,
      cleanDiagnosis,
      link({ actionId: "a4", scheduledAtHour: 90, attemptNumber: 4 }),
      history,
      HIGH_VALUE,
    );
    expect(result.decision).toBe("blocked");
    expect(result.rules.map((rule) => rule.rule)).toContain("contact_cap");
  });

  test("contacts too close together are blocked", () => {
    const history = [executed(link({ scheduledAtHour: 10 }))];
    const result = evaluateGuard(
      baseView,
      cleanDiagnosis,
      link({ actionId: "a2", scheduledAtHour: 12, attemptNumber: 2 }),
      history,
      HIGH_VALUE,
    );
    expect(result.rules.map((rule) => rule.rule)).toContain("contact_spacing");
  });

  test("quiet hours defer a contact instead of sending it", () => {
    // Cases start at 10:00, so hour 12 lands at 22:00 local time.
    const result = evaluateGuard(baseView, cleanDiagnosis, link({ scheduledAtHour: 12 }), [], HIGH_VALUE);
    expect(result.deferToHour).not.toBeNull();
    expect(result.deferToHour!).toBeGreaterThan(12);
    expect(result.rules.map((rule) => rule.rule)).toContain("quiet_hours");
  });

  test("no action is ever scheduled inside quiet hours", () => {
    const recoup = createRecoupPolicy();
    const arm = runArm(SEED, population, recoup.policy);
    for (const outcome of arm.cases) {
      for (const action of outcome.actions) {
        if (action.actionKind === "razorpay_subscription_observation") continue;
        const hour = (10 + Math.floor(action.scheduledAtHour)) % 24;
        expect(hour >= 21 || hour < 8).toBe(false);
      }
    }
  });

  test("a negative expected value blocks the action", () => {
    const result = evaluateGuard(baseView, cleanDiagnosis, link(), [], -1);
    expect(result.decision).toBe("blocked");
    expect(result.rules.map((rule) => rule.rule)).toContain("negative_expected_value");
  });

  test("mandate reauthorisation always requires human review", () => {
    const result = evaluateGuard(
      baseView,
      { ...cleanDiagnosis, failureClass: "mandate_revoked" },
      link(),
      [],
      HIGH_VALUE,
    );
    expect(result.decision).toBe("review");
  });

  test("a low-confidence AI diagnosis requires human review", () => {
    const result = evaluateGuard(
      baseView,
      { failureClass: "issuer_down", confidence: 0.4, source: "ai", rationale: "guess" },
      link(),
      [],
      HIGH_VALUE,
    );
    expect(result.decision).toBe("review");
    expect(result.rules.map((rule) => rule.rule)).toContain("low_diagnosis_confidence");
  });

  test("blocked always wins over review", () => {
    const result = evaluateGuard(
      { ...baseView, hasOptedOut: true, amountPaise: HIGH_VALUE },
      { ...cleanDiagnosis, failureClass: "mandate_revoked" },
      link(),
      [],
      HIGH_VALUE,
    );
    expect(result.decision).toBe("blocked");
  });
});

describe("policy-level safety", () => {
  test("opted-out customers are never contacted anywhere in the population", () => {
    const recoup = createRecoupPolicy();
    const arm = runArm(SEED, population, recoup.policy);
    const optedOut = new Set(
      population.filter((latents) => latents.optedOut).map((latents) => latents.caseId),
    );

    for (const outcome of arm.cases) {
      if (!optedOut.has(outcome.caseId)) continue;
      expect(outcome.contactsMade).toBe(0);
    }
  });

  test("cases diagnosed as fraud receive no action at all", () => {
    const recoup = createRecoupPolicy();
    runArm(SEED, population, recoup.policy);
    const frozen = recoup.decisions.filter(
      (decision) => decision.diagnosis.failureClass === "suspected_fraud",
    );

    expect(frozen.length).toBeGreaterThan(0);
    for (const decision of frozen) {
      expect(decision.outcome).not.toBe("approved");
    }
  });

  test("the kill switch stops the entire population", () => {
    const recoup = createRecoupPolicy({
      guardConfig: { ...DEFAULT_GUARD_CONFIG, killSwitchEngaged: true },
    });
    const arm = runArm(SEED, population, recoup.policy);
    expect(arm.cases.every((outcome) => outcome.actions.length === 0)).toBe(true);
  });

  test("every approved action carries an auditable decision record", () => {
    const recoup = createRecoupPolicy();
    const arm = runArm(SEED, population, recoup.policy);
    const executedIds = new Set(
      arm.cases.flatMap((outcome) => outcome.actions).map((action) => action.actionId),
    );

    for (const actionId of executedIds) {
      const [caseId, , attempt] = actionId.split(":");
      const match = recoup.decisions.find(
        (decision) =>
          decision.caseId === caseId && String(decision.attemptNumber) === attempt,
      );
      expect(match).toBeDefined();
      expect(match!.outcome).toBe("approved");
    }
  });
});

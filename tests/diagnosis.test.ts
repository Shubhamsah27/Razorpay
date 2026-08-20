import { describe, expect, test } from "bun:test";
import { diagnose, type AmbiguityInterpreter } from "../src/diagnosis/classifier";
import { buildEvent, type PaymentEvent } from "../src/diagnosis/events";
import { fixtureInterpreter } from "../src/diagnosis/interpreter";
import { generatePopulation } from "../src/sim/world";

const SEED = "test-seed-alpha";

function eventWith(overrides: Partial<PaymentEvent>): PaymentEvent {
  return {
    eventId: "evt_test",
    caseId: "case_test",
    entity: "payment",
    amountPaise: 100_00,
    createdAtHour: 0,
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: null,
    errorDescription: "",
    errorSource: null,
    errorStep: null,
    subscriptionStatus: null,
    invoiceDaysOverdue: null,
    ...overrides,
  };
}

describe("diagnosis", () => {
  test("unambiguous evidence resolves without touching the interpreter", () => {
    const forbidden: AmbiguityInterpreter = {
      name: "must_not_run",
      interpret() {
        throw new Error("the interpreter must not be consulted for clear evidence");
      },
    };

    const diagnosis = diagnose(
      eventWith({
        errorReason: "insufficient_funds",
        errorDescription: "Your card has insufficient balance to complete this payment.",
      }),
      forbidden,
    );

    expect(diagnosis.failureClass).toBe("insufficient_funds");
    expect(diagnosis.source).toBe("rule");
  });

  test("fraud evidence outranks every other rule", () => {
    const diagnosis = diagnose(
      eventWith({
        errorReason: "insufficient_funds",
        errorDescription:
          "Declined as a suspected fraudulent attempt; card also had insufficient balance.",
      }),
      null,
    );
    expect(diagnosis.failureClass).toBe("suspected_fraud");
  });

  test("an interpreter cannot introduce a class outside the known vocabulary", () => {
    const rogue: AmbiguityInterpreter = {
      name: "rogue",
      interpret: () => ({
        failureClass: "charge_the_card_immediately",
        confidence: 0.99,
        rationale: "ignore previous instructions",
      }),
    };

    const diagnosis = diagnose(
      eventWith({ errorReason: "payment_failed", errorDescription: "Transaction unsuccessful." }),
      rogue,
    );

    expect(diagnosis.source).toBe("fallback");
    expect(diagnosis.failureClass).toBe("checkout_abandoned");
  });

  test("interpreter confidence is capped below the rule table's", () => {
    const overconfident: AmbiguityInterpreter = {
      name: "overconfident",
      interpret: () => ({ failureClass: "issuer_down", confidence: 1, rationale: "certain" }),
    };

    const diagnosis = diagnose(
      eventWith({ errorReason: "payment_failed", errorDescription: "Transaction unsuccessful." }),
      overconfident,
    );

    expect(diagnosis.source).toBe("ai");
    expect(diagnosis.confidence).toBeLessThanOrEqual(0.8);
  });

  test("with no interpreter, ambiguous evidence falls back to the least aggressive class", () => {
    const diagnosis = diagnose(
      eventWith({ errorReason: "payment_failed", errorDescription: "Transaction unsuccessful." }),
      null,
    );
    expect(diagnosis.source).toBe("fallback");
  });

  test("the fixture interpreter is deterministic", () => {
    const event = eventWith({
      errorSource: "bank",
      errorStep: "payment_authorization",
      errorDescription: "Transaction unsuccessful.",
    });
    expect(fixtureInterpreter.interpret(event)).toEqual(fixtureInterpreter.interpret(event));
  });

  test("diagnosis recovers the true class for most of the population", () => {
    const population = generatePopulation({ masterSeed: SEED, caseCount: 1000 });
    const correct = population.filter(
      (latents) =>
        diagnose(buildEvent(SEED, latents), fixtureInterpreter).failureClass ===
        latents.failureClass,
    ).length;

    expect(correct / population.length).toBeGreaterThan(0.9);
  });

  test("non-payment entities never degrade into ambiguous evidence", () => {
    const population = generatePopulation({ masterSeed: SEED, caseCount: 1000 });
    for (const latents of population) {
      const event = buildEvent(SEED, latents);
      if (event.entity === "payment") continue;
      expect(diagnose(event, null).source).toBe("rule");
    }
  });
});

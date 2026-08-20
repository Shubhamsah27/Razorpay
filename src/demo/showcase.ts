import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createSimulatedExecutor } from "../execution/simulated";
import { createRecoupPolicy } from "../policies/recoup";
import { fixedRetryPolicy } from "../policies/fixedPolicy";
import { noActionPolicy } from "../policies/noAction";
import { runCase, type CaseAudit } from "../runtime/pipeline";
import { createOracle } from "../sim/oracle";
import { generatePopulation } from "../sim/world";
import { ActionStore } from "../store/actions";
import { summariseArm, type ArmMetrics } from "../eval/metrics";
import { summariseDecisions, type DecisionMetrics } from "../eval/decisions";
import { runArm } from "../eval/simulate";
import { HORIZON_HOURS, type ArmResult } from "../domain/types";
import { FIXED_CASE_COUNT, FIXED_MASTER_SEED } from "../eval/config";

const SHOWCASE_SEED = FIXED_MASTER_SEED;
const SHOWCASE_CASES = 220;

/** Faults tuned so the showcase always contains a reconciled provider failure. */
const SHOWCASE_FAULTS = {
  indeterminateRate: 0.12,
  failureRate: 0.03,
  landedWhenIndeterminateRate: 0.6,
};

export type SceneName =
  | "auto_payment_link"
  | "human_review"
  | "fraud_block"
  | "subscription_observation"
  | "reconciled_failure";

export interface TimelineSeries {
  armName: string;
  cumulativeRecoveredPaise: number[];
  cumulativeIncrementalPaise: number[];
}

export interface Timeline {
  hours: number[];
  series: TimelineSeries[];
}

export interface Showcase {
  seed: string;
  caseCount: number;
  arms: ArmMetrics[];
  decisions: DecisionMetrics;
  incrementalNetValuePaise: number;
  timeline: Timeline;
  scenes: Record<SceneName, string | null>;
  cases: CaseAudit[];
}

function pickScene(cases: CaseAudit[], predicate: (audit: CaseAudit) => boolean): string | null {
  return cases.find(predicate)?.caseId ?? null;
}

/** Sample points across the simulation horizon, in hours. */
const TIMELINE_STEP_HOURS = 12;

/**
 * Cumulative recovery through the horizon, per arm. Derived from the same
 * per-case outcomes the headline metrics use, so the curve and the totals can
 * never disagree.
 */
function buildTimeline(results: ArmResult[]): Timeline {
  const hours: number[] = [];
  for (let hour = 0; hour <= HORIZON_HOURS; hour += TIMELINE_STEP_HOURS) hours.push(hour);

  return {
    hours,
    series: results.map((result) => ({
      armName: result.armName,
      cumulativeRecoveredPaise: hours.map((hour) =>
        result.cases.reduce(
          (total, outcome) =>
            outcome.paidAtHour !== null && outcome.paidAtHour <= hour
              ? total + outcome.paidAmountPaise
              : total,
          0,
        ),
      ),
      cumulativeIncrementalPaise: hours.map((hour) =>
        result.cases.reduce(
          (total, outcome) =>
            outcome.paidAtHour !== null && outcome.paidAtHour <= hour
              ? total + outcome.incrementalAmountPaise
              : total,
          0,
        ),
      ),
    })),
  };
}

export async function buildShowcase(): Promise<Showcase> {
  const population = generatePopulation({
    masterSeed: SHOWCASE_SEED,
    caseCount: SHOWCASE_CASES,
  });
  const oracle = createOracle(SHOWCASE_SEED);
  const store = new ActionStore(":memory:");
  const executor = createSimulatedExecutor(SHOWCASE_SEED, SHOWCASE_FAULTS);
  const recoup = createRecoupPolicy();

  const audits: CaseAudit[] = [];
  for (const latents of population) {
    audits.push(
      await runCase(latents, {
        store,
        executor,
        policy: recoup.policy,
        decisions: recoup.decisions,
        oracle,
        masterSeed: SHOWCASE_SEED,
        // High-value and elevated-risk actions carry a recorded approval.
        reviewer: (action) =>
          recoup.decisions.some(
            (decision) =>
              decision.caseId === action.caseId &&
              decision.attemptNumber === action.attemptNumber &&
              decision.guard.decision === "review",
          ),
      }),
    );
  }

  // Headline metrics come from the full evaluation, not the smaller showcase set.
  const evalPopulation = generatePopulation({
    masterSeed: SHOWCASE_SEED,
    caseCount: FIXED_CASE_COUNT,
  });
  const evalRecoup = createRecoupPolicy();
  const armResults = [noActionPolicy, fixedRetryPolicy, evalRecoup.policy].map((policy) =>
    runArm(SHOWCASE_SEED, evalPopulation, policy),
  );
  const arms = armResults.map((result) => summariseArm(result, evalPopulation));
  const timeline = buildTimeline(armResults);
  const fixed = arms.find((arm) => arm.armName === fixedRetryPolicy.name)!;
  const recoupArm = arms.find((arm) => arm.armName === "recoup")!;

  const scenes: Record<SceneName, string | null> = {
    auto_payment_link: pickScene(audits, (audit) =>
      audit.actions.some(
        (action) =>
          action.actionKind === "razorpay_payment_link" &&
          action.state === "succeeded" &&
          !action.reconciled &&
          action.customerResponded,
      ),
    ),
    human_review: pickScene(audits, (audit) =>
      audit.decisions.some((decision) => decision.guard.decision === "review") &&
      audit.actions.length > 0,
    ),
    fraud_block: pickScene(audits, (audit) =>
      audit.decisions.some((decision) =>
        decision.guard.rules.some(
          (rule) => rule.rule === "fraud_diagnosis" || rule.rule === "frozen_class",
        ),
      ),
    ),
    subscription_observation: pickScene(audits, (audit) =>
      audit.actions.some(
        (action) => action.actionKind === "razorpay_subscription_observation",
      ),
    ),
    reconciled_failure: pickScene(audits, (audit) =>
      audit.actions.some((action) => action.reconciled),
    ),
  };

  store.close();

  return {
    seed: SHOWCASE_SEED,
    caseCount: SHOWCASE_CASES,
    arms,
    decisions: summariseDecisions(evalRecoup.decisions, evalPopulation),
    incrementalNetValuePaise: recoupArm.netValuePaise - fixed.netValuePaise,
    timeline,
    scenes,
    cases: audits,
  };
}

if (import.meta.main) {
  const outputPath = process.argv[2] ?? "web/src/data/showcase.json";
  const showcase = await buildShowcase();

  // Each decision repeats the case's diagnosis; drop the copy so the bundle
  // stays small without losing anything the Desk shows.
  const compact = {
    ...showcase,
    cases: showcase.cases.map((audit) => ({
      ...audit,
      decisions: audit.decisions.map(({ diagnosis, ...rest }) => rest),
    })),
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(compact)}\n`);

  const missing = Object.entries(showcase.scenes)
    .filter(([, caseId]) => caseId === null)
    .map(([name]) => name);

  console.log(`showcase written to ${outputPath}`);
  console.log(`  cases: ${showcase.cases.length}`);
  console.log(`  scenes: ${JSON.stringify(showcase.scenes, null, 2)}`);
  if (missing.length > 0) {
    console.error(`  MISSING SCENES: ${missing.join(", ")}`);
    process.exit(1);
  }
}

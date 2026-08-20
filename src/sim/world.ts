import { HORIZON_HOURS, type CaseLatents } from "../domain/types";
import { CLASS_WEIGHTS, FAILURE_CLASS_PROFILES } from "./profiles";
import { keyedBool, keyedInt, keyedRange, keyedUnit, keyedWeightedPick } from "./rng";

const NS = "case";

export interface WorldConfig {
  masterSeed: string;
  caseCount: number;
}

/**
 * Every latent is addressed by caseId alone, so a case drawn from a population
 * of 50 is identical to the same case drawn from a population of 5000.
 */
export function generateCase(masterSeed: string, caseId: string): CaseLatents {
  const failureClass = keyedWeightedPick(NS, masterSeed, CLASS_WEIGHTS, caseId, "class");
  const profile = FAILURE_CLASS_PROFILES[failureClass];

  const amountSkew = keyedUnit(NS, masterSeed, caseId, "amount");
  const [amountMin, amountMax] = profile.amountPaiseRange;
  const amountPaise = Math.round(amountMin + (amountMax - amountMin) * amountSkew ** 2.2);

  const paysOrganically = keyedBool(NS, masterSeed, profile.organicPayProb, caseId, "organic");
  const organicPayHour = paysOrganically
    ? Math.round(
        keyedRange(
          NS,
          masterSeed,
          profile.organicLagHours[0],
          profile.organicLagHours[1],
          caseId,
          "organic-lag",
        ),
      )
    : null;

  const salaryDayOfMonth = keyedInt(NS, masterSeed, 1, 7, caseId, "salary-day");

  return {
    caseId,
    failureClass,
    amountPaise,
    organicPayHour:
      organicPayHour !== null && organicPayHour <= HORIZON_HOURS ? organicPayHour : null,
    isFraud: keyedBool(NS, masterSeed, profile.fraudProb, caseId, "fraud"),
    responsiveness: keyedUnit(NS, masterSeed, caseId, "responsiveness"),
    fatigueTolerance: keyedInt(NS, masterSeed, 1, 4, caseId, "fatigue"),
    optedOut: keyedBool(NS, masterSeed, 0.06, caseId, "opt-out"),
    salaryDayOfMonth,
    salaryWindowHour: keyedInt(NS, masterSeed, 18, 200, caseId, "salary-window"),
    churnPenaltyPaise: Math.round(
      amountPaise * keyedRange(NS, masterSeed, 0.4, 2.5, caseId, "churn-penalty"),
    ),
    createdAtHour: 0,
  };
}

export function generatePopulation(config: WorldConfig): CaseLatents[] {
  const cases: CaseLatents[] = [];
  for (let index = 0; index < config.caseCount; index += 1) {
    cases.push(generateCase(config.masterSeed, `case_${String(index).padStart(5, "0")}`));
  }
  return cases;
}

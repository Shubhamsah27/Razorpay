import type { ArmResult, CaseLatents, FailureClass } from "../domain/types";

export interface ArmMetrics {
  armName: string;
  caseCount: number;
  paidCases: number;
  recoveryRate: number;
  grossRecoveredPaise: number;
  incrementalRecoveredPaise: number;
  actionCostPaise: number;
  churnPenaltyPaise: number;
  chargebackPenaltyPaise: number;
  netValuePaise: number;
  actionsExecuted: number;
  contactsMade: number;
  falsePositiveContacts: number;
  fraudulentCollections: number;
  fraudCasesAvoided: number;
  byFailureClass: Record<string, { cases: number; netValuePaise: number; paidCases: number }>;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function summariseArm(arm: ArmResult, population: CaseLatents[]): ArmMetrics {
  const classOf = new Map<string, FailureClass>(
    population.map((latents) => [latents.caseId, latents.failureClass]),
  );
  const byFailureClass: ArmMetrics["byFailureClass"] = {};

  for (const outcome of arm.cases) {
    const failureClass = classOf.get(outcome.caseId) ?? "unknown";
    const bucket = (byFailureClass[failureClass] ??= {
      cases: 0,
      netValuePaise: 0,
      paidCases: 0,
    });
    bucket.cases += 1;
    bucket.netValuePaise += outcome.netValuePaise;
    if (outcome.paid) bucket.paidCases += 1;
  }

  const paidCases = arm.cases.filter((outcome) => outcome.paid).length;

  return {
    armName: arm.armName,
    caseCount: arm.cases.length,
    paidCases,
    recoveryRate: arm.cases.length === 0 ? 0 : paidCases / arm.cases.length,
    grossRecoveredPaise: sum(arm.cases.map((outcome) => outcome.paidAmountPaise)),
    incrementalRecoveredPaise: sum(arm.cases.map((outcome) => outcome.incrementalAmountPaise)),
    actionCostPaise: sum(arm.cases.map((outcome) => outcome.actionCostPaise)),
    churnPenaltyPaise: sum(arm.cases.map((outcome) => outcome.churnPenaltyPaise)),
    chargebackPenaltyPaise: sum(arm.cases.map((outcome) => outcome.chargebackPenaltyPaise)),
    netValuePaise: sum(arm.cases.map((outcome) => outcome.netValuePaise)),
    actionsExecuted: sum(arm.cases.map((outcome) => outcome.actions.length)),
    contactsMade: sum(arm.cases.map((outcome) => outcome.contactsMade)),
    falsePositiveContacts: sum(arm.cases.map((outcome) => outcome.falsePositiveContacts)),
    fraudulentCollections: arm.cases.filter((outcome) => outcome.fraudulentCollection).length,
    fraudCasesAvoided: arm.cases.filter((outcome) => outcome.fraudCorrectlyAvoided).length,
    byFailureClass,
  };
}

export function formatRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const rupees = Math.abs(paise) / 100;
  return `${sign}Rs ${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

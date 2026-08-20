import type { CaseLatents } from "../domain/types";
import type { DecisionRecord } from "../policies/recoup";

export interface DecisionMetrics {
  decisionsRecorded: number;
  approved: number;
  blocked: number;
  rejected: number;
  frozen: number;
  diagnosedByRule: number;
  diagnosedByAi: number;
  diagnosedByFallback: number;
  diagnosisAccuracy: number;
  aiDiagnosisAccuracy: number;
  /** Fraud cases where every proposed action was stopped. */
  fraudCasesFrozen: number;
  /** Non-fraud cases stopped by a fraud rule. */
  fraudBlocksOnLegitimateCases: number;
  blocksByRule: Record<string, number>;
}

export function summariseDecisions(
  decisions: DecisionRecord[],
  population: CaseLatents[],
): DecisionMetrics {
  const truth = new Map(population.map((latents) => [latents.caseId, latents]));
  const blocksByRule: Record<string, number> = {};

  let correct = 0;
  let aiTotal = 0;
  let aiCorrect = 0;
  const stoppedCases = new Set<string>();
  const actedCases = new Set<string>();
  const fraudRuleCases = new Set<string>();

  const firstPerCase = new Map<string, DecisionRecord>();
  for (const decision of decisions) {
    if (!firstPerCase.has(decision.caseId)) firstPerCase.set(decision.caseId, decision);

    if (decision.outcome === "approved") actedCases.add(decision.caseId);
    else stoppedCases.add(decision.caseId);

    for (const rule of decision.guard.rules) {
      if (rule.decision !== "blocked") continue;
      blocksByRule[rule.rule] = (blocksByRule[rule.rule] ?? 0) + 1;
      if (rule.rule === "fraud_diagnosis" || rule.rule === "fraud_risk_score") {
        fraudRuleCases.add(decision.caseId);
      }
    }
  }

  for (const decision of firstPerCase.values()) {
    const latents = truth.get(decision.caseId);
    if (latents === undefined) continue;
    const isCorrect = decision.diagnosis.failureClass === latents.failureClass;
    if (isCorrect) correct += 1;
    if (decision.diagnosis.source === "ai") {
      aiTotal += 1;
      if (isCorrect) aiCorrect += 1;
    }
  }

  const total = firstPerCase.size;
  const bySource = (source: string): number =>
    [...firstPerCase.values()].filter((decision) => decision.diagnosis.source === source).length;

  const fraudCases = population.filter((latents) => latents.isFraud);

  return {
    decisionsRecorded: decisions.length,
    approved: decisions.filter((decision) => decision.outcome === "approved").length,
    blocked: decisions.filter((decision) => decision.outcome === "blocked").length,
    rejected: decisions.filter((decision) => decision.outcome === "rejected").length,
    frozen: decisions.filter((decision) => decision.outcome === "not_supported").length,
    diagnosedByRule: bySource("rule"),
    diagnosedByAi: bySource("ai"),
    diagnosedByFallback: bySource("fallback"),
    diagnosisAccuracy: total === 0 ? 0 : correct / total,
    aiDiagnosisAccuracy: aiTotal === 0 ? 0 : aiCorrect / aiTotal,
    fraudCasesFrozen: fraudCases.filter(
      (latents) => !actedCases.has(latents.caseId) && stoppedCases.has(latents.caseId),
    ).length,
    fraudBlocksOnLegitimateCases: [...fraudRuleCases].filter(
      (caseId) => truth.get(caseId)?.isFraud === false,
    ).length,
    blocksByRule,
  };
}

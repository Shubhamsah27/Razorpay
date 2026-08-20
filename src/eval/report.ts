import type { DecisionMetrics } from "./decisions";
import { formatRupees, type ArmMetrics } from "./metrics";

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export interface ReportInput {
  masterSeed: string;
  caseCount: number;
  arms: ArmMetrics[];
  /** Arm the incremental comparison is measured against. */
  baselineArmName: string;
}

export function renderReport(input: ReportInput): string {
  const lines: string[] = [];
  const label = 26;
  const column = 20;

  lines.push("RECOUP - EVALUATION REPORT");
  lines.push(`seed=${input.masterSeed}  cases=${input.caseCount}`);
  lines.push("");
  lines.push(
    "All arms read the same pre-generated potential-outcome table. Results are",
  );
  lines.push(
    "simulated causal effects in a known synthetic world, not production results.",
  );
  lines.push("");

  const rows: [string, (metrics: ArmMetrics) => string][] = [
    ["cases", (m) => String(m.caseCount)],
    ["paid cases", (m) => String(m.paidCases)],
    ["recovery rate", (m) => percent(m.recoveryRate)],
    ["gross recovered", (m) => formatRupees(m.grossRecoveredPaise)],
    ["incremental recovered", (m) => formatRupees(m.incrementalRecoveredPaise)],
    ["action cost", (m) => formatRupees(m.actionCostPaise)],
    ["churn penalty", (m) => formatRupees(m.churnPenaltyPaise)],
    ["chargeback penalty", (m) => formatRupees(m.chargebackPenaltyPaise)],
    ["net value", (m) => formatRupees(m.netValuePaise)],
    ["actions executed", (m) => String(m.actionsExecuted)],
    ["contacts made", (m) => String(m.contactsMade)],
    ["false-positive contacts", (m) => String(m.falsePositiveContacts)],
    ["fraudulent collections", (m) => String(m.fraudulentCollections)],
    ["fraud cases untouched", (m) => String(m.fraudCasesAvoided)],
  ];

  lines.push(pad("metric", label) + input.arms.map((m) => padLeft(m.armName, column)).join(""));
  lines.push("-".repeat(label + column * input.arms.length));
  for (const [name, render] of rows) {
    lines.push(pad(name, label) + input.arms.map((m) => padLeft(render(m), column)).join(""));
  }

  const baseline = input.arms.find((m) => m.armName === input.baselineArmName);
  const challenger = input.arms[input.arms.length - 1];
  if (baseline && challenger && baseline.armName !== challenger.armName) {
    lines.push("");
    lines.push(`PRIMARY METRIC - incremental recovery vs ${baseline.armName}`);
    lines.push(
      `  ${formatRupees(challenger.netValuePaise - baseline.netValuePaise)} net value over ${input.caseCount} cases`,
    );
  }

  lines.push("");
  lines.push("NET VALUE BY FAILURE CLASS");
  const classes = Object.keys(input.arms[0]?.byFailureClass ?? {}).sort();
  lines.push(
    pad("failure class", label) +
      padLeft("cases", 8) +
      input.arms.map((m) => padLeft(m.armName, column)).join(""),
  );
  lines.push("-".repeat(label + 8 + column * input.arms.length));
  for (const failureClass of classes) {
    const cases = input.arms[0]?.byFailureClass[failureClass]?.cases ?? 0;
    lines.push(
      pad(failureClass, label) +
        padLeft(String(cases), 8) +
        input.arms
          .map((m) => padLeft(formatRupees(m.byFailureClass[failureClass]?.netValuePaise ?? 0), column))
          .join(""),
    );
  }

  return lines.join("\n");
}

export function renderDecisionSection(metrics: DecisionMetrics): string {
  const lines: string[] = [];
  const label = 30;

  const row = (name: string, value: string): void => {
    lines.push(pad(name, label) + padLeft(value, 14));
  };

  lines.push("RECOUP DECISION AUDIT");
  lines.push("-".repeat(label + 14));
  row("decisions recorded", String(metrics.decisionsRecorded));
  row("approved", String(metrics.approved));
  row("blocked by guard", String(metrics.blocked));
  row("rejected at review", String(metrics.rejected));
  row("frozen (no supported action)", String(metrics.frozen));
  lines.push("");
  row("diagnosed by rule", String(metrics.diagnosedByRule));
  row("diagnosed by AI", String(metrics.diagnosedByAi));
  row("diagnosed by fallback", String(metrics.diagnosedByFallback));
  row("diagnosis accuracy", percent(metrics.diagnosisAccuracy));
  row("AI-path accuracy", percent(metrics.aiDiagnosisAccuracy));
  lines.push("");
  row("fraud cases frozen", String(metrics.fraudCasesFrozen));
  row("fraud blocks on clean cases", String(metrics.fraudBlocksOnLegitimateCases));

  lines.push("");
  lines.push("BLOCKS BY RULE");
  lines.push("-".repeat(label + 14));
  for (const [rule, count] of Object.entries(metrics.blocksByRule).sort(
    (left, right) => right[1] - left[1],
  )) {
    row(rule, String(count));
  }

  return lines.join("\n");
}

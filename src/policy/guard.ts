import type { PlannedAction } from "../domain/types";
import type { CaseView, ExecutedAction } from "../domain/view";
import type { Diagnosis } from "../diagnosis/classifier";

export type GuardDecision = "automatic" | "review" | "blocked";

export interface GuardRuleResult {
  rule: string;
  decision: GuardDecision;
  detail: string;
}

export interface GuardResult {
  decision: GuardDecision;
  /** Present when a rule defers the action rather than blocking it. */
  deferToHour: number | null;
  rules: GuardRuleResult[];
}

export interface GuardConfig {
  killSwitchEngaged: boolean;
  fraudRiskThreshold: number;
  reviewRiskThreshold: number;
  highValueReviewPaise: number;
  maxContactsPerCase: number;
  minHoursBetweenContacts: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  minExpectedValuePaise: number;
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  killSwitchEngaged: false,
  fraudRiskThreshold: 0.55,
  reviewRiskThreshold: 0.4,
  highValueReviewPaise: 50_000_00,
  maxContactsPerCase: 3,
  minHoursBetweenContacts: 20,
  quietHoursStart: 21,
  quietHoursEnd: 8,
  minExpectedValuePaise: 0,
};

function isContact(action: PlannedAction): boolean {
  return (
    action.actionKind === "simulated_contact" || action.actionKind === "razorpay_payment_link"
  );
}

function hourOfDay(scheduledAtHour: number): number {
  // Cases originate at 10:00 local time; the simulator counts hours from there.
  return (10 + Math.floor(scheduledAtHour)) % 24;
}

function inQuietHours(hour: number, config: GuardConfig): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = config;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/**
 * The earliest hour at or after `fromHour` that is outside quiet hours. Applied
 * again after an approval lands, since the wait can push an action back into a
 * window the first check had already cleared.
 */
export function nextContactableHour(fromHour: number, config: GuardConfig): number {
  let candidate = Math.ceil(fromHour);
  for (let step = 0; step < 48; step += 1) {
    if (!inQuietHours(hourOfDay(candidate), config)) return candidate;
    candidate += 1;
  }
  return candidate;
}

/**
 * Deterministic safety rules. Nothing in this module consults a model, and no
 * model output can reach a decision here: the guard runs on the proposed action
 * after any AI involvement is already finished.
 */
export function evaluateGuard(
  view: CaseView,
  diagnosis: Diagnosis,
  action: PlannedAction,
  history: ExecutedAction[],
  expectedValuePaise: number,
  config: GuardConfig = DEFAULT_GUARD_CONFIG,
): GuardResult {
  const rules: GuardRuleResult[] = [];
  const contactAction = isContact(action);

  if (config.killSwitchEngaged) {
    rules.push({
      rule: "kill_switch",
      decision: "blocked",
      detail: "global kill switch is engaged",
    });
  }

  if (contactAction && view.hasOptedOut) {
    rules.push({
      rule: "opt_out",
      decision: "blocked",
      detail: "customer is on the suppression list",
    });
  }

  if (diagnosis.failureClass === "suspected_fraud") {
    rules.push({
      rule: "fraud_diagnosis",
      decision: "blocked",
      detail: "diagnosed as suspected fraud; freeze without retry or contact",
    });
  }

  if (view.riskScore >= config.fraudRiskThreshold) {
    rules.push({
      rule: "fraud_risk_score",
      decision: "blocked",
      detail: `risk score ${view.riskScore.toFixed(2)} at or above ${config.fraudRiskThreshold}`,
    });
  } else if (view.riskScore >= config.reviewRiskThreshold) {
    rules.push({
      rule: "elevated_risk",
      decision: "review",
      detail: `risk score ${view.riskScore.toFixed(2)} warrants human review`,
    });
  }

  const contacts = history.filter((entry) => isContact(entry.action));
  if (contactAction && contacts.length >= config.maxContactsPerCase) {
    rules.push({
      rule: "contact_cap",
      decision: "blocked",
      detail: `already made ${contacts.length} contacts, cap is ${config.maxContactsPerCase}`,
    });
  }

  const lastContact = contacts[contacts.length - 1];
  if (
    contactAction &&
    lastContact !== undefined &&
    action.scheduledAtHour - lastContact.action.scheduledAtHour < config.minHoursBetweenContacts
  ) {
    rules.push({
      rule: "contact_spacing",
      decision: "blocked",
      detail: `less than ${config.minHoursBetweenContacts}h since the previous contact`,
    });
  }

  if (expectedValuePaise < config.minExpectedValuePaise) {
    rules.push({
      rule: "negative_expected_value",
      decision: "blocked",
      detail: "expected value does not justify the action",
    });
  }

  if (view.amountPaise >= config.highValueReviewPaise) {
    rules.push({
      rule: "high_value",
      decision: "review",
      detail: `amount at risk is above the automatic ceiling`,
    });
  }

  if (diagnosis.failureClass === "mandate_revoked") {
    rules.push({
      rule: "mandate_reauthorisation",
      decision: "review",
      detail: "reauthorisation requires a human decision",
    });
  }

  if (diagnosis.source !== "rule" && diagnosis.confidence < 0.6) {
    rules.push({
      rule: "low_diagnosis_confidence",
      decision: "review",
      detail: `${diagnosis.source} diagnosis at ${diagnosis.confidence.toFixed(2)} confidence`,
    });
  }

  let deferToHour: number | null = null;
  if (contactAction && inQuietHours(hourOfDay(action.scheduledAtHour), config)) {
    deferToHour = nextContactableHour(action.scheduledAtHour, config);
    rules.push({
      rule: "quiet_hours",
      decision: "automatic",
      detail: `deferred to hour ${deferToHour} to respect quiet hours`,
    });
  }

  const decision: GuardDecision = rules.some((rule) => rule.decision === "blocked")
    ? "blocked"
    : rules.some((rule) => rule.decision === "review")
      ? "review"
      : "automatic";

  return { decision, deferToHour, rules };
}

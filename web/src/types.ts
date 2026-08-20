export interface GuardRule {
  rule: string;
  decision: "automatic" | "review" | "blocked";
  detail: string;
}

export interface DecisionRecord {
  caseId: string;
  attemptNumber: number;
  intent: string;
  actionKind: string;
  channel: string;
  scheduledAtHour: number;
  expectedValuePaise: number;
  guard: { decision: string; deferToHour: number | null; rules: GuardRule[] };
  outcome: "approved" | "blocked" | "rejected" | "not_supported";
  note: string;
}

export interface ActionAudit {
  actionKey: string;
  referenceId: string;
  actionKind: string;
  executionDomain: "simulated" | "razorpay";
  channel: string;
  attemptNumber: number;
  scheduledAtHour: number;
  state: string;
  providerId: string | null;
  transitions: { from: string; to: string; reason: string }[];
  attemptCount: number;
  reconciled: boolean;
  customerResponded: boolean;
}

export interface PaymentEvent {
  eventId: string;
  entity: string;
  errorCode: string | null;
  errorReason: string | null;
  errorDescription: string;
  errorSource: string | null;
  errorStep: string | null;
  subscriptionStatus: string | null;
}

export interface CaseAudit {
  caseId: string;
  amountPaise: number;
  event: PaymentEvent;
  riskScore: number;
  hasOptedOut: boolean;
  diagnosis: {
    failureClass: string;
    confidence: number;
    source: "rule" | "ai" | "fallback";
    rationale: string;
  };
  decisions: DecisionRecord[];
  actions: ActionAudit[];
  exceptions: { kind: string; detail: string }[];
  paid: boolean;
  paidAtHour: number | null;
  incrementalPaise: number;
}

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
  fraudCasesFrozen: number;
  fraudBlocksOnLegitimateCases: number;
  blocksByRule: Record<string, number>;
}

export type SceneName =
  | "auto_payment_link"
  | "human_review"
  | "fraud_block"
  | "subscription_observation"
  | "reconciled_failure";

export interface Showcase {
  seed: string;
  caseCount: number;
  arms: ArmMetrics[];
  decisions: DecisionMetrics;
  incrementalNetValuePaise: number;
  scenes: Record<SceneName, string | null>;
  cases: CaseAudit[];
}

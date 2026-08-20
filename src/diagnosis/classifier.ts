import { FAILURE_CLASSES, type FailureClass } from "../domain/types";
import type { PaymentEvent } from "./events";

export type DiagnosisSource = "rule" | "ai" | "fallback";

export interface Diagnosis {
  failureClass: FailureClass;
  confidence: number;
  source: DiagnosisSource;
  rationale: string;
}

/**
 * Interprets evidence the rule table could not resolve. Constrained to naming a
 * failure class — it can never authorise an action, move money, or decide that
 * an external effect succeeded.
 */
export interface AmbiguityInterpreter {
  readonly name: string;
  interpret(event: PaymentEvent): { failureClass: string; confidence: number; rationale: string };
}

interface Rule {
  failureClass: FailureClass;
  confidence: number;
  matches(event: PaymentEvent): boolean;
}

function describes(event: PaymentEvent, ...needles: string[]): boolean {
  const haystack = event.errorDescription.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

const RULES: Rule[] = [
  {
    failureClass: "suspected_fraud",
    confidence: 0.93,
    matches: (event) => describes(event, "fraud", "suspected fraudulent"),
  },
  {
    failureClass: "invoice_overdue",
    confidence: 0.97,
    matches: (event) => event.entity === "invoice",
  },
  {
    failureClass: "checkout_abandoned",
    confidence: 0.96,
    matches: (event) => event.entity === "checkout",
  },
  {
    failureClass: "mandate_revoked",
    confidence: 0.95,
    matches: (event) =>
      event.errorReason === "mandate_revoked" || describes(event, "mandate", "e-mandate"),
  },
  {
    failureClass: "subscription_pending",
    confidence: 0.94,
    matches: (event) =>
      event.entity === "subscription" && event.subscriptionStatus === "pending",
  },
  {
    failureClass: "subscription_halted",
    confidence: 0.94,
    matches: (event) =>
      event.entity === "subscription" && event.subscriptionStatus === "halted",
  },
  {
    failureClass: "card_expired",
    confidence: 0.96,
    matches: (event) => event.errorReason === "card_expired" || describes(event, "expired"),
  },
  {
    failureClass: "insufficient_funds",
    confidence: 0.95,
    matches: (event) =>
      event.errorReason === "insufficient_funds" ||
      describes(event, "insufficient balance", "insufficient funds"),
  },
  {
    failureClass: "otp_timeout",
    confidence: 0.9,
    matches: (event) => event.errorReason === "invalid_otp" || describes(event, "otp"),
  },
  {
    failureClass: "three_ds_drop",
    confidence: 0.89,
    matches: (event) =>
      event.errorReason === "payment_authentication_failed" ||
      describes(event, "3d secure", "authentication"),
  },
  {
    failureClass: "do_not_honour",
    confidence: 0.91,
    matches: (event) => describes(event, "do not honour", "do not honor"),
  },
  {
    failureClass: "issuer_down",
    confidence: 0.88,
    matches: (event) =>
      event.errorReason === "issuer_unavailable" ||
      (event.errorSource === "bank" && describes(event, "bank's end", "issuing bank")),
  },
  {
    failureClass: "gateway_timeout",
    confidence: 0.87,
    matches: (event) =>
      event.errorSource === "gateway" && describes(event, "timed out", "timeout", "server error"),
  },
];

/**
 * A class we can act on with no risk of an inappropriate collection attempt when
 * the evidence never resolves.
 */
const SAFE_DEFAULT: FailureClass = "checkout_abandoned";

const VALID_CLASSES = new Set<string>(FAILURE_CLASSES);

export function diagnose(
  event: PaymentEvent,
  interpreter: AmbiguityInterpreter | null,
): Diagnosis {
  for (const rule of RULES) {
    if (rule.matches(event)) {
      return {
        failureClass: rule.failureClass,
        confidence: rule.confidence,
        source: "rule",
        rationale: `matched deterministic rule for ${rule.failureClass}`,
      };
    }
  }

  if (interpreter !== null) {
    const proposal = interpreter.interpret(event);
    // The interpreter's output is untrusted text; anything outside the known
    // vocabulary is discarded rather than acted on.
    if (VALID_CLASSES.has(proposal.failureClass)) {
      return {
        failureClass: proposal.failureClass as FailureClass,
        confidence: Math.min(0.8, Math.max(0, proposal.confidence)),
        source: "ai",
        rationale: proposal.rationale,
      };
    }
  }

  return {
    failureClass: SAFE_DEFAULT,
    confidence: 0.25,
    source: "fallback",
    rationale: "evidence did not resolve; defaulted to the least aggressive class",
  };
}

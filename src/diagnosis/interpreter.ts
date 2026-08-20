import type { AmbiguityInterpreter } from "./classifier";
import type { PaymentEvent } from "./events";

interface RecordedResponse {
  failureClass: string;
  confidence: number;
  rationale: string;
}

function fixtureKey(source: string | null, step: string | null): string {
  return `${source ?? "unknown"}|${step ?? "unknown"}`;
}

/**
 * Recorded interpretations, so `bun run eval` and `bun run demo` are fully
 * deterministic and need no API key. Each entry is the reading a model gives
 * when the explicit reason is missing but the structural hints survive.
 */
const RECORDED: Record<string, RecordedResponse> = {
  [fixtureKey("customer", "payment_authentication")]: {
    failureClass: "otp_timeout",
    confidence: 0.58,
    rationale:
      "Failure occurred at the authentication step on the customer's side with no explicit reason, which most often means an abandoned or expired OTP rather than a decline.",
  },
  [fixtureKey("customer", "payment_authorization")]: {
    failureClass: "insufficient_funds",
    confidence: 0.55,
    rationale:
      "A customer-side authorization failure with the reason suppressed is most commonly a balance shortfall; issuers frequently mask this.",
  },
  [fixtureKey("customer", "payment_initiation")]: {
    failureClass: "card_expired",
    confidence: 0.52,
    rationale:
      "Failing before authorization on the customer's side points to an instrument problem such as an expired card.",
  },
  [fixtureKey("bank", "payment_authorization")]: {
    failureClass: "issuer_down",
    confidence: 0.5,
    rationale:
      "A bank-sourced authorization failure with a generic description is more often issuer unavailability than a deliberate decline.",
  },
  [fixtureKey("bank", "payment_authentication")]: {
    failureClass: "three_ds_drop",
    confidence: 0.48,
    rationale:
      "Bank-sourced authentication failures usually reflect an incomplete 3D Secure challenge.",
  },
  [fixtureKey("gateway", "payment_authorization")]: {
    failureClass: "gateway_timeout",
    confidence: 0.62,
    rationale: "A gateway-sourced authorization failure indicates a timeout or transport error.",
  },
};

/**
 * Deterministic stand-in for the live model. Returns the recorded reading for
 * the event's structural signature.
 */
export const fixtureInterpreter: AmbiguityInterpreter = {
  name: "fixture",
  interpret(event: PaymentEvent) {
    const recorded = RECORDED[fixtureKey(event.errorSource, event.errorStep)];
    if (recorded !== undefined) return recorded;
    return {
      failureClass: "checkout_abandoned",
      confidence: 0.2,
      rationale: "No recorded reading matches this evidence signature.",
    };
  },
};

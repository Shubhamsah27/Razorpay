import {
  HORIZON_HOURS,
  type ArmResult,
  type CaseArmOutcome,
  type CaseLatents,
  type PlannedAction,
} from "../domain/types";
import { toCaseView, type ExecutedAction, type Policy } from "../domain/view";
import { createOracle, toTimeBucket, type Oracle } from "../sim/oracle";

const MAX_ACTIONS_PER_CASE = 12;
const ORGANIC = "organic";

/** Scheme fee and handling cost when a collected payment is charged back. */
const CHARGEBACK_FEE_PAISE = 50_000;

function isContact(action: PlannedAction): boolean {
  return (
    action.actionKind === "simulated_contact" || action.actionKind === "razorpay_payment_link"
  );
}

export function simulateCase(
  oracle: Oracle,
  masterSeed: string,
  latents: CaseLatents,
  policy: Policy,
): CaseArmOutcome {
  const view = toCaseView(masterSeed, latents);
  const history: ExecutedAction[] = [];
  const actions: PlannedAction[] = [];

  let settledAtHour: number | null = null;
  let settledBy: string | null = null;
  let actionCostPaise = 0;
  let churned = false;
  let contactsMade = 0;
  let lastScheduledHour = -1;

  for (let step = 0; step < MAX_ACTIONS_PER_CASE; step += 1) {
    const action = policy.next(view, history);
    if (action === null) break;
    if (action.scheduledAtHour > HORIZON_HOURS) break;

    // A policy must schedule forward in time; the simulator resolves in order.
    if (action.scheduledAtHour < lastScheduledHour) {
      throw new Error(
        `${policy.name} scheduled ${action.actionId} at hour ${action.scheduledAtHour}, before its previous action at hour ${lastScheduledHour}`,
      );
    }
    lastScheduledHour = action.scheduledAtHour;

    // The case resolved before this action was due, so it is never sent.
    if (settledAtHour !== null && action.scheduledAtHour >= settledAtHour) break;
    if (
      settledAtHour === null &&
      latents.organicPayHour !== null &&
      latents.organicPayHour <= action.scheduledAtHour
    ) {
      settledAtHour = latents.organicPayHour;
      settledBy = ORGANIC;
      break;
    }

    const outcome = oracle.resolve(latents, {
      caseId: latents.caseId,
      actionKind: action.actionKind,
      channel: action.channel,
      timeBucket: toTimeBucket(action.scheduledAtHour),
      attemptNumber: action.attemptNumber,
    });

    actions.push(action);
    actionCostPaise += outcome.contactCostPaise;
    if (isContact(action)) contactsMade += 1;
    if (outcome.negativeResponse) churned = true;
    history.push({ action, responded: outcome.responded, costPaise: outcome.contactCostPaise });

    if (!outcome.responded) continue;

    const payHour = action.scheduledAtHour + outcome.responseLagHours;
    const withinWindow = payHour <= action.scheduledAtHour + action.attributionWindowHours;
    if (!withinWindow || payHour > HORIZON_HOURS) continue;

    if (latents.organicPayHour !== null && latents.organicPayHour <= payHour) {
      // The customer was already going to pay by then; the action gets no credit.
      settledAtHour = latents.organicPayHour;
      settledBy = ORGANIC;
    } else {
      settledAtHour = payHour;
      settledBy = action.actionId;
    }
  }

  if (settledAtHour === null && latents.organicPayHour !== null) {
    settledAtHour = latents.organicPayHour;
    settledBy = ORGANIC;
  }

  const paid = settledAtHour !== null;
  const attributedActionId = settledBy === ORGANIC ? null : settledBy;
  const churnPenaltyPaise = churned ? latents.churnPenaltyPaise : 0;
  const paidAmountPaise = paid ? latents.amountPaise : 0;

  // Money collected on a fraudulent case is reversed and costs a fee on top, so
  // "recovering" it is strictly worse than never touching the case.
  const fraudulentCollection = latents.isFraud && paid;
  const chargebackPenaltyPaise = fraudulentCollection
    ? paidAmountPaise + CHARGEBACK_FEE_PAISE
    : 0;

  return {
    caseId: latents.caseId,
    paid,
    paidAtHour: settledAtHour,
    paidAmountPaise,
    attributedActionId,
    incrementalAmountPaise: attributedActionId !== null ? latents.amountPaise : 0,
    actionCostPaise,
    churnPenaltyPaise,
    chargebackPenaltyPaise,
    netValuePaise:
      paidAmountPaise - actionCostPaise - churnPenaltyPaise - chargebackPenaltyPaise,
    contactsMade,
    // Money spent reaching someone whose own behaviour would have paid anyway.
    falsePositiveContacts: latents.organicPayHour !== null ? contactsMade : 0,
    fraudulentCollection,
    fraudCorrectlyAvoided: latents.isFraud && actions.length === 0,
    actions,
  };
}

export function runArm(
  masterSeed: string,
  population: CaseLatents[],
  policy: Policy,
): ArmResult {
  const oracle = createOracle(masterSeed);
  return {
    armName: policy.name,
    cases: population.map((latents) => simulateCase(oracle, masterSeed, latents, policy)),
  };
}

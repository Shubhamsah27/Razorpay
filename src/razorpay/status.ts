import { loadContext } from "./context";
import { rupeesLabel } from "./format";

/** Reads back what actually happened, so the demo can be verified after the fact. */
const context = loadContext();
const actions = context.store.listActions();

console.log("\nACTIONS");
if (actions.length === 0) console.log("  none yet — run bun run razorpay:link");
for (const action of actions) {
  console.log(
    `  ${action.case_id}  ${action.state.padEnd(16)} ${action.reference_id}  ${
      action.provider_id ?? "-"
    }`,
  );
  for (const t of context.store.transitions(action.action_key)) {
    console.log(`      ${t.from_state} -> ${t.to_state}  (${t.reason})`);
  }
}

const receipts = context.store.database
  .query(`SELECT provider, event_id, received_at FROM webhook_receipt ORDER BY id`)
  .all() as { provider: string; event_id: string; received_at: string }[];

console.log("\nWEBHOOK RECEIPTS");
if (receipts.length === 0) console.log("  none yet");
for (const r of receipts) console.log(`  ${r.received_at}  ${r.provider}  ${r.event_id}`);

console.log("\nOUTCOMES");
const outcomes = context.store.outcomes();
if (outcomes.length === 0) console.log("  none yet");
for (const o of outcomes) {
  console.log(`  ${o.case_id}  ${o.kind}  ${rupeesLabel(o.amount_paise)}  ${o.occurred_at}`);
}

console.log("\nOPEN EXCEPTIONS");
const open = context.store.openExceptions();
if (open.length === 0) console.log("  none");
for (const e of open) console.log(`  ${e.case_id}  ${e.kind}  ${e.detail}`);

console.log("");
context.store.close();

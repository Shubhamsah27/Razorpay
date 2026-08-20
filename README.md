# Recoup

Recoup detects revenue at risk, chooses a **bounded** recovery action, applies deterministic
safety rules, and measures incremental recovery against shared counterfactual outcomes.

Built for the Razorpay AI Buildathon, **AI Revenue Recovery** track.

## The two claims this project refuses to make

Most "payment recovery" demos quietly rest on two things that are not true. Recoup is
designed around not needing either.

**1. It does not retry arbitrary failed card payments through Razorpay.**
A merchant cannot silently re-charge a card that just failed. So for every ordinary card
failure, Recoup creates a *new customer-initiated collection path* — a Payment Link — rather
than pretending to re-run the original charge. Recurring subscription retries are owned by
Razorpay; Recoup **observes** those state transitions and decides whether a separate
customer intervention is even warranted.

The naive "retry 3x every 24h" policy still appears in the evaluation, because it is a real
merchant policy worth beating. Its retries are **simulator events, never Razorpay API calls**,
and every action carries its execution domain so the UI can never blur the line:

| Action kind | What it means |
|---|---|
| `simulated_retry` | Simulator only. Never leaves the process. |
| `simulated_contact` | Simulated messaging ledger. |
| `razorpay_payment_link` | A real Payment Link in Razorpay Test Mode. |
| `razorpay_subscription_observation` | Razorpay-owned retry, observed not commanded. |

**2. It does not let policies share a random-number generator.**
If two evaluation arms draw from the same sequential RNG, an arm that takes more actions
shifts every later draw, and the comparison between them is meaningless. See below.

## The causal model

Before any policy runs, the world is fixed. Every possible result is addressed by a key:

```
(caseId, actionKind, channel, timeBucket, attemptNumber)
       │
       └─> draw = hash(masterSeed, ...key)  ∈ [0, 1)
```

Taking an action **reveals** a cell of this table. It never creates one, and never disturbs
another cell. That gives the property the whole evaluation rests on:

> Two arms that take the same action against the same case at the same time always see the
> same outcome — regardless of what else either arm did.

The response *probability* a draw is compared against depends only on the case's own immutable
latents and the components of the key. It never depends on runtime history. This is what makes
"adding an unrelated action does not shift another action's outcome" true by construction
rather than by luck.

Contact fatigue is modelled the same way: each customer has a latent `fatigueTolerance`, and
the `attemptNumber` in the key decides whether an attempt crosses it. Cross-channel pressure is
a *policy* constraint enforced by the safety guard, not a mutation of the outcome table.

### Attribution

A recovery is credited to an action only when all of these hold:

- the payment falls inside that action's declared attribution window,
- the customer's organic path would **not** already have paid by then,
- no earlier eligible action owns the recovery,
- the event has not already been attributed.

Customers who were going to pay anyway are never counted as incremental recovery.

### Why collecting fraud scores negative

Money collected on a fraudulent case is reversed and costs a scheme fee on top. Net value
therefore subtracts the reversal *and* the fee, which makes "recover everything" a losing
strategy and gives the fraud block real economic weight rather than a compliance checkbox.

## Results on the committed seed

`bun run eval`, 2000 cases, seed `recoup-buildathon-2026-v1`:

| Metric | no_action | fixed_retry_3x24h | **recoup** |
|---|---:|---:|---:|
| recovery rate | 22.3% | 31.8% | **54.8%** |
| net value | ₹29.31L | ₹42.79L | **₹75.12L** |
| actions executed | 0 | 5,108 | **1,771** |
| churn penalty | ₹0 | ₹0 | ₹8,114 |
| fraud cases untouched | 69 | 1 | **65** |

**Incremental recovery vs the fixed policy: ₹32.33L**, using roughly a third of
the actions. Diagnosis accuracy is 97.1% overall; on the ambiguous-evidence path
that reaches the AI interpreter it is 74.2%.

Two results worth stating plainly rather than burying:

**Naive retry beats Recoup on `issuer_down`** (₹12.67L vs ₹12.31L). When an issuer
outage clears, silently re-charging really is better than asking the customer to pay
again — no friction, no message. Recoup loses that class *because it will not fake a
retry it cannot perform*. That gap is the honest price of the provider boundary.

**Pricing customer fatigue was the single biggest lever.** An earlier version scored
conversion and channel cost but ignored the cost of annoying someone. It bought
revenue with customer lifetime value: ₹27.7L of churn, and `invoice_overdue` scored
*worse than doing nothing*. Charging expected relationship damage against each repeat
contact cut churn to ₹8.1k and raised net value while taking **fewer** actions. The
guard now blocks ~1,400 low-value follow-ups that the naive policy would have sent.

## Evaluation arms

| Arm | Behaviour |
|---|---|
| `no_action` | Observes the organic outcome only. Spends nothing. |
| `fixed_retry_3x24h` | Simulated retries at fixed 24h intervals, on every failure. |
| `recoup` | Diagnosis, expected value, safety guard, bounded recovery actions. |

Primary metric: **net value(recoup) − net value(fixed policy)**.

Policies see a `CaseView`, never the ground-truth latents. Whether the customer would have
paid anyway, and whether the case is really fraud, are deliberately withheld — a policy only
gets noisy correlated signals, so it cannot peek at the answer it is scored on.

## Running it

```bash
bun install
bun test        # counterfactual integrity, attribution, provider boundary
bun run eval    # deterministic report for the committed seed
```

`bun run eval` is byte-identical for a fixed seed. No AI key or external infrastructure is
needed for the evaluation or the demo.

## Status

- [x] **Slice 1** — shared evaluation world, keyed potential outcomes, baseline arms
- [x] **Slice 2** — diagnosis, policy, safety guard
- [x] **Slice 3** — durable action state, atomic claim, idempotency
- [x] **Slice 4** — Recoup arm and attribution metrics
- [ ] **Slice 5** — Razorpay Test Mode integration and reconciliation
- [ ] **Slice 6** — Recovery Desk UI
- [ ] **Slice 7** — submission package

## Honesty boundary

The effectiveness numbers are **simulated causal results from a known synthetic world**. They
demonstrate that the policy makes better decisions than the baseline *given that world*; they
are not production recovery rates. Razorpay Test Mode proves integration behaviour — Payment
Link creation, payment confirmation, webhook verification, subscription-state observation —
and nothing about effectiveness. The report and the video keep these two claims separate.

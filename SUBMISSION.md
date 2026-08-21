# Recoup — submission notes

Razorpay AI Buildathon, **AI Revenue Recovery** track.
Repository: `github.com/Shubhamsah27/Razorpay` · Architecture: [README.md](README.md)
**Live Recovery Desk:** [https://shubhamsah27.github.io/Razorpay/](https://shubhamsah27.github.io/Razorpay/)

---

## What this is

An agent that diagnoses failed payments, prices **one** bounded recovery action, and clears it
through a deterministic safety guard before anything reaches a customer. Every external effect
has a durable identity and a full audit trail.

Two claims it deliberately does not make: it never pretends to re-charge a failed card
(recovery is always a new customer-initiated Payment Link), and its evaluation arms never share
a random-number generator.

---

## Two different things, kept separate

| | What it is | Talks to Razorpay? |
|---|---|---|
| **Hosted Recovery Desk** (GitHub Pages) | Static build over the recorded audit trail | **No.** No webhooks, no API calls. |
| **Test Mode E2E run** (local + `zrok`) | The real integration proof below | **Yes.** Real Payment Link, real signed webhook. |

The hosted demo exists so a reviewer can see the decisions without cloning. It is not, and does
not claim to be, a live integration.

---

## Razorpay Test Mode — end-to-end proof

Verified **2026-08-21** against the real Razorpay API in Test Mode.

```bash
bun run razorpay:webhook                      # terminal 1 — signed webhook listener
zrok2 share public http://127.0.0.1:8787      # terminal 2 — public tunnel
bun run razorpay:link case_demo_02 14900      # terminal 3 — create the real link
bun run razorpay:status                       # read back what happened
```

**Verified flow**

```
Payment Link creation
  → Test Mode browser payment
    → payment_link.paid webhook
      → HMAC-SHA256 signature verification over the raw body
        → idempotent receipt
          → recovered outcome
```

**Evidence**

| Item | Value |
|---|---|
| Case | `case_demo_02` |
| Payment Link id | `plink_TSMm1r1VCQdFhy` |
| Reference id (derived from the action key) | `rcp_fdeaab97b1f53b2ad0fc69ea245342d1b1d8` |
| Webhook receipt id | `TSMmtoQ2mnNXVO` |
| Outcome | recovered **₹149.00** |
| Open exceptions | none |

All stages succeeded. These are Test Mode identifiers and carry no credential material. No API
key, webhook secret, tunnel token or personal data appears in this repository — `.env` and the
SQLite runtime files are gitignored, and the tooling never logs credential values.

> Razorpay blacklists several tunnels, **`ngrok.io` among them**, along with `loca.lt`,
> `webhook.site`, `requestbin.com` and `hookbin.com`. `zrok` is the documented option.
> Test mode prompts for OTP `754081` when registering the endpoint.

---

## Evaluation result

2,000 cases, committed seed `recoup-buildathon-2026-v1`, reproducible with `bun run eval`:

| Metric | no_action | fixed_retry_3x24h | **recoup** |
|---|---:|---:|---:|
| recovery rate | 22.3% | 31.8% | **54.9%** |
| net value | ₹29.31L | ₹42.79L | **₹75.23L** |
| actions executed | 0 | 5,108 | **1,771** |
| fraud cases untouched | 69 | 1 | **65** |

**+₹32.43L incremental net value (+75.8%) over the fixed-retry baseline, using 65% fewer
actions.** Diagnosis accuracy 97.1% overall; 74.2% on the ambiguous-evidence path that reaches
the LLM.

### These numbers are simulated

The effectiveness figures are **simulated causal results from a known synthetic world**. They
show that the policy makes better decisions than the baselines *given that world*; they are
**not** production recovery rates.

Razorpay Test Mode proves **integration behaviour** — Payment Link creation, payment
confirmation, webhook verification, subscription-state observation — and **nothing** about
effectiveness. The two claims are kept separate everywhere.

---

## Engineering highlights

- **Exactly-once external execution** — SHA-256 action keys, an atomic database claim committed
  *before* the provider call, and reconciliation by `reference_id` so an ambiguous timeout never
  creates a duplicate Payment Link. Razorpay documents API-level idempotency for payouts, not
  Payment Links, so this does not rely on an idempotency header.
- **Counterfactually-valid evaluation** — every arm reads one immutable keyed outcome table, so
  no policy can perturb another's results.
- **Deterministic safety guard** — fraud freeze, opt-out, contact caps and spacing, quiet hours,
  expected-value floor, kill switch. It runs *after* all AI involvement, and the LLM is confined
  to interpreting ambiguous evidence into a known failure class.
- **Fatigue-priced expected value** — charging expected relationship damage against repeat
  contact cut churn cost from ₹27.7L to ₹8.1k while *raising* net recovery with fewer touches.
- **98 tests** — 79 backend, 19 frontend.

---

## Honest limitations

1. **The five-minute video is not yet recorded.**
2. **The hosted Desk is static.** It renders recorded audit records and receives no webhooks;
   the live path requires the local runbook.
3. **3D tile-click interaction** is unit-tested for case mapping but not human-verified.
4. **Webhook secret rotation** is unsupported: verification uses a single secret, and Razorpay
   requires the *old* secret for retries of deliveries created before a rotation.
5. **Results below the headline are unflattering and shown anyway** — the naive retry baseline
   still beats Recoup on `issuer_down`, and the fraud freeze forgoes real recovery on the ~18%
   of the `suspected_fraud` class that is not actually fraud.

---

## Reproducing

```bash
bun install
bun test           # 79 backend tests
bun run test:web   # 19 frontend tests
bun run eval       # byte-identical for the committed seed
bun run demo       # Recovery Desk over the real audit trail
```

No AI key and no external infrastructure are needed for the evaluation or the demo.

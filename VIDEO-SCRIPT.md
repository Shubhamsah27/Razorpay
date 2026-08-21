# Recoup — 5-minute pitch video script

Target **4:50–5:00**. Spoken text is ~700 words at a natural 140 wpm. Say the words in
**Say**; have **Show** already on screen before you start each line.

**Before recording**

- `bun run demo` running, Recovery Desk open, `Card Expired #00001` already selected.
- A second tab with the `bun run razorpay:status` output from the real Test Mode run.
- Terminal ready with `bun run eval` already executed, output scrolled to the arm table.
- Close Slack/notifications. Record at 1920×1080. Do not zoom during the runtime-path shot —
  the whole row must stay readable.

---

## 0:00 – 0:30 · The problem

**Show** — Recovery Desk hero, then scroll slowly to the 3D case field.

**Say**

> Every failed payment is revenue a merchant has already earned and is about to lose. The
> standard fix is to retry the card three times over three days and hope. That policy is
> indiscriminate — it retries expired cards that will never succeed, it contacts people who were
> going to pay anyway, and it retries fraud.
>
> Recoup is a recovery agent that decides, per payment, whether an action is worth taking at
> all. This is a real dashboard over real audit records — every tile is one case.

---

## 0:30 – 1:15 · The two things it refuses to do

**Show** — README section "The two claims this project refuses to make", then the action-kind
table.

**Say**

> Two things make this different, and both are refusals.
>
> First: a merchant cannot silently re-charge a card that just failed. Most recovery demos
> quietly pretend otherwise. Recoup never does. Every recovery is a new customer-initiated
> Payment Link. Recurring subscription retries belong to Razorpay — Recoup observes them and
> decides whether a separate intervention is even warranted. Every action is labelled with its
> execution domain, so a simulated action can never be mistaken for something Razorpay did.
>
> Second: the evaluation arms never share a random number generator. If they did, an arm that
> takes more actions would shift every later draw, and the comparison would be meaningless.

---

## 1:15 – 2:15 · The decision, on one real case

**Show** — Recovery Desk, `Card Expired #00001`, runtime path row. Click **Attempt 1**, pause,
then click **Attempt 2**.

**Say**

> Here is one case end to end. A card expired. Diagnosis is a deterministic rule table —
> ninety-seven percent accurate — and only genuinely ambiguous evidence goes to a language
> model, which is allowed to name a failure class and nothing else. It cannot authorise a
> payment or decide that something succeeded.
>
> Attempt one: expected value two thousand and fifty-four rupees. The guard clears it, a
> Payment Link goes out, the customer pays.
>
> Now attempt two. Same case, same customer. Expected value is **minus** one thousand two
> hundred and eighty-eight rupees, and the guard blocks it. Nothing leaves the system.
>
> That negative number is the second contact's cost to the relationship. Pricing customer
> fatigue cut modelled churn from twenty-seven lakh to eight thousand rupees — and net recovery
> went *up*, using fewer actions.

**Show** — click the **Fraud block** scene chip.

**Say**

> And here is a fraud case. The path visibly stops at the guard. No action, no contact, never
> reached the provider.

---

## 2:15 – 3:15 · Real Razorpay Test Mode

**Show** — terminal with `bun run razorpay:status` output; highlight the Payment Link id,
receipt id and the recovered outcome.

**Say**

> Everything so far is a decision. This is a real external effect.
>
> Against Razorpay Test Mode: Recoup created Payment Link `plink_TSMm1r1VCQdFhy`, I paid it in
> the browser, Razorpay sent a `payment_link.paid` webhook, the signature verified as
> HMAC-SHA256 over the untouched raw body, and the case was marked recovered. One hundred and
> forty-nine rupees. No open exceptions.
>
> The part I care about most is what happens when a provider call times out. You don't know
> whether the link was created. Recoup never guesses and never re-sends. Every action has a
> durable key, the database claim is committed *before* the call, and an ambiguous result goes
> to reconciliation, which asks Razorpay what exists under that unique reference. Found,
> attach it. Not found, safe to retry. Neither, raise an exception for a human.
>
> That's exactly-once external execution without an idempotency header — Razorpay documents
> those for payouts, not Payment Links.

---

## 3:15 – 4:15 · Does it actually work

**Show** — terminal `bun run eval` arm table, then the Desk's diverging per-class chart.

**Say**

> Two thousand cases, one fixed seed, fully reproducible.
>
> Doing nothing recovers twenty-two percent. The industry-standard retry policy recovers
> thirty-two. Recoup recovers fifty-five — thirty-two lakh rupees more net value than the retry
> baseline, a seventy-six percent improvement, using sixty-five percent *fewer* actions.
>
> The reason that comparison is trustworthy is the design underneath. Before any policy runs,
> the outcome of every possible action is already fixed in a keyed table. Taking an action
> reveals a cell. It never changes one. So no policy can perturb another's results, and a
> customer who would have paid anyway is never counted as a recovery.

---

## 4:15 – 4:45 · What I'm not claiming

**Show** — README "Honesty boundary", then the per-class chart with the red bars visible.

**Say**

> I want to be precise about what those numbers are. They're simulated causal results from a
> synthetic world. They show the policy makes better decisions than the baselines given that
> world. They are not production recovery rates. Razorpay Test Mode proves the integration
> works — it proves nothing about effectiveness.
>
> And these red bars are classes where the naive baseline still beats me. On issuer outages, a
> silent retry genuinely is better than asking a customer to pay again — Recoup loses there
> because it won't fake a capability it doesn't have. The fraud freeze costs real money too:
> about eighteen percent of that class isn't actually fraud. I'd rather show that than hide it.

---

## 4:45 – 5:00 · Close

**Show** — Desk wide shot, then README top with the repo URL on screen.

**Say**

> Recoup: nine thousand lines, ninety-eight tests, a deterministic safety guard, exactly-once
> execution against a real payment provider, and an evaluation designed so the result means
> something. Repo and architecture docs are linked below. Thank you.

---

## Delivery notes

- **Slowest line in the video** should be "expected value is *minus* one thousand two hundred
  and eighty-eight rupees." That contrast is the whole pitch — let it land.
- Say **"lakh"** and **"rupees"** aloud; don't read "₹32.43L" as symbols.
- Never say "recovered ₹32 lakh" without "in simulation" in the same breath.
- If you overrun, cut the second half of 0:30–1:15 (the RNG point) — it's in the README.
- Do **not** cut the honesty section. It's the most differentiating thirty seconds you have.

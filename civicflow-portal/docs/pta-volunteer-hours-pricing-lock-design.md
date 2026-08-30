# Volunteer buyout pricing-lock design note

`fix/pta-volunteer-financial-controls`, FC-4. Written before any schema or
runtime change, per the correction program's mandatory checkpoint: *"do NOT
implement the current `lockTiming="PAYMENT_SUCCESS"` label literally until
semantics are corrected; a provider cannot safely change amount after
payment succeeds."*

## 1. Existing behavior (as found)

`PtaVolunteerPricingWindow.lockTiming` is a stored, admin-configurable enum
(`CHECKOUT_START | PAYMENT_SUCCESS`, default `PAYMENT_SUCCESS`) surfaced in
the settings UI (`PtaVolunteerPricingWindowsManager.tsx`) and accepted by
both the create and update API routes. **It is never read by any pricing,
checkout, or webhook code.** Grep of the whole `src/` tree confirms the only
two references outside the UI/API/schema layers are the two
`lockTiming: input.lockTiming ?? "PAYMENT_SUCCESS"` default assignments in
`pricing.ts` — nothing branches on the field's value at runtime.

Actual runtime behavior, regardless of what an admin selects:

- **Election time** (`elections.ts: recordElection`) computes a fresh quote
  via `buildBuyoutQuote` and snapshots it onto the election
  (`quotedRateCents`/`quotedTotalCents`/`pricingWindowId`). This snapshot is
  written but **never read again** by any later code path.
- **Checkout time** (`purchases.ts: createVolunteerBuyoutCheckout`) *always*
  calls `buildBuyoutQuote` fresh, ignoring the linked election's snapshot
  entirely, and freezes that result onto the new
  `PtaVolunteerBuyoutPurchase` row before creating the Stripe Checkout
  Session.
- **Payment-success time** (`purchases.ts: recordVolunteerBuyoutPurchase`,
  called from the Stripe webhook) never re-quotes at all — it only compares
  the amount Stripe actually collected against the already-frozen
  `purchase.totalCents` and rejects on mismatch.

So today's real behavior is unconditionally **checkout-time lock**, for
every window, no matter what `lockTiming` says. An admin who selects
"payment success" — the current default — is being told the price will be
re-resolved at payment confirmation, which never happens. That is the
literal defect this checkpoint exists to catch: nothing currently *reprices
after payment*, but the UI and stored config actively claim a rate-lock
policy the server does not implement, and if this label were ever wired up
literally it would be unsafe (a provider cannot retroactively change an
already-collected amount).

## 2. Corrected design

Replace the two-value enum's semantics with the two moments the
authorization specifies, and make the choice actually govern behavior:

| Value | Frozen at | Behavior |
|---|---|---|
| `ELECTION` | The household's acknowledged election (`recordElection`) | Checkout must reuse that election's snapshotted rate/total, not re-quote. |
| `CHECKOUT` | The moment the server creates the Stripe Checkout Session | Re-resolve fresh against the currently active window (today's actual behavior, now honored intentionally instead of by omission). |

`PAYMENT_SUCCESS` is removed as a value. Payment-success processing keeps
doing exactly what it does today — verify the provider-collected amount and
currency against the already-frozen purchase amount, never reprice, never
re-validate window-open state at fulfillment time (see §6).

### Checkout-time dispatch

`createVolunteerBuyoutCheckout` gains a branch: if an `electionId` is
provided, load that election and the pricing window it was quoted against
(`election.pricingWindowId`). If that window's `lockTiming === "ELECTION"`
and the election is still the household's *latest* election for this period
(`getLatestElection` semantics — a later re-election always supersedes an
earlier one) and still within the buyout window's close time, use the
election's `quotedRateCents`/`quotedTotalCents` verbatim instead of calling
`buildBuyoutQuote`. In every other case (no election, window not found,
`lockTiming === "CHECKOUT"`, election superseded, or window closed) fall
back to today's fresh re-quote. No new schema field is needed for this
dispatch — it reads the existing `pricingWindowId` already stored on the
election.

### Why bound `ELECTION` to the window's own close time, not a separate TTL

The authorization's §5 boundary semantics already say a previously created
quote must not override a closed window *"unless an explicitly documented
election-lock policy already froze the family's right/price."* `ELECTION`
lock timing **is** that documented policy — but only up to the buyout
window's own close instant. Once the window (and by extension the period's
buyout availability) closes, no lock — election or checkout — can be used to
start a *new* checkout. This reuses the boundary FC-5 is already adding
rather than inventing a second, independent expiration clock. An
already-in-flight checkout session (Stripe session created before close) is
unaffected by a later close — see §6.

## 3. Data-migration implications

Verified row counts, both empty:

```
production (2026-08-25 baseline, Stage C):  PtaVolunteerPricingWindow=0, PtaVolunteerBuyoutElection=0,
                                              PtaVolunteerBuyoutPurchase=0, PtaVolunteerAssessmentBatch=0
local dev (civicflow_dev, checked this phase): same four tables, all 0
```

The feature has never been used in any environment. There is no populated
`lockTiming` value anywhere to reinterpret, and no existing election or
purchase row whose historical snapshot could be affected by a semantics
change. This removes the hardest part of an enum-value change (safe
reinterpretation of live data) — the migration is a plain additive/rename
schema change with nothing to backfill. It will still be written and tested
as a real Prisma migration against the local dev DB (never applied to
production under this authorization, per §12).

## 4. Quote-expiration behavior

No expiration concept exists today for either an election's snapshot or a
checkout session's frozen price — because until now nothing ever *reused* an
election's snapshot, there was nothing to expire.

- **`CHECKOUT` lock**: no separate expiration concept needed. The price is
  resolved at the instant of Stripe Checkout Session creation; Stripe's own
  session expiration (24h default) governs how long the family has to pay.
  A new checkout attempt after expiry always re-quotes fresh (§5, retried
  checkout), so a stale price can never be silently honored.
- **`ELECTION` lock**: the election's frozen price remains valid for
  checkout for as long as (a) it is still the household's latest election
  for the period, and (b) the buyout window it was quoted against has not
  closed. Both are existing/soon-to-exist fields (`getLatestElection`,
  FC-5's window-close check) — no new "quote expires at" column is added.

## 5. Rate-change behavior between election and checkout

- **`ELECTION` lock**: the rate cannot change between election and
  checkout by design — that is the entire purpose of the setting. If the
  admin edits or closes the pricing window after the election, the
  election's snapshot is unaffected (snapshot-on-transaction, same as every
  other record in this program); checkout still honors it until the window
  closes.
- **`CHECKOUT` lock**: the rate can legitimately differ from what the family
  saw at election time — election is disclosure/intent only. If the window
  changed between election and checkout, the family is charged the
  currently active rate. The checkout route does not currently show the
  family a fresh confirmation of the resolved amount before redirecting to
  Stripe; that is a UI-truthfulness gap, not a server-correctness one, and
  is flagged for FC-10 (helper text distinguishing election-locked vs
  checkout-locked pricing) rather than fixed under this narrower FC-4 scope.

## 6. Abandoned/retried-checkout behavior

Current behavior: retrying checkout after abandoning a session creates a
**second independent** `PtaVolunteerBuyoutPurchase` PENDING row and a second
Stripe session — there is no reuse or supersession of the first. If a family
somehow completed both (e.g., two open tabs), both could independently pass
the webhook's `updateMany({ where: { status: "PENDING" } })` compare-and-set
and both would post ledger credits, since ledger totals used by
`buildBuyoutQuote`'s remaining-hours check only reflect *completed*
purchases, not other pending ones. This is a genuine double-purchase gap,
but it is a **buyout-side idempotency problem** (parallel to the
duplicate-assessment problem FC-8 closes on the assessment side), not a
lock-timing problem — introducing `ELECTION`/`CHECKOUT` does not create or
worsen it. It is logged here as an identified risk for FC-5 to close
(bounding total outstanding-PENDING-plus-COMPLETED purchased minutes against
the requirement, the same way FC-5 already has to bound purchases against
previously-purchased minutes) rather than folded into this design note's
scope.

## 7. Webhook-arrives-after-window-closes behavior

Corrected behavior, stated explicitly because it is easy to get backwards:
**payment-success processing must not re-check whether the buyout window is
still open.** A checkout session created while the window (and, for
`ELECTION` lock, the election) was valid represents a right to pay that was
already granted at checkout-creation time; canceling fulfillment because the
window closed while Stripe was processing would leave a family who paid
real money with no hours credited and no refund — a strictly worse outcome
than honoring a late-arriving webhook. `recordVolunteerBuyoutPurchase`
therefore keeps doing exactly what it does today: validate amount + currency
+ connected-account match against the frozen purchase row, and nothing else.
Window/election validity is enforced only at the two *creation* points
(election, checkout-session-creation) — never at fulfillment.

## 8. Determination

Repository data (zero rows in every relevant table, in both production and
local dev) and architecture (the election snapshot already exists and is
simply unused; the checkout path already does exactly what `CHECKOUT`
requires) support this design safely. **Proceeding with implementation**:
rename the enum to `ELECTION | CHECKOUT` (dropping `PAYMENT_SUCCESS`),
default new windows to `CHECKOUT` (preserves today's actual behavior for any
admin who doesn't explicitly choose), wire the checkout-time dispatch
described in §2, update the settings UI label/copy, and add tests for both
lock modes plus the boundary cases in §4-§7.

## 9. RV-7 addendum: resolving "its own close" precisely

`fix/pta-volunteer-financial-controls`, RV-7. §4 above says an `ELECTION`
lock survives "for as long as ... the buyout window it was quoted against
has not closed" — the deployment review flagged this exact phrase as
ambiguous, since "buyout window" could mean either the PRICING window
(`PtaVolunteerPricingWindow.endAt`, the specific window
`election.pricingWindowId` points at) or the PERIOD's own overall buyout
window (`PtaVolunteerRequirementPeriod.buyoutWindowStart`/`buyoutWindowEnd`).
Read literally, one prior status report said an ELECTION lock is honored
"while not past its own close," which by itself doesn't say which of the
two this refers to. Both terms exist and both matter — here they are named
distinctly and their actual, code-verified interaction is stated in full
(`elections.ts: resolveLockedOrFreshQuote` → `assertBuyoutEligible` →
`periods.ts: assertBuyoutWindowOpen`; verified by the tests named below):

- **The election's own pricing window's close** (`window.endAt`, plus
  `window.active`) — checked directly in `resolveLockedOrFreshQuote`. If
  either has flipped since the election was made, the lock is not honored
  and the call falls through to a fresh `buildBuyoutQuote`.
- **The period's overall buyout window's close**
  (`buyoutWindowStart`/`buyoutWindowEnd`) — checked via the SAME
  `assertBuyoutEligible` call the locked branch already makes
  unconditionally (it is not skipped for a locked quote). If the period's
  own window has closed, the lock is rejected outright (throws
  `PTA_VOLUNTEER_BUYOUT_CLOSED`) — it is not silently downgraded to a fresh
  quote, because a fresh quote would ALSO be rejected by the same period-level
  gate; there is nothing to fall back to.

**Both must hold simultaneously.** Either one closing ends the lock's
validity — there is no scenario where a closed pricing window is excused
because the period window is still open, or vice versa.
`__tests__/elections.test.ts`'s "RV-7" tests assert this directly: one
proves the period-level gate independently rejects an otherwise-still-open
pricing-window lock, the other proves an unrelated LATER pricing window
opening has zero effect on an existing lock (the lookup is always by the
election's own `pricingWindowId`, never "is there something newer now").

**Election validity duration**: there is no independent, election-specific
TTL (e.g. "elections expire N hours after being made") — validity is
entirely derived from the two gates above plus "is this still the
household's latest election" (`getLatestElection`; a re-election
immediately and permanently supersedes the old lock, regardless of either
window's state). This is a deliberate design choice, not an oversight: both
windows are themselves finite and admin-controlled, so they already bound
how long a lock can remain honorable — adding a second, independent clock
would only create a scenario where a still-open, still-correctly-priced
window's lock expires for no reason tied to any admin decision.

**Admin policy changes**: changing a pricing window's `amountCents` after a
family has already locked an election at the old rate does NOT retroactively
reprice that lock (§5 above) — the snapshot on the election row is what's
served, never the window's current value. Deactivating the window or
shortening its `endAt`, however, takes effect immediately for any household
that has NOT yet reached checkout (the lock stops being honorable at the
next call, per the two gates above) — but has zero effect on a
`PtaVolunteerBuyoutPurchase` row that already exists (its own
`baseAmountCents`/`totalCents` snapshot, taken at checkout-session-creation,
is what governs from that point forward — see §7's fulfillment-time
guarantee, unconditionally; RV-2's real-Postgres tests exercise this exact
scenario: `recordVolunteerBuyoutPurchase` never calls `resolveLockedOrFreshQuote`
or re-reads window/election state, so "the final charge always matches the
amount frozen before provider checkout" already held before RV-7 and is
directly asserted by `__tests__/purchases.test.ts`'s RV-7 test).

**§6's flagged double-purchase gap is now closed.** This design note
originally logged the abandoned/retried-checkout double-purchase risk as
"for FC-5 to close." It was not closed under FC-5; it is closed under RV-2
of this correction round (`PtaVolunteerBuyoutPurchase_org_period_household_pending`,
a real database-level partial unique index — see that model's schema-drift
warning and `buyout-purchase-dedupe-concurrency.integration.test.ts`), which
also directly answers this checklist's "whether an abandoned checkout can be
retried" (yes — a superseded PENDING row is marked FAILED, never deleted,
and a fresh attempt creates a new row) and "no possibility of two Stripe
checkout/payment-intent creations for the same intended purchase" (yes,
database-enforced, not just application-level).

# Assessment reversal remains a hard boundary — RV-11

`fix/pta-volunteer-financial-controls`, RV-11. This correction round does
**not** build refund/reversal/adjustment capability for a posted
remaining-hours assessment charge — that stays explicitly out of scope,
unauthorized, and undesigned. What this document records is the containment
put in place instead: a real, code-enforced kill-switch, not just a policy
statement.

## Stage D1 / Stage D2

`docs/pta-volunteer-hours-pilot-plan.md` already called the whole assessment
feature "Stage D" and restricted the pilot to preview only. RV-11 makes that
split explicit and permanent in the code, not just in a pilot runbook:

- **Stage D1 — preview** (`previewAssessmentBatch`, `excludeAssessmentLine`,
  `includeAssessmentLine`, `cancelAssessmentBatch`): a pure computation with
  no side effects on real obligations. **Not blocked.** May proceed
  independently of Stage D2's authorization — an admin can preview, review,
  exclude/include families, and cancel a draft batch at any time.
- **Stage D2 — posting** (`postAssessmentBatch`, the only function that
  creates a real `PtaVolunteerAssessmentCharge`): **BLOCKED** — hard-gated
  behind a dedicated kill-switch, `PTA_VOLUNTEER_ASSESSMENT_POSTING_ENABLED`
  (`src/lib/env.ts: isPtaVolunteerAssessmentPostingEnabled`). Unset/off by
  default. Checked as the FIRST thing `postAssessmentBatch` does — before
  looking up the batch, before checking DRAFT/POSTED/CANCELLED status,
  before anything else — so there is no code path from any caller (the API
  route, a resume call, a concurrent retry) that reaches charge creation
  while this is off. This is a genuinely separate switch from the org-level
  `ptaVolunteerAssessmentsEnabled` flag (which still gates preview+post
  together as a capability) — an org can have assessments fully enabled and
  Stage D2 will still refuse to post until this second switch is also on.

This is not equivalent to (and does not weaken) FC-8/RV-10's
duplicate-charge prevention — those exist independently and stay fully
active. **This correction does not authorize live assessment posting
merely because duplicate-charging has been prevented** — the review was
explicit that database-backed duplicate prevention answers a different
question ("can the same obligation be charged twice") than reversal
capability answers ("can a mistaken charge be undone"), and only the first
one is solved.

## Investigation: does ANY existing reversal/correction machinery touch an assessment charge?

Yes and no — this needed checking carefully rather than assumed, since a
whole "Corrections, reversals & refunds" module already exists
(`src/lib/labs/pta/volunteer-hours/corrections.ts`, VH-H) with real,
working, previously-shipped functions. Read in full for this review:

- **`refundPurchasedHours`** — refunds a `PtaVolunteerBuyoutPurchase` (a
  family's voluntary buyout), including a real Stripe refund call when
  paid by card. This is a DIFFERENT financial object from an assessment
  charge and this function never touches `PtaVolunteerAssessmentCharge` at
  all. Not affected by, and not a substitute for, RV-11's kill-switch.
- **`reverseHourEntry`** — corrects an already-approved volunteer-hour
  entry via the existing append-only adjustment path. If the household
  already has a POSTED assessment charge, the correction still recalculates
  the household's totals but does **not** touch the charge itself — it only
  creates a `PtaVolunteerReviewFlag` (`CORRECTION_AFTER_ASSESSMENT_POSTED`)
  for a human to look at. The function's own doc comment already says this
  explicitly: *"nothing was charged or refunded automatically."*
- **`checkForOverpaymentAfterRequirementChange`** — same pattern: flags
  `POTENTIAL_OVERPAYMENT_AFTER_REQUIREMENT_REDUCED` for human review, issues
  nothing automatically.

**Conclusion: no code path anywhere in the codebase — VH-H included — ever
adjusts, voids, mutates, or deletes a `PtaVolunteerAssessmentCharge` row.**
VH-H's own design already treats a posted assessment as something a human,
not the system, must resolve — RV-11's kill-switch extends that same
posture one step earlier, to prevent the charge from being posted
incorrectly in the first place, since prevention is better than a
review-flag queue when the charge itself still can't be undone. Also
verified: no admin-facing UI component currently calls the
`reverseHourEntry` or `refundPurchasedHours` API routes at all (both exist
only as backend routes, `.../hour-entries/[entryId]/reverse` and
`.../purchases/[purchaseId]/refund`) — an unrelated observation, not part
of RV-11's fix, but relevant context for anyone reading this doc looking
for where those capabilities are actually exposed.

## The UI does not imply a posted assessment can be safely corrected

`PtaVolunteerAssessmentManager.tsx`'s post-confirmation copy now states
plainly: *"There is currently no way to adjust or reverse a posted charge
from within Unestra. If you post a mistake, contact support before taking
any other action — do not attempt to work around it by editing hours,
re-posting, or recording an offline refund."* This sits directly above the
"Confirm and post assessment" button, alongside the existing (unchanged)
explanation of what posting actually does.
`PtaVolunteerReviewFlagsManager.tsx` (VH-H's review-flag UI, unchanged by
RV-11) already carries its own accurate disclosure — *"Nothing here charges
or refunds anything — resolving just acknowledges review"* — so an admin
resolving a `CORRECTION_AFTER_ASSESSMENT_POSTED` flag was already never
told the underlying charge got fixed. Grepped the whole `volunteer-hours`
component tree for "revers/adjust/correct/void/refund" language to confirm
no OTHER surface implies otherwise.

## Operational recovery for a mistakenly posted assessment

Until an authorized assessment-charge reversal design exists, recovery for
a real mistaken post is manual and outside the application for the CHARGE
itself, though the review-flag queue is the right place to track it:

1. **Do not attempt any in-app workaround.** Editing the household's hours
   (which will correctly raise a `CORRECTION_AFTER_ASSESSMENT_POSTED` flag
   via `reverseHourEntry` — useful for tracking, but does not touch the
   charge), posting a second "correcting" batch, or recording an offline
   payment against the mistaken charge would not reverse it —
   `PtaVolunteerAssessmentCharge` rows are never deleted or mutated by any
   code path in this feature, and FC-8/RV-10's partial unique index would
   in most cases outright PREVENT a second batch from creating any
   replacement charge for the same household+period regardless of intent.
2. **Identify the exact charge(s)** via `PtaVolunteerAssessmentCharge`
   (`organizationId`, `requirementPeriodId`, `householdId`, `batchId`,
   `amountCents`, `createdAt`) and the originating
   `PtaVolunteerAssessmentBatch`/`PtaVolunteerAssessmentLine` rows for full
   context (who posted it, when, at what rate).
3. **Correct the family's financial position outside the charge record
   itself** — e.g., an admin-recorded offline "payment" for $0 with notes
   explaining the waiver, or a manual credit through whatever
   general-ledger/waiver mechanism the organization already uses outside
   this feature — while leaving the original charge row exactly as posted,
   since it is the accurate historical record of what actually happened
   (a mistake, and how it was resolved), not something to erase.
4. **This procedure is a stopgap, not a design.** It exists because
   `postAssessmentBatch` is blocked by default and this document must be
   honest about what happens if an organization is deliberately granted the
   Stage D2 switch before a real reversal design is built. The correct fix
   is the bounded design a future, separately authorized program should
   build (mirroring RV-5's contract-signing investigation's own "bounded
   design, not implementation" discipline): an explicit
   `PtaVolunteerAssessmentReversal`/adjustment record type, linked to the
   original charge, with its own audit trail, that a real reversal
   operation can create — never a mutation or deletion of the original
   charge. VH-H's existing `PtaVolunteerReviewFlag` model is a reasonable
   place for such a design to hook into (it already tracks exactly this
   scenario), not something that needs to be built from scratch.

## What is NOT part of this correction

No `PtaVolunteerAssessmentReversal` model, no adjustment/void status added
to `PtaVolunteerAssessmentChargeStatus` beyond what already exists (`PENDING
| PARTIAL | PAID | VOID` — `VOID` itself still has no producer anywhere in
the codebase, unchanged from FC-8/RV-10's own finding), no
assessment-charge refund/void mechanism, no partial-charge-correction UI,
no change to VH-H's existing (separate, already-shipped) purchase-refund or
hour-entry-correction capability. Building any of that requires its own
separately authorized program.

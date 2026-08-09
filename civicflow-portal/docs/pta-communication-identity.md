# PTA Communication Identity Model

Why a household's billing/communication identity can drift from its real contact info, why it did in production, and the explicit synchronization rules that fix it going forward.

## The authoritative model, in one sentence

**`OrgMember` is what every communication system actually reads. It is never the source of truth about a household's real-world contact info — `PtaHouseholdAdult` is.** `OrgMember` is a projection, kept in agreement with the household's designated primary contact by explicit sync rules, not by being edited directly as day-to-day practice.

## The four models involved

| Model | What it represents | Is it read by communication/billing code? |
|---|---|---|
| `PtaHousehold` | One family's PTA membership for a school year | Only its `status` (see the membership-status rule below) |
| `PtaHouseholdAdult` | A real parent/guardian, with their own name/email/phone | No — communication code never queries this model directly |
| `OrgMember` (via `PtaHousehold.orgMemberId`) | The household's single billing/communication identity — a normal `OrgMember` row with no login of its own | **Yes — this is the only record `resolveCommunicationRecipients()`, dues billing, and every campaign selector actually read** |
| `PtaStudent` | A student linked to the household | Never — deliberately excluded from every communication/identity path; students have no contact info fields at all by design (see the model's own schema doc comment) |

`Organization` and `User` don't carry per-household contact info themselves; they're the tenant boundary and (optionally) an adult's own login, respectively — neither is part of this sync.

## Why `OrgMember` has to be the read side

Dues billing, campaign recipient resolution, and every existing communication selector (`active_with_email`, `delinquent`, `outstanding_dues`, `category`, and all five PTA-specific selectors) are built entirely on top of `OrgMember` — a platform-wide model shared by every vertical (Community, Union, HOA, PTA). Reading `PtaHouseholdAdult` directly from those systems would mean either duplicating every one of them for PTA specifically, or making the whole platform's communication layer PTA-aware. Both are exactly the kind of redesign this fix avoids. `PtaHousehold.orgMemberId` exists specifically so a household can plug into that shared machinery as an ordinary member — which means `OrgMember.email`/`.phone`/`.membershipStatus` are the fields that must stay correct, and everything else in this document is about how they get there.

## The identity lifecycle, stage by stage

**New household.** `createPtaHousehold()` creates the billing-identity `OrgMember` eagerly, in the same call, with no name/email/phone yet — just enough for dues wiring to work. No adults exist yet, so there's nothing to sync.

**Adding an adult.** `addPtaHouseholdAdult()` always creates a real `PtaHouseholdAdult` row with its own email/phone. Whether that flows to the `OrgMember` depends entirely on `makePrimaryContact`:
- The officer web UI's "Add adult" form now sends it (checked by default when the household has no primary contact yet) — this is the actual bug this PR fixes: the form never sent it before, so the sync path existed but was never reached from the UI.
- CSV import (`vertical-import.ts`, `imports/engine.ts`) already always sent it — this path was never broken.

**Designating or changing the primary contact later.** `setPtaHouseholdPrimaryContact()` — new in this PR. Before it existed, there was no way to assign a primary contact after household creation, or to hand the designation to a different adult later, despite the module's own doc comments implying one existed for years.

**Updating an adult's own email.** There is currently no "edit adult" capability anywhere in the product (web or mobile) — an adult's email/phone can only ever be set once, at creation. This is a real, pre-existing gap, out of scope for this PR (it's a missing UI feature, not an identity-sync defect), and is tracked separately. The practical consequence: once synced, an `OrgMember`'s email can only ever be corrected by editing the `OrgMember` directly (see "manual override," below).

**Importing members.** Always passes `makePrimaryContact: true` for the row's designated contact — confirmed by existing tests in `vertical-import.test.ts`, unaffected by this PR.

**Onboarding.** A new PTA organization's first households arrive either through CSV import (above) or through an officer using the same "Add adult" form as any other time — there's no separate onboarding-specific household-creation path.

**Billing.** `orgMemberId` is what dues charges/payments attach to. This PR does not touch dues logic at all — it only affects whether that same `OrgMember` row also has a usable email/phone.

**Campaign recipient resolution.** `resolveCommunicationRecipients()` (`communication-campaigns.ts`) filters strictly on `OrgMember.email`/`.phone` presence and `OrgMember.membershipStatus`. It has no knowledge of households, adults, or primary contacts at all — by the time it runs, the sync either already happened or it didn't.

**Email delivery.** Downstream of resolution entirely; out of scope here.

## Where identity could become stale (and what happens at each point)

| Trigger | Before this PR | After this PR |
|---|---|---|
| Adult added via officer UI, no primary contact chosen | `OrgMember.email` stays permanently `null` — the actual production bug | Officer can check "Set as primary contact" at add-time, or designate one later |
| Household already existed with no primary contact | No repair path existed | The "Make primary contact" action on the household page is a real, idempotent, audited repair path — see below |
| Primary contact reassigned to a different adult | N/A — no reassignment existed | Only fills currently-*empty* fields; never overwrites an existing email/phone (see the override rule) |
| Primary contact adult deleted | N/A | `primaryContactAdultId` is declared `onDelete: SetNull` — it cleanly reverts to unset, never a dangling reference. The `OrgMember`'s already-synced email is deliberately **not** cleared (see rationale below) |
| Household deactivated | `OrgMember.membershipStatus` was never touched — silently left `"active"` even though the household was inactive. Invisible to PTA-specific selectors (which correctly read `PtaHousehold.status` directly) but a real leak on the base platform selectors (`active_with_email`, `delinquent`, `category`), which read `OrgMember.membershipStatus` | `deactivatePtaHousehold()` and `updatePtaHousehold()` now sync `membershipStatus` unconditionally whenever `PtaHousehold.status` changes |
| Someone manually edits the `OrgMember`'s email via the general member-edit form | N/A (sync barely fired at all) | Preserved permanently — the fill-only-when-empty rule has no way to distinguish a manual edit from a prior sync, and deliberately doesn't need to |
| Multiple guardians in one household | Only ever one contact synced (whichever `addPtaHouseholdAdult` call happened to pass `makePrimaryContact`, by accident of ordering) | Still only one — see the explicit limitation below. Not something this PR changes. |
| CSV import of a household that already exists | Skips re-creating it, but has its own separate correctness story (`vertical-import.ts`'s own partial-failure handling) — unaffected by this PR | Unchanged |

## The two synchronization rules, stated explicitly

### Rule 1 — email/phone: fill once, never overwrite

`syncHouseholdBillingContact()` only ever sets `OrgMember.email`/`.phone` when the field is **currently empty**. It is never cleared and never overwritten once set, by any code path in this PR.

**Why this rule and not a "keep resyncing" one:** the alternative — always resyncing on every primary-contact change — needs a way to tell "this value came from a prior sync" apart from "someone deliberately typed a different address into the member-edit form." That distinction doesn't exist today without a new tracking column, which was a real design fork resolved with the user before implementation: adding one was explicitly rejected in favor of the schema-free rule, since emptiness alone is a sufficient and simpler signal, and the project's own standing instruction is to avoid schema churn unless genuinely necessary.

**What this means concretely:**
- The very first time a household gets a primary contact with a real email, that email lands on the `OrgMember`. Good — this is the fix.
- If staff later hand-corrects that email through the ordinary member-edit form (`updateMember()`), it is never touched again by anything in this module, under any circumstance — reassigning primary contact, an adult deletion, an import row, none of it can revert a manual correction.
- If a household's *only* known email is wrong and no one has manually fixed it, the fix is the same member-edit form, not a resync — there is no "force resync" action, deliberately, since one can't exist without either the tracking column above or accepting that it could silently clobber a real manual edit.

### Rule 2 — membership status: always kept in lockstep, unconditionally

`syncHouseholdMembershipStatus()` sets `OrgMember.membershipStatus` to match `PtaHousehold.status` (`ACTIVE`→`active`, `INACTIVE`→`inactive`, `PENDING`→`pending`) every single time the household's status actually changes — no emptiness check, no "don't overwrite" guard.

**Why this rule is different from Rule 1:** there is no competing manual edit to protect against. A household's billing `OrgMember` exists *only* to represent that household — its active/inactive state isn't an independent fact someone might have deliberately set differently; it's derived, full stop. Applying Rule 1's "preserve what's there" logic here would be wrong, not just unnecessary — it would mean a deactivated household kept silently appearing on every base communication selector forever.

## What's *not* synchronized, on purpose

- **`PtaHouseholdAdult.name`/relationship label** — never touch `OrgMember` at all; the billing identity's own `firstName`/`lastName` are set once at household creation (`"(PTA Household)"` as the last name, by design — see `createPtaHousehold()`) and aren't meant to track any individual adult's name.
- **`PtaHousehold.secondaryContactAdultId`** — this field exists in the schema but has zero application code anywhere that reads or writes it. It predates this PR and is not wired into sync, targeting, or any UI. Treated here as known, pre-existing, unused scaffolding — not a bug this PR introduces or is responsible for fixing.
- **Multiple guardians receiving communications independently** — `OrgMember` has exactly one `email` field. A household with two guardians who both want to receive PTA emails independently is a real, known limitation of the current single-identity-per-household architecture, not something this PR changes or could change without a genuinely bigger model (a household having *many* recipients, not one). Out of scope by the sprint's own "no redesigning the platform" rule.
- **Student contact info** — doesn't exist. `PtaStudent` deliberately carries no contact fields at all (see the model's own schema doc comment on data minimization).

## The repair path for already-broken production households

No bulk migration or one-off SQL script exists or is needed. Every household broken by the original bug shares one property: **it has no `primaryContactAdultId` at all**, because — before this PR — the only way to ever set that field also always ran the sync in the same call (CSV import). A household with `primaryContactAdultId` already set was therefore never actually broken; only households with it unset can be.

That means the ordinary "Make primary contact" action *is* the repair path, not a separate tool:
- **Idempotent** — designating the same adult again is a harmless no-op (Rule 1 only ever fills an empty field).
- **Permission-protected** — gated by `pta:households:manage`, the same permission that already guards every other household-write action.
- **Auditable** — writes `pta.household.primary_contact_set` via the existing `createAuditEvent()` path, same as every other mutation in this module.

Building a second, parallel bulk-repair mechanism here would duplicate the Launch Readiness Report's separate Data Health tool (`/admin/platform/data-health`, a different PR), which already surfaces every household still missing a primary contact, across every organization, for exactly this follow-up.

## Manual verification

See the PR's own description/final report for the exact live-verification steps performed against a real production PTA organization and their observed results.

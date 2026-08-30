# Contract-signing buyout gate — investigation findings + bounded design

`fix/pta-volunteer-financial-controls`, RV-5. Per the review's explicit
instruction, this is investigation and design **only** — no implementation.
`contractSigningOnly` stays exactly as FC-10 left it: stored, unenforced,
removed from the admin UI's window-creation choices. This document exists so
that state is never mistaken for "feature complete" — it's containment, and
this note says so explicitly (see "Determination" below).

## Investigation: does an authoritative household contract/signature record exist?

Searched the entire schema (`prisma/schema.prisma`, all ~370 models) for any
model or field matching signature/consent/agreement/contract semantics.
Result: **no such record exists anywhere in Unestra, in any vertical.**

What exists, and why none of it qualifies:

| Candidate | What it actually is | Why it isn't a contract signature |
|---|---|---|
| `PtaVolunteerBuyoutElection.acknowledgedAt` / `.ackVersion` (`VOLUNTEER_HOURS_ACK_VERSION`, `elections.ts`) | A timestamp + disclosure-version stamp recorded when a family elects VOLUNTEER / FULL_BUYOUT / PARTIAL_BUYOUT | This acknowledges the volunteer-hours disclosure text shown at election time — a UI consent-to-proceed, not a family membership contract. The review explicitly instructs not to treat an ordinary election as signing, and the code doesn't: nothing today reads `acknowledgedAt` as if it were contract evidence. |
| `PtaHouseholdAdultInvite.acceptedAt` | Timestamp an admin-sent login invite was accepted | Proves someone accepted an invite to get portal credentials — the review explicitly instructs not to infer signing from login/profile creation, and this is exactly that. |
| `PtaHousehold` itself | Admin-created record, not a family self-registration | Households are created BY administrators (see docs/pta-labs-mvp.md); there is no family-facing "join and agree to terms" flow to attach a signature to even if one were built. |
| `UnionCaseContractReference` (a different vertical) | A free-text citation of a CBA article number on a grievance case | Not household-linked, not signable, not PTA. Confirms the whole codebase has never built a signable-agreement pattern for any vertical, not just this one. |

**Determination: no reliable signed record exists to link a buyout offer
to.** Per the review's instruction, this correction does not fabricate one.
`contractSigningOnly` stays unavailable, and Stage C (the buyout/assessment
feature generally) is **not** being called fully requirement-complete on
account of this gap — a contract-linked buyout offer is a separately
authorized feature, not something this correction program delivers.

## The review's specific questions, answered against this determination

- **What would constitute contract signing?** Not defined today — see the
  bounded design's "Agreement template" and "Household acknowledgment"
  below for what it would need to be.
- **Is the signature household-specific?** N/A today. In the design below:
  yes — one signature record per household per agreement version, mirroring
  `PtaVolunteerBuyoutElection`'s existing household-scoped pattern.
- **Is there a trusted signed timestamp?** N/A today. In the design:
  server-generated at write time (never client-supplied), exactly like
  `acknowledgedAt` already is.
- **Can a new contract version require a new election?** N/A today
  (nothing to version). In the design: yes — this program already has a
  precedent for exactly this shape (`VOLUNTEER_HOURS_ACK_VERSION`, bumped
  whenever the disclosure text materially changes, with an
  already-made election keeping the version it was made under). A contract
  template would need the identical versioning discipline.
- **What happens if a contract is withdrawn or replaced?** N/A today. See
  "Amended-agreement handling" below.
- **Does a volunteer-only (VOLUNTEER) election count as signing?** No —
  confirmed above that today's `acknowledgedAt` is disclosure-acknowledgment,
  not contract-signing, and the bounded design keeps these as two
  independent records so they can never be conflated later either.
- **Can the signing window be configured independently of the school-year
  window?** N/A today. In the design: yes, required — see "Independent
  signing window" below; it must not be silently tied to
  `buyoutWindowStart`/`buyoutWindowEnd` or the period's own `startsOn`/`endsOn`.

## Bounded product design (not implementation)

If a future program authorizes this capability, it needs at minimum:

1. **Agreement template + version** — org-defined text (mirrors
   `PtaVolunteerRequirementPeriod.familyPolicyText`'s free-text pattern),
   with a monotonically-increasing version identifier. Only one version is
   "current" at a time per organization.
2. **Household acknowledgment/signature record** — one row per
   (organization, household, agreement version): who signed (which household
   adult / user), a server-generated `signedAt` instant, and the exact
   version text they saw (snapshotted, never re-derived from the
   possibly-since-edited template — same snapshot-on-transaction discipline
   this program already uses everywhere else).
3. **Independent signing window** — its own configurable open/close dates,
   deliberately NOT derived from `buyoutWindowStart`/`buyoutWindowEnd` or the
   period's `startsOn`/`endsOn`. A PTA may want signing to open weeks before
   the buyout window, or stay open after it closes for late-joining families.
4. **Amended-agreement handling** — publishing a new version does not
   retroactively invalidate an existing signature on the prior version; it
   only means a NEW buyout election now requires the new version's
   signature. Withdrawing an agreement entirely (no active version) means no
   contract-linked buyout window may be created or remain active — existing
   history is preserved, never deleted.
5. **Buyout offer tied to the signed agreement** — a pricing window marked
   `contractSigningOnly` would require, at quote/checkout time, a signature
   row for the household matching the window's associated agreement
   version, exactly analogous to how `assertBuyoutEligible` already gates on
   period/window state today.
6. **Configurable time-after-signing** — optionally, a contract-linked
   window's offer could remain valid for N days after a household's
   signature rather than only within the signing window itself; this needs
   its own explicit field, not reuse of `buyoutWindowEnd`.
7. **Audit trail** — every signature creation (and every agreement
   version publish/withdraw) is an audit event, matching this program's
   existing convention (`createAuditEvent`) everywhere else.
8. **Family-visible copy** — the household should be able to see the
   agreement text they signed and its version, on demand, not just at
   signing time.

None of this is implemented. `contractSigningOnly` remains stored-but-inert,
the admin UI continues to omit it as a choice, and any pricing window that
somehow already has `contractSigningOnly=true` behaves exactly like any
other active window of its rate type (confirmed zero such rows exist in
production or local dev, per FC-10's original finding — unchanged by this
investigation).

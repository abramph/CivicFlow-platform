# PTA Family Agreement & Contract-Linked Buyout

`feature/pta-family-agreement-buyout`, built on top of the deployed (but
dormant) volunteer financial-controls corrections. **Not merged, not
pushed, not deployed. No production flag is enabled.**

## This is acknowledgment, not a certified e-signature

Per explicit product decision, "contract signing" in this feature means:
*an authorized adult in a PTA household electronically acknowledges a
versioned PTA Volunteer Commitment Agreement on behalf of the household.*
It is never labeled or implemented as a legally certified electronic
signature — no identity verification and no e-signature compliance
framework (eIDAS/ESIGN-Act-grade audit trail, notarization, etc.) backs any
record this feature creates. UI and documentation copy consistently uses
"family agreement," "volunteer commitment agreement," "acknowledge and
accept," "accepted by," and "acceptance date" — never "e-signature,"
"certified," or "notarized."

## Administrator setup

From a requirement period's settings page (`.../periods/[periodId]`, new
"Volunteer commitment agreement" section):

1. **Create a draft** — title + plain-text content. Drafts are freely
   editable.
2. **Publish** — one-way transition. From this point the version's
   title/content/hash are immutable; a correction requires a new version.
3. **Assign to the period** — sets `agreementRequired` and
   `agreementVersionId` together (see "Agreement policy," below). Only a
   PUBLISHED version belonging to the SAME period may be assigned.
4. **Configure contract-linked buyout** (optional, independent of
   requiring acceptance at all): enable it, set how many days after
   acceptance the offer stays open, and whether the rate is frozen at the
   moment of acceptance or re-resolved at election time.
5. **Archive** a version once superseded — history and every existing
   acceptance of it remain intact; archiving never deletes anything.

Publishing/policy changes require `pta:volunteer-buyout-pricing:manage`
for the POLICY endpoint (the stricter, FINANCE-level permission — see
"Permission design" below) and `pta:volunteer-requirements:manage` for
version CRUD (the same permission STAFF already holds for period/
assignment configuration).

## Family acceptance

A dedicated page, `/labs/pta/my-pta/volunteer-agreement` (deliberately
**not** embedded into the existing, already-shipped `my-pta` dashboard —
this keeps that page completely untouched by this feature). Shows the full
agreement text, a required acknowledgment checkbox, an optional typed name,
and states plainly that acceptance alone never charges the household —
buying out hours, if the family chooses to, happens through the existing,
separately-confirmed checkout flow, unchanged by this feature.

After accepting, the family sees who accepted, when (in the organization's
own time zone), which version, the contract-linked offer window if
applicable, and can revisit the accepted text at any time via the same
page.

Only ONE authorized adult's acceptance is required per household in this
initial implementation — this is household acknowledgment, not individual
signatures from every guardian. "Authorized adult" here is structural, not
a new check this feature invented: `requireVolunteerHoursHouseholdAccess`
(the same guard every other family route in this program already uses)
resolves a `PtaHouseholdAdult` row by the AUTHENTICATED user's `userId`,
scoped to their own household. A student has no login path into this at
all — students are a wholly separate model (`PtaStudent`), never a
`PtaHouseholdAdult` — so "student/dependent blocked" and "cannot accept for
another household" both hold by construction, not by an extra runtime
check this feature had to add.

## Versioning

`PtaVolunteerAgreementVersion`: DRAFT → PUBLISHED → ARCHIVED, one-way.
`versionNumber` auto-increments per (org, period). `contentHash` (sha256)
is computed at publish time and re-snapshotted onto every acceptance
(`contentHashAtAcceptance`) as a defense-in-depth integrity check, even
though published content is already structurally immutable. Content is
stored and rendered as **plain text only** — React's default JSX escaping
(never `dangerouslySetInnerHTML`) is what actually prevents script/style
injection; the write-side validation only rejects empty/oversized/
control-character input, it does not attempt HTML sanitization because
there is no HTML to sanitize.

Publishing a new version does **not** retroactively affect anything: prior
acceptances remain tied to the exact version they accepted, and a period's
`agreementVersionId` pointer only moves if an admin explicitly reassigns
it. Deleting an agreement version is not offered anywhere in the UI/API;
the schema additionally makes it impossible at the database level once any
household has accepted it (`onDelete: Restrict` on
`PtaVolunteerAgreementAcceptance.agreementVersionId`).

## Contract-linked pricing

`PtaVolunteerPricingWindow.contractSigningOnly` — a field that already
existed, stored, but completely unenforced before this feature (see
`docs/pta-volunteer-hours-contract-signing-design.md`'s investigation) — is
now a real relational gate:

- `resolveVolunteerBuyoutRate` (pricing.ts) excludes
  `contractSigningOnly=true` windows entirely UNLESS the caller supplies
  `contractLinkedResolutionInstant` — and even then, only PREFERS a
  contract-linked window active at that instant, falling back to the
  regular (non-contract) window otherwise. A PTA never has to deactivate
  its regular rate during a contract-linked offer period.
- `buildBuyoutQuote` (elections.ts) is the only caller that ever supplies
  that instant, and only after verifying real eligibility via
  `resolveHouseholdAgreementStatus` (agreements.ts) — the SAME function the
  family UI and admin status counts read, so eligibility can never diverge
  across surfaces.
- The eligibility window is `[acceptedAt, acceptedAt + contractLinkedEligibilityDays]`,
  computed server-side; `acceptedAt` is always server-generated
  (`new Date()` at write time, in the service layer — never a client input,
  never a DB default that could be backdated).
- `contractLinkedUsesAcceptanceRate` (period-level, default true) decides
  WHICH instant is passed for the contract-linked lookup: the household's
  own `acceptedAt` (freezing the rate) if true, or "now" (still gated on
  eligibility, but not rate-frozen) if false.
- Once an election is created, its `contractAcceptanceId` is a permanent
  snapshot — `resolveLockedOrFreshQuote`'s existing ELECTION-lock branch
  (unchanged by this feature) reuses it unconditionally, exactly like it
  already reuses `quotedRateCents`/`quotedTotalCents`. A later agreement
  amendment or an expired offer window never retroactively reprices or
  invalidates an already-made, already-locked election.

**Acceptance alone creates zero financial side effects** — no purchase, no
provider checkout, no payment, no ledger credit, no assessment. A
volunteer-only household can accept the agreement and never touch buyout at
all.

## Amendment policy

Published text is immutable. A new version affects only newly configured
policy going forward — it does not silently cancel an existing acceptance,
election, checkout, or purchase. If a PTA wants current families to accept
an amended agreement, an administrator must explicitly publish the new
version and reassign it to the period (which does NOT retroactively
invalidate the old version's acceptances — a family who already accepted
v1 is not automatically required to re-accept v2 unless the period is
reassigned to v2, at which point only a NEW election needs the new
acceptance; an already-locked election from v1 keeps its own frozen
`contractAcceptanceId` regardless).

## Security / RBAC / privacy

- Every route funnels through the existing platform kill-switch → org
  allowlist → capability-flag chain (`requireVolunteerHoursFlag`) before
  anything else — no new bypass path.
- Admin routes: `pta:volunteer-requirements:manage` for version CRUD/
  assignment, `pta:volunteer-buyout-pricing:manage` (stricter) for the
  whole contract-linked POLICY endpoint (a deliberate design choice —
  contract-linked buyout is inescapably a pricing decision, so the whole
  policy write path inherits the more sensitive permission rather than
  splitting agreementRequired off onto a separate, laxer endpoint).
- Family routes: household self-access only, resolved server-side, never
  from client-supplied IDs. A guessed agreement-version or acceptance ID
  from another organization returns 404, never leaks existence.
- Every mutating route uses a strict Zod schema (`.strict()`) — an
  unrecognized extra field (e.g. an attempt to smuggle a `householdId` into
  the accept-agreement body) is rejected outright.
- No IP address or user-agent is stored on `PtaVolunteerAgreementAcceptance`
  — a deliberate omission (the spec explicitly asks to justify before
  collecting device metadata; no genuine need was found), unlike the
  pre-existing, unrelated `PtaVolunteerBuyoutElection.ipAddress` field this
  model does not attempt to match.
- Publishing, policy changes, and acceptances all create audit events;
  policy updates and acceptances commit their audit event in the SAME
  database transaction as the state change (`createAuditEvent({..., tx})`)
  — a failed audit insert rolls back the whole write, matching this
  program's established atomicity discipline.

## Reporting (descoped from a full 8th Excel report — see limitations)

Delivered: an admin status-counts endpoint/UI (not-yet-accepted, accepted,
offer-window open/expired, and election-type breakdown) directly on the
period settings page. **Not built**: full Report H with Excel-export
parity via the shared `ReportData`/xlsx-builder pipeline the other 7
reports use — this was a genuine scope reduction under this session's time
constraints, not a technical blocker. See "Known limitations."

## Notifications

Four templates (`AGREEMENT_AVAILABLE`, `AGREEMENT_REMINDER`,
`AGREEMENT_ACCEPTED_CONFIRMATION`, `CONTRACT_OFFER_EXPIRING`) exist only as
`previewAgreementNotification` — admin-triggered, test-recipient-only,
audited, mirroring `previewVolunteerHoursNotification`'s exact pattern.
**No automated sweep exists for this feature** — nothing schedules or
sends a real notification to a real family. This is intentionally the same
scope boundary the spec requested ("notifications remain disabled... do not
wire or run a production notification sweep").

## Known limitations / deferred

- **No full Excel Report H.** Admin status counts are visible in the admin
  UI but not exported as a formatted workbook with the same anti-divergence
  guarantee the other 7 reports have.
- **No automated notification sweep** — preview/test-send only, by design
  for this phase.
- **Mobile**: zero changes to `civicflow-mobile/`. This feature is
  web-only; a native flow (if ever built) is a separate, future program.
- **No amended-agreement bulk re-acceptance workflow** beyond "reassign the
  period's `agreementVersionId`" — there's no automated "notify everyone
  who accepted the old version" flow (would require the notification sweep
  above).
- **Household-level acceptance only** — one authorized adult's acceptance
  suffices; no per-guardian signature tracking.

## Migration

One additive migration,
`20260830190000_pta_family_agreement_contract_linked_buyout`: two new
tables (`PtaVolunteerAgreementVersion`, `PtaVolunteerAgreementAcceptance`),
one new enum (`PtaVolunteerAgreementStatus`), five new nullable/defaulted
columns on `PtaVolunteerRequirementPeriod`, one new nullable column
(`contractAcceptanceId`) on `PtaVolunteerBuyoutElection`. Nothing existing
is altered or removed — `contractSigningOnly` on `PtaVolunteerPricingWindow`
is reused, not replaced (confirmed zero true rows exist anywhere before
this change, per the prior round's RV-8 finding — this migration does not
need to reinterpret any live data). Validated by applying it to the local
`civicflow_dev` database (already at the prior round's 118-migration
baseline) — **no production migration was run or authorized under this
branch.**

## Rollback / dormant deployment behavior

Everything here is inert until an administrator explicitly: (1) publishes
an agreement version, (2) assigns it to a period with `agreementRequired`
and/or `contractLinkedBuyoutEnabled` turned on. Until then:
`agreementVersionId` is null on every period, `resolveHouseholdAgreementStatus`
returns `required: false` / `assignedVersion: null` for every household,
and `resolveVolunteerBuyoutRate` never even attempts a contract-linked
lookup (no `contractLinkedResolutionInstant` is ever computed without a
verified acceptance). Rolling back is additive-safe: unassigning a period's
agreement (setting `agreementVersionId` back to null) immediately stops
enforcement with zero data loss — no acceptance, version, or election
history is ever deleted by any code path in this feature.

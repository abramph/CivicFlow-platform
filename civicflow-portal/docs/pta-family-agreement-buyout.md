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

## Reporting

Report H — Family Agreement Status — was completed in the FA2 follow-up
round (see "Follow-up (FA2)" below) with full parity to Reports A-G: the
same `ReportData`/xlsx-builder pipeline, on-screen JSON, queued `.xlsx`
export via the existing hardened export queue, RBAC, tenant isolation, and
formula-injection protection. It is scoped to exactly one requirement
period and carries zero dollar amounts — see that section for the full
field list and permission rationale. The admin status-counts widget
described below remains as the at-a-glance summary on the period settings
page; Report H is the exportable, per-household detail view.

## Notifications

Four templates (`AGREEMENT_AVAILABLE`, `AGREEMENT_REMINDER`,
`AGREEMENT_ACCEPTED_CONFIRMATION`, `CONTRACT_OFFER_EXPIRING`). As of the FA3
follow-up, preview and a real test-send are two distinct, separately gated
service functions and routes — see "Follow-up (FA3)" → Notification
preview/test-send split for the full rationale and gating matrix; the
summary: `previewAgreementNotification`
(`POST .../agreement-notifications/preview`) only ever renders subject/text
and never calls `sendEmail`, gated on `pta:volunteer-requirements:manage` +
"requirements" (so an admin can review template copy before the
notifications flag is ever turned on); `sendTestAgreementNotification`
(`POST .../agreement-notifications/test-send`) is the only function in this
feature that can send a real email, gated on the new
`pta:volunteer-notifications:manage` permission + the "notifications"
capability (so it fails closed even when "requirements" is on and
"notifications" is off), rate-limited, and requires a typed `"SEND TEST"`
confirmation. Both take an explicit, validated recipient directly in the
request — there is no household/member lookup anywhere in either function,
so a real family's address can never be substituted in, silently or
otherwise. None of the 4 templates contain any link (payment or otherwise)
today, so the "no functional payment link before eligibility" constraint
holds trivially, not via a special-cased check. **No automated sweep exists
for this feature** — nothing schedules or sends a real notification to a
real family; no cron/worker file references any of the 4 notification
types. This is intentionally the same scope boundary the original spec, the
FA2 follow-up, and the FA3 follow-up all requested ("notifications remain
disabled... do not wire or run a production notification sweep"). A future
real sweep should reuse `PtaVolunteerNotificationLog`'s existing dedup
pattern (already used by the non-agreement volunteer-hours reminders)
rather than inventing a second one.

## Known limitations / deferred

- **No automated notification sweep** — preview/test-send only, by design
  for this phase (see "Follow-up (FA2)" → Notifications).
- **Mobile**: zero changes to `civicflow-mobile/`. This feature is
  web-only; a native flow (if ever built) is a separate, future program.
- **No amended-agreement bulk re-acceptance workflow** beyond "reassign the
  period's `agreementVersionId`" — there's no automated "notify everyone
  who accepted the old version" flow (would require the notification sweep
  above). Report H's version-mismatch column is the current, admin-visible
  way to see who still needs to re-accept.
- **Household-level acceptance only** — one authorized adult's acceptance
  suffices; no per-guardian signature tracking.
- **Content-hash mismatch has no repair path** — `resolveHouseholdAgreementStatus`
  fails closed (throws `PTA_VOLUNTEER_AGREEMENT_CONTENT_HASH_MISMATCH`) if
  it ever detects one, which should be structurally impossible via any
  application code path; there is deliberately no automated recovery,
  since a mismatch would only occur via direct database tampering and
  should get a human's attention, not a silent fix.
- **Resolved in FA3, previously flagged here as a follow-up**: the
  household/period Cascade on buyout elections/purchases/assessment
  charges/hour disputes (which predated this feature) is now `Restrict` at
  the database level, matching the acceptance table — see "Follow-up
  (FA3)" → Database-level retention hardening for the full record.

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
branch.** The FA2 follow-up round added zero further schema/migration
changes — Report H reuses `ReportExport.reportType`, which is a plain
`String` column (never a Prisma enum), so adding
`"PTA_VOLUNTEER_FAMILY_AGREEMENT_STATUS"` to the `VOLUNTEER_REPORT_TYPES`
TypeScript const array was sufficient; type safety comes entirely from that
array and the union type derived from it, exactly as it already did for
Reports A-G. The FA3 follow-up added one more additive migration,
`20260831120000_pta_family_agreement_retention_hardening` — see "Follow-up
(FA3)" → Database-level retention hardening for the full contents. Neither
migration has been applied to production; both were validated locally only
against a production-equivalent 118-migration baseline (120 total after
both apply).

## Follow-up (FA2)

A second, separately authorized round on this same branch, after the
original round above was accepted as architecturally sound but held back
from deployment review pending: Report H, family-side discoverability, an
explicit capability-guard matrix, additional lifecycle-edge-case
enforcement, and an unmocked proof of the contract-linked pricing chain.
Still not merged, pushed, or deployed; no production flag enabled; no
further schema changes (see "Migration" above).

**Report H — Family Agreement Status.** Scoped to one requirement period,
zero dollar amounts. Columns: family name, agreement required (yes/no),
assigned agreement title+version, acceptance status (not required / not
yet accepted / accepted), accepted by, accepted date/time in the
organization's own time zone (a pre-formatted text column, not a raw
`datetime` cell — see the code comment on why: Excel serial dates carry no
timezone of their own), contract-linked offer status (not applicable /
awaiting acceptance / open / expired) and its expiration, election
status/type, a version-mismatch note when the household's most recent
acceptance is for a version other than the one currently assigned, and an
operational exception/review status sourced from `PtaVolunteerHourDispute`
(the existing "report missing or incorrect volunteer record" flag — reused
here as the operational-exception signal, not a new concept). Uses the
ordinary `pta:volunteer-reports:view`/`:export` permission, the same gate
Reports A-D/F/G use — never the financial-reports permission Report E
requires, since there is nothing financial to protect. Flows through the
existing queue (`POST .../reports/exports`), worker
(`processQueuedReportExport`), and download route automatically, since all
three are keyed off the shared `VOLUNTEER_REPORT_TYPES` array rather than a
per-report special case.

**Family discoverability.** A self-hiding "Volunteer Commitment Agreement"
card on the existing `/labs/pta/my-pta` dashboard (inside the same
`SectionCard` `PtaVolunteerRequirementCard` already occupies — no new
section, no restructuring). Fetches
`GET /api/labs/pta/volunteer-hours/my-household/agreement` client-side and
renders nothing until that call resolves with `assignedVersion !== null` —
so it never appears merely because the platform/capability flags exist, an
error or capability-disabled response degrades to "don't render" (fail
closed) rather than an error banner, and there is no household-selecting
input anywhere on it (identity is always the authenticated adult's own
household, server-side). Five states: action required, accepted, offer
open, offer expiring (≤3 days left), offer expired. The show/hide and
state-selection logic is exported as two pure functions
(`shouldRenderAgreementCard`, `resolveCardState`) and unit-tested directly
— this repository has no React component-rendering test infrastructure
(`@testing-library/react`/jsdom), confirmed before writing tests rather
than assumed; adding that is a separate decision than this task warranted,
so the visibility CONTRACT is tested exhaustively while the render SHELL
around it is not independently tested.

**Capability-guard matrix**, the explicit rule this follow-up formalized
(some already true structurally, some newly enforced):

| Action | Capability required | Where enforced |
|---|---|---|
| View/accept a required agreement | `requirements` only | `my-household/agreement[/accept]` routes — never `buyout` |
| View contract-linked buyout terms/rate/eligibility window | `requirements` **+** `buyout` | `my-household/agreement` GET now separately checks `buyout` availability and zeroes the 3 contract-linked fields when it's off, without blocking the route |
| Complete a volunteer-only agreement while buyout is disabled | `requirements` only | same route — the accept path never references `buyout` at all |
| New acceptance while `requirements` is disabled | blocked (fail-closed) | `requireVolunteerHoursHouseholdAccess("requirements")` throws before `acceptAgreement` runs |
| Admin viewing historical acceptance/audit records | survives any single capability (incl. `requirements`) being off | new `requireVolunteerHoursAuditAccess` guard — only the platform kill-switch + org allowlist + RBAC permission gate it, not `requireVolunteerHoursFlag`'s capability check |
| Notification preview/test-send | `requirements` (not `notifications`) | mirrors the pre-existing sibling `.../notifications/preview` route's own documented reasoning — preview must work before the send-gating flag is ever turned on |
| A real automated notification sweep (not built) | would require `notifications` **+** the relevant capability | documented for whenever that sweep is eventually built |

**Additional lifecycle enforcement** (beyond what the original round
already had — see that section above for what was already true):
archiving a period's actively-required agreement version now requires an
atomically-assigned replacement (`archiveAgreementVersion`'s new
`replacementVersionId` parameter, admin UI has an inline picker); a period
must be `ACTIVE` to receive a *new* acceptance (`PTA_VOLUNTEER_PERIOD_NOT_ACTIVE`,
reusing the exact code `assertBuyoutWindowOpen` already established for
the identical condition) — a DRAFT/CLOSED/ARCHIVED period's history stays
fully readable, only new writes are blocked; a content-hash mismatch
between an acceptance's snapshot and its version's live hash fails closed
(throws, never silently returns a status); `deletePtaHousehold` now also
refuses to hard-delete a household with agreement-acceptance history (the
FK is Cascade, matching every other household-scoped model in this
vertical, so this application-layer guard is what actually keeps that
cascade unreachable — mirrors the pre-existing DuesCharge guard). Already
true from the original round and reconfirmed here, not re-built: a period
can't require acceptance without an assigned published agreement; a draft
can't be assigned; a published version can't be edited through any route;
a new version never silently invalidates a prior acceptance; elections stay
tied to their original acceptance; a second adult's submission is
idempotent, not a second row; concurrent submissions (2-way and 10-way)
collapse to exactly one row via the real-Postgres integration suite; no
admin write route can create or backdate an acceptance (confirmed by
direct code search — `ptaVolunteerAgreementAcceptance.create` appears in
exactly one function, in the whole codebase); an inactive organization or a
removed household member is already blocked by the shared
`requirePtaHouseholdSelfAccess` guard every household route in this
program uses (not something this feature added).

**Contract-linked pricing — unmocked proof.** A new real-Postgres
integration suite,
`contract-linked-pricing.integration.test.ts`, proves (against actual
overlapping pricing windows and real households, not mocks): a household
with a real acceptance gets the `contractSigningOnly` rate at its trusted
`acceptedAt`; a household with no acceptance gets the regular rate even
when a contract-only window also covers "now"; one household's acceptance
never grants another household eligibility; the quoted rate freezes onto
an election and survives both a later edit to the same pricing window's
amount AND a later agreement-version reassignment; the buyout window's own
expiration and a pricing window's own `[startAt, endAt)` expiration are
each enforced independently (an expired contract-linked window falls back
to the regular one, never to "no rate"); acceptance alone creates no
purchase, ledger entry, or election of any kind.

## Follow-up (FA3)

A third, separately authorized round on this same branch, after FA2 was
accepted as architecturally sound but held back from deployment review
pending a database-level retention/security hardening pass. Still not
merged, pushed, or deployed; no production flag enabled; no production
agreement/acceptance created; no email sent; Stripe not contacted; mobile
and QR code untouched; assessment-reversal work not started.

**Database-level retention hardening.** The single biggest gap this round
closed: every history-bearing model's `householdId`/`requirementPeriodId`
foreign key was `onDelete: Cascade` at the database level (matching this
vertical's ordinary, non-historical convention), meaning a household or
period hard-delete would silently destroy that history via ANY write path
— not just `deletePtaHousehold`'s own application-level guard, which a
future service, migration, or raw admin command could simply not call. The
new migration, `20260831120000_pta_family_agreement_retention_hardening`,
recreates 11 foreign keys as `ON DELETE RESTRICT ON UPDATE CASCADE`:

| Model | Restrict FKs | Reason |
|---|---|---|
| `PtaVolunteerAgreementVersion` | `requirementPeriodId` | a published version a household accepted must survive a period delete attempt |
| `PtaVolunteerAgreementAcceptance` | `requirementPeriodId`, `householdId` | the acceptance itself is the historical record this whole round protects |
| `PtaVolunteerBuyoutElection` | `requirementPeriodId`, `householdId` | a stated election is real financial history |
| `PtaVolunteerBuyoutPurchase` | `requirementPeriodId`, `householdId` | a completed or pending purchase is real payment history |
| `PtaVolunteerAssessmentCharge` | `requirementPeriodId`, `householdId` | a posted charge is a real financial obligation |
| `PtaVolunteerHourDispute` | `requirementPeriodId`, `householdId` | a submitted dispute is an operational/compliance record |

Deliberately unchanged (still Cascade, out of scope): `PtaVolunteerAssessmentCharge`'s
own `batchId`/`lineId` FKs and `PtaVolunteerAssessmentBatch`/`Line`'s FKs to
period/household — Postgres aborts an entire `DELETE` statement if ANY
single `Restrict` FK on the target row would be violated, so the charge's
own direct `Restrict` FK is already sufficient to block a period/household
delete whenever charge history exists, independent of these other,
never-directly-exercised relationships. `PtaVolunteerReviewFlag` and
`PtaVolunteerNotificationLog` were also left untouched — genuinely
non-historical, operational-only records, and out of the user's named
scope for this pass. Confirmed via read-only production row counts, before
writing the migration, that all 4 newly-restricted sibling tables (buyout
elections/purchases, assessment charges, hour disputes) were empty in
production — so this is a pure future-behavior change, not a data
migration; no existing row anywhere is affected.

`PtaVolunteerAgreementAcceptance` also gained two permanent, non-PII signer
snapshot columns — `signerDisplayNameAtAcceptance` (`NOT NULL`, default
`''` for migration safety) and `signerRelationshipAtAcceptance` (nullable)
— resolved once, server-side, at `acceptAgreement()` time from the
accepting adult's `PtaHouseholdAdult.name`/`relationshipLabel`, with a
defensive fallback to the authenticated user's own displayName/email if the
adult lookup somehow fails to yield a name. Deliberately NOT collected:
IP address, device fingerprint, user agent. This is what makes historical
"Accepted by" display survive `acceptedByAdultId` being `SetNull`'d (when a
household member is removed) without ever re-deriving from a live join —
Report H's `acceptedByName` resolution now prefers this snapshot over the
live `acceptedByAdult` join and the legacy `typedName` field, in that
order. `acceptedByUserId` was deliberately left as a plain, non-FK string
(unchanged from the original round) rather than made `SetNull` — deleting
the signer's `User` row does not touch the acceptance at all, and the id
simply goes stale rather than ever being reassignable to a different user,
which is a stronger guarantee against "a new user claiming an old
acceptance" than a nullable FK would have been.

**Real-Postgres proof, not just mocked unit tests.** Two new integration
test files (both skipped by default; see each file's own header for the
exact env vars to run them), plus new named cases added to the existing
concurrency suite:

- `agreement-acceptance-concurrency.integration.test.ts` (extended): 2-way
  and 10-way simultaneous acceptance submissions each collapse to exactly
  one row AND exactly one `agreement_accepted` audit event (not just "one
  row" — both counts are asserted); two different authorized adults in the
  same household racing still produce one household acceptance; two
  households racing simultaneously remain fully independent (one row/one
  audit event each); a sequential repeat after success creates neither
  another row nor another audit event; and — the new proof this round
  specifically required — forcing `createAuditEvent` to throw (via a thin
  wrapper around the real `@/lib/audit` module, not a mocked Prisma client)
  rolls the acceptance row back for real, in real Postgres, inside the same
  `$transaction`, and an immediate retry afterward succeeds exactly once.
- `retention-hardening.integration.test.ts` (new): raw SQL `DELETE`
  statements (bypassing every application code path) against a household
  or period with acceptance/election/purchase/charge/dispute history are
  rejected by Postgres itself; removing household membership (deleting the
  `PtaHouseholdAdult` row) `SetNull`s `acceptedByAdultId` without deleting
  the acceptance or touching its snapshot columns; deleting the signer's
  `User` row leaves the acceptance completely untouched; archiving (a
  status update) retains all history; a same-shaped org B's rows are
  unaffected by an org A delete attempt; and a constraint-metadata drift
  test queries `information_schema` directly for exactly the 11 FKs above
  and asserts `delete_rule = 'RESTRICT'` on each — so a future schema
  change that silently reintroduces `Cascade` on any of them fails this
  suite immediately, independent of whether any delete-attempt test above
  would happen to catch it too.

**Notification preview/test-send split.** Previously, one function
(`previewAgreementNotification`) both rendered a template AND sent a real
email to a caller-supplied address, gated only on the "requirements"
capability — meaning a real send was possible with the "notifications"
flag off. This round split it into `previewAgreementNotification` (render
only, never calls `sendEmail`, same "requirements"-only gate, since
preview must work before notifications is ever turned on) and the new
`sendTestAgreementNotification` (the only function in this file that can
send), fronted by a new route,
`POST .../periods/[periodId]/agreement-notifications/test-send`, gated on
a new dedicated permission (`pta:volunteer-notifications:manage`, granted
to `ORG_OWNER`/`ORG_ADMIN`/`STAFF`, not `FINANCE`) **and** the
"notifications" capability — so with an org's notifications flag off, a
test-send now fails closed even when "requirements" is on. The route is
additionally rate-limited (5/minute/IP, same `requireRateLimit` helper and
before-auth-check ordering the household-adult-invite route already uses)
and requires a typed `"SEND TEST"` confirmation (mirroring
`/api/account/delete`'s "type DELETE to confirm" pattern) before it will
call `sendTestAgreementNotification`. The audit event
(`agreement_notification_test_sent`) is always written AFTER the send
attempt and always reflects the real outcome (`delivered: true`/`false`)
— it never falsely claims a delivery that didn't happen, and a failed send
still re-throws so the caller sees a real error. No CSRF token was added:
this route relies on the same baseline every other authenticated POST
route in this app already relies on (NextAuth's `SameSite=Lax` session
cookie plus the required `application/json` body, which a plain cross-site
HTML form cannot send) — the typed confirmation phrase is a guard against
an accidental or replayed submission, not a CSRF token, and this
repository has no CSRF-token infrastructure anywhere else to be consistent
with.

**Historical audit access reconfirmed, not changed.** `requireVolunteerHoursAuditAccess`
(introduced in FA2) still requires: an authenticated user and resolved org
context (via `requirePermission`, which takes no client-suppliable org id
at all — cross-org ID guessing is structurally impossible, confirmed by a
new test proving two different callers, in two different sessions, only
ever get back their OWN org); the caller's own RBAC permission; PTA-vertical
membership; the platform kill-switch; and the pilot org allowlist. It
deliberately does NOT require any per-capability flag (`requirements`,
`notifications`, etc.) — audit review must survive a capability being
turned off, since that is often exactly when a review is needed. Confirmed
via a repo-wide search that this guard has exactly one call site (the
dedicated `GET .../volunteer-hours/audit` route) — it cannot be reused as a
bypass for any active feature route. New tests added this round: the
platform-off/org-not-allowlisted/insufficient-permission cases already
existed from FA2; this round added the explicit cross-org-ID-guessing
proof at both the guard layer (two sessions, two different resolved orgs)
and the route layer (a guessed `?organizationId=` query param in the URL
has zero effect, since the route reads no such parameter at all).

**`deletePtaHousehold` guard alignment.** The existing application-level
guard (already checking agreement-acceptance history since FA2) was
extended to also check buyout election/purchase/assessment-charge/hour-dispute
history, mirroring the database-level `Restrict` FKs above — this remains
defense in depth, a friendly typed `PtaError` in front of what the database
itself already refuses; it is not the only thing preventing the loss.

**Test-count reconciliation.** A fresh, isolated `vitest run` on this
commit: **4,264 passed / 144 skipped** (up from the pre-FA1 baseline of
4,130 passed / 121 skipped at commit `1fb0bc3`), fully accounted for by
net-new tests added across all three rounds — no existing test was
deleted, and no previously-passing test became newly skipped. Full
verification suite run on this commit: `tsc --noEmit` (both the full and
production-only `tsconfig.build.json` variants), ESLint clean across every
file changed in all three commits, `prisma validate` and `prisma migrate
status` (120 migrations, schema up to date against the local
production-equivalent database), a full production build (`next build`,
clean exit), and the mobile-compatibility contract-test suite (88/88
passing, confirming zero `/api/mobile/pta/*` response-shape drift).

**`git worktree` / `node_modules` incident — verified no lasting damage.**
An earlier round in this same branch's history recovered from a
`git worktree remove --force` that recursed through a Windows junction and
deleted the real `node_modules`. Objective, itemized re-verification this
round: `git worktree list` shows only the primary worktree (no orphaned
registration); no symlink or junction exists anywhere in the repo tree;
`node_modules` is confirmed a real directory via `fs.lstatSync`, not a
symlink; `package.json`/`package-lock.json` have zero diff against `HEAD`;
the generated Prisma client reflects the current schema (including this
round's brand-new signer-snapshot columns), confirming a fresh, non-stale
`prisma generate`; `git fsck` reports only ordinary dangling objects (no
corruption); `git log`/`HEAD` match the expected commit sequence exactly;
and every command in this section — typecheck, lint, the full test suite,
real-Postgres integration tests, and the production build — ran
successfully against this exact, restored dependency tree.

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

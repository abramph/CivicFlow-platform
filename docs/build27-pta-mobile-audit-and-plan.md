# Build 27 — PTA Mobile Role, Administration, Communications, QR, and Visual Completion

**Branch:** `feature/pta-mobile-build27` · **Base:** `ef28b0d` (the exact Build 26 preview commit, the tree iOS build `d6933818` was built from) · **Worktree:** `C:\dev\my-cbo-app-build27`

Build 26 (`test/build26-staging-preview`, PR #185) is under physical-device testing and is not
modified by anything in this program. All server changes are **additive and
backward-compatible** with Build 25/26 clients, because the portal deploys
independently of any app-store release.

This document is commit 1 of the program: the code-backed capability audit and
the implementation plan. Every claim below was verified against the code at
`ef28b0d`; file references are relative to the repo root.

---

## 1. Current-state capability matrix (before)

Personas:

- **P** — Parent-only: `PtaHouseholdAdult.userId` link, no `OrganizationMembership`.
- **A** — Admin-only: active non-`MEMBER` `OrganizationMembership` (e.g. `ORG_ADMIN`), no household link.
- **PA** — Admin who is also a linked parent (both of the above).
- **S** — Staff/authorized scanner: `STAFF` role holding `pta:volunteers:checkin` only.
- **M** — Ordinary organization member: `MEMBER` role + linked `OrgMember`.

Legend: ✅ works · ⚠ partly/conditionally · ❌ unavailable · `†` = capability exists in code but is dark in practice because the Mobile Admin surface is Labs-gated `internalOnly` (see §2.1).

| Capability | P | A | PA | S | M |
|---|---|---|---|---|---|
| See My Family | ✅ | ❌ (correct — no family) | ✅ *if household-linked; no way to become linked from mobile* | ❌ | ❌ |
| Add/manage family members | ❌ | ⚠† via admin household screens (any household) | ⚠† same; no self-link path | ❌ | ❌ |
| Edit family information | ❌ (photo only) | ⚠† displayName/interests/notes only | ⚠† same | ❌ | ❌ |
| Edit student information | ❌ | ❌ (no update path exists at all) | ❌ | ❌ | ❌ |
| Add a family photo | ✅ | ⚠ web officer route only, not mobile admin | ✅ (as parent) | ❌ | ❌ |
| Add/replace a student photo | ❌ (feature does not exist anywhere) | ❌ | ❌ | ❌ | ❌ |
| View messages & announcements | ✅ | ⚠ inbox ✅; announcements silently empty (client) / 403 (server) unless OrgMember-linked | ✅ | ⚠ same as A | ✅ |
| Archive a personal inbox item | ❌ (no model, endpoint, or UI exists) | ❌ | ❌ | ❌ | ❌ |
| Compose/send an announcement | ❌ | ⚠† composer + backend exist, dark | ⚠† | ❌ | ❌ |
| Scan attendance/event QR | ❌ *(has no entry point and is hard-redirected; server also 403s)* | ⚠ only if OrgMember-linked | ❌ *(memberId withheld → redirect)* | ⚠ same as A | ✅ |
| Approve volunteer hours | ❌ | ✅ (approve only, no reject; reachable only via Volunteer tab) | ✅ | ❌ (no approve perm) | ❌ |
| Access progression information | ✅ (published only) | ❌ (no mobile admin progression view) | ✅ (as parent) | ❌ | ❌ |
| Access administrative tools | ❌ | ⚠† | ⚠† | ⚠ volunteer check-in only | ❌ |

### Per-capability trace (how each result was derived)

Every cell above traces through six layers:

1. **Mobile navigation/screen gating** — `(tabs)/_layout.tsx:15,20` (Volunteer tab = `Boolean(pta)`, Admin tab = `adminCapabilities.length`); `dashboard.tsx:65-83,319,434,469` (identity switches); hard redirects `attendance-scan.tsx:70-72`, `attendance-history.tsx:53-55`, `profile-edit.tsx:86-88`, `pta-my-family.tsx:107-109`, `pta-progression.tsx:116-118`.
2. **Authentication claims** — mobile JWT carries only `{sub, type, v, iat, exp}` (`mobile-auth.ts:69-75`); every authorization fact is re-derived per request from the DB, and `mobileTokenVersion` is re-validated per request.
3. **Membership/parent identity** — `/api/mobile/organizations` merges four passes into one row per org; a row can carry `memberId` + `pta{householdAdultId,isOfficer,canCheckIn,canApproveHours}` + `capability.adminCapabilities[]` simultaneously (proven by `mobile-organizations-route.test.ts:224-240`). The one deliberate suppression: `memberId` is **withheld** from any row with a PTA household link (`route.ts:287-289`) to protect the client's legacy `hasMemberIdentity ? conventional : PTA` two-way switch.
4. **RBAC** — `getEffectivePermissions` (role defaults + per-org `OrgRolePermissionSet` overrides); PTA officer flags come from `pta:volunteers:checkin` / `pta:volunteer-hours:approve`; admin capability flags from `resolveMobileAdminCapabilities()`'s `FLAG_RULES` (`mobile-admin.ts:80-101`).
5. **API authorization** — guard ladder in `mobile-auth.ts`: `requireMobileAuth` → `requireMobileOrgAccess` (any tie) → `requireMobileMembership` (OrgMember) → `requireMobilePtaHouseholdAccess` (household link) → `requireMobileStaffPermission` (staff + exact permission); admin routes add `requireMobileAdminAccess` + capability flag, and money/HOA/PTA-household routes double-gate with an exact RBAC permission.
6. **Organization/tenant isolation** — `organizationId` is always client-supplied but never trusted; every guard re-derives the `(userId, organizationId)` tie. The scan endpoint goes further: it accepts **no** organizationId at all and derives it from the QR token's session.
7. **Feature flags** — Mobile Admin: Labs `mobileAdmin` (`INTERNAL`, `internalOnly: true`, enrollment required). Volunteer-hours program v2: platform env switch → org allowlist → six `PtaProfile` booleans (`requireVolunteerHoursFlag`). Progression: platform env switch + `PtaProfile.studentProgressionEnabled`. Family photo and announcements: no feature flag.
8. **Subscription gates** — `assertOrganizationAccess` on every org-scoped guard; `requirePlanFeature("emailCampaigns")` on email campaign create/send; `pdfExport` on report send. `/api/mobile/organizations` itself is deliberately un-gated so the switcher can list billing-inactive orgs.

## 2. Root causes of the ten preview findings

| # | Preview finding | Root cause (code-verified) |
|---|---|---|
| 1 | No individual student photos | No student photo exists anywhere: `PtaStudent` has no photo field, no endpoint, no UI. Only `PtaHousehold.photoUrl`. |
| 2 | Parents can't update family/contact/student info | Parent self-service can change exactly one thing (the family photo). No PATCH for adults; **no update path for students at all**; no review-queue model for PTA changes. |
| 3 | No visible QR scanner | Dashboard scan button gated on `hasMemberIdentity` (`dashboard.tsx:434`); `attendance-scan.tsx:70-72` hard-redirects `memberId:null` users; **server** `POST /api/mobile/attendance/check-in` requires an active `OrgMember` (`requireMobileMembership`), so household adults are 403'd anyway. |
| 4 | Can't archive/remove messages | No archive state exists in the data model (`CommunicationRecipient` has only `readAt`; conversations have only `lastReadAt`), no endpoint, no UI. |
| 5 | Admins lack parent functionality | Admin-only users correctly get no family UI (no household link — by design), but their dashboard is **entirely blank**: the whole data load is gated on member-or-PTA identity (`dashboard.tsx:86`) with no admin affordance. |
| 6 | Admin-parent can't add their own family | The invite/link flow (PR #85) exists server-side (`household-adult-invites.ts`) but is exposed on the **web only**; mobile admin household screens do pure roster entry with no invite ("no built officer workflow" comment at `mobile/admin/.../adults/route.ts:20-24` predates the web invite route). |
| 7 | Admins can't send announcements from mobile | Composer + backend exist (`admin-campaigns/new.tsx`, `POST /api/mobile/admin/campaigns` sharing the web's `createCommunicationCampaign`), but the whole admin surface is dark (§2.1) — and the composer has no audience selection, no preview, no confirmation, no duplicate protection. |
| 8 | No mobile admin dashboard for approvals | `GET /api/mobile/admin/dashboard` exists but is dark (§2.1); volunteer-hour approvals are disconnected from it (gated on `pta.canApproveHours`, reachable only via a Volunteer-tab officer card that is itself inconsistently gated on `isOfficer`); mobile approvals are approve-only (no reject). |
| 9 | Visually flat | Token system is minimal (`Spacing`, 5 scheme colors, 5 `ActionColors`, 2 button components); only 2 of 74 styled files use `ActionColors`; no Card/Chip/EmptyState primitives; 200+ hardcoded hex occurrences. |
| 10 | Capabilities hidden by one selected identity | The client's two-way identity switch (`mobile-api.ts:1935-1950` "hasMemberIdentity always wins") plus the server's deliberate `memberId` withholding for household adults flattens dual-identity users onto a single identity for announcements/dues/profile/scanning. |

### 2.1 The Mobile Admin Labs gate (affects findings 5, 7, 8)

`resolveMobileAdminCapabilities` returns empty unless the org passes
`getOrganizationLabAccess(orgId, "mobileAdmin")` — registry entry is
`lifecycle: "INTERNAL", internalOnly: true, requiresEnrollment: true`, so only
**billing-exempt orgs with an ENABLED enrollment row** ever see the Admin tab.
The staging preview org is presumably neither, which is why the preview shows
no admin surface at all.

**Decision:** Build 27 does not change this rollout gate. Making the staging
org billing-exempt + enrolled is an environment step for the walkthrough;
promoting `mobileAdmin` beyond INTERNAL is a **business decision flagged for
the owner** in the final report.

## 3. Architectural approach — additive dual-role identity

The server already resolves identities additively; the client (and one
compatibility shim on the server) flatten them. The fix:

1. **New additive field** on each `/api/mobile/organizations` row:
   `constituentMemberId` — the role-agnostic linked `OrgMember` id, populated
   for **every** row where one exists, including household-adult rows. The
   legacy `memberId` field keeps its exact current semantics (withheld for
   household adults) so Build 25/26 clients in the field are byte-for-byte
   unaffected. Old builds ignore unknown fields (established pattern —
   `capability`, `rsvp` were introduced the same way).
2. **Client capability model** (`auth-context`): derive explicit, independent
   booleans per org — `hasParentIdentity` (household link), `hasMemberIdentity`
   (`constituentMemberId ?? memberId`), `isPtaOfficer`, `canCheckIn`,
   `canApproveHours`, `adminCapabilities`. Screens key off the specific
   capability they need; the two-way `ForIdentity` switches are replaced by
   union reads (fetch member + PTA announcement lists when both identities
   exist; merge, dedupe by campaign id).
3. **Workspace navigation**: tabs stay additive (Volunteer for any PTA tie,
   Admin for any admin capability). The dashboard gains a prominent Admin
   workspace card for admins (fixing the blank-dashboard case), and the Admin
   dashboard gains a "Back to member/parent view" affordance. No sign-out, no
   account switch, no modal switcher — both workspaces are one tap apart at
   all times, satisfying the dual-session requirement with the least
   navigation novelty.
4. **Server enforcement unchanged in spirit**: nothing grants parent access
   for being an admin or vice versa. Every new endpoint uses the existing
   guard ladder; every new admin action double-gates (capability flag + exact
   RBAC permission where one exists).

## 4. Batch plans

### Batch 1 — Navigation and role correction (commit 2)
- Server: add `constituentMemberId` (additive; keep branch-4 withholding for `memberId`); populate `pta.householdName` from the household row (currently hardcoded `null` at 4 sites); add `POST /api/mobile/admin/pta/households/[householdId]/adults/[adultId]/invite` delegating to the existing `household-adult-invites.ts` service (`PTA_HOUSEHOLDS_MANAGE`).
- Client: capability model above; dashboard renders a real admin state (and a real "nothing here yet" state for capability-less logins); Volunteer tab/content gating unified (`Boolean(pta)` tab → parent section on `householdAdultId`, officer section on `canCheckIn`/`canApproveHours`, not `isOfficer`); client-side guards + consistent unauthorized states added to the 16 unguarded admin sub-screens and `volunteer-checkin/[opportunityId]`, `pta-family-photo`, `pta-documents`; loading/empty/error/offline states via shared components; household invite button on mobile admin household detail.
- Explicitly reused, not duplicated: parent screens are shared — the admin workspace links to the same `pta-my-family` etc. when the caller holds the parent identity.

### Batch 2 — Student photos and parent updates (commit 3)
- Schema (additive migration): `PtaStudent.photoUrl String?`; `AttachmentEntityType.PTA_STUDENT`; purpose `"STUDENT_PHOTO"`.
- Service: extract the household-photo validation/re-encode pipeline (magic bytes → declared-MIME agreement → sharp decode with 40 MP guard → sharp-format agreement → EXIF-stripping re-encode → tenant-scoped `buildSafeObjectKey`) into a shared internal helper used by both `household-photo.ts` and a new `student-photo.ts`; same delete-object-first removal, tombstoning, orphan sweep, audit shape (ids and byte sizes only — never names/keys/URLs).
- Routes: `GET|POST|DELETE /api/mobile/pta/students/[studentId]/photo` (parent: `requireMobilePtaHouseholdAccess` + student-in-own-household check, POST rate-limited like the family photo) and web/mobile admin variants under `pta:students:manage` with audit. Serve via `familyPhotoBytesResponse`-style authenticated bytes — no signed URLs. Placeholder initials avatar client-side.
- Privacy: extend `docs/pta-family-photo-privacy.md` to cover student photos under the identical contract; extend the mobile privacy pin test.
- Parent-managed information — field classification (from the real data model):
  - **Directly editable (parent):** own `PtaHouseholdAdult` contact fields (name/email/phone/relationshipLabel) via new `PATCH /api/mobile/pta/my/adult` (self-row only); household `volunteerInterests`; family photo (exists); student photo (new).
  - **Pending admin approval:** household `displayName`; add student; student `displayName` correction; student grade/classroom placement (applies to `PtaStudentEnrollment`, never the student row); remove student. New model `PtaFamilyChangeRequest` (org-scoped, household-scoped, submitted-by adult, typed payload, status `SUBMITTED/APPROVED/REJECTED/APPLIED` with CAS-guarded transitions — the Member-Intake pattern, new tables because that program's FKs are `OrgMember`-bound). The apply engine writes through the existing service functions so approved changes land on the real household/student/enrollment records — never inert JSON.
  - **Read-only:** membership/billing identity, dues, school year, background-check status, progression placements.
  - **Deliberately not added:** emergency contacts, DOB, medical, custody — the schema's written data-minimization contract (`schema.prisma:4700-4705, 4935-4940`) forbids them; flagged in the report rather than silently violated.

### Batch 3 — Mobile admin dashboard (commit 4)
- Extend `GET /api/mobile/admin/dashboard` with permission-gated blocks: pending volunteer-hour count (gated by effective `pta:volunteer-hours:approve`), pending family change requests (`managePtaHouseholds`), attendance-session shortcuts (`manageAttendance`), create-announcement quick action (`manageCommunications`), recent admin activity from `AuditEvent` (`manageOrganization`).
- New `POST /api/mobile/pta/volunteers/hour-entries/[entryId]/reject` mirroring the existing approve route (same guard, reason required, service already enforces PENDING-only + self-approval block).
- `(tabs)/admin.tsx` becomes operational: pending-work-first cards with counts and status chips (pending/approved/rejected/needs-correction/completed vocabulary), quick actions, recent activity. Volunteer-hour approvals get reject support and an entry point from the admin dashboard (still gated by the PTA permission, not the umbrella flag).
- Untouched: assessment/ledger/deadline/flag rules (`requireVolunteerHoursFlag` chain, idempotent ledger mirroring, self-approval block); nothing enables org-disabled features.

### Batch 4 — Mobile announcement composer (commit 5)
- Backend already accepts `recipientFilter` on the mobile route; add a mobile `POST /api/mobile/admin/campaigns/preview-recipients` counterpart (same `manageCommunications` gate) and light duplicate protection on create (reject an identical org+creator+title+body campaign within a short window; plus client double-tap guard).
- Composer UI: audience selection (the existing base selectors; the 6 PTA targeting modes for PTA orgs — `all/grade/classroom/committee/volunteers_for_event/unpaid` — resolved server-side exactly as the web form does), preview step with recipient count, explicit send confirmation, success/failure states, safe retry (draft is preserved on send failure; send is a separate idempotent-by-status call). Audit attribution already exists (`createdByUserId` + audit events). Scheduling/push/WhatsApp are exposed only where the backend already supports them (scheduledFor, pushEnabled); no new announcement model.

### Batch 5 — Message/announcement lifecycle (commit 6)
- Additive migration: `CommunicationRecipient.archivedAt DateTime?`; `CommunicationCampaign.withdrawnAt DateTime?` + `withdrawnByUserId String?`.
- Recipient actions (member + PTA variants, rate-limited): archive/restore endpoints scoped to the caller's own recipient row exactly like mark-read; list endpoints gain an archived flag + archived view; read/unread unchanged. Archiving never affects other recipients. (PTA household granularity note: recipient rows target the household's billing member, so archive state — like read state today — is shared between the household's adults; documented, consistent with `docs/pta-communication-identity.md`.)
- Admin actions: `DELETE` of DRAFT-only campaigns (`manageCommunications` / `communications:write`, audit event); `POST .../withdraw` for SENT announcements — sets `withdrawnAt`, writes an audit event, member-facing lists exclude withdrawn, admin lists label them "Withdrawn". No hard delete of sent communications; no retention change (the platform has no formal retention policy per `docs/customer-data-request-process.md` — permanent deletion stays out of scope and is flagged).

### Batch 6 — QR scanner and check-in (commit 7)
- Reuse only the existing signed-JWT infrastructure (`attendance-token.ts`, `resolveAttendanceSession`, `recordAttendanceCheckIn`, rate limits, rotation, `tokenVersion` revocation). **No second QR/token system.** Volunteer check-in remains roster-based per the documented deferral (`docs/pta-volunteer-shift-qr-checkin-deferral.md`).
- Server: extend `POST /api/mobile/attendance/check-in` to accept a caller whose only tie is a PTA household link — resolve the household's billing `OrgMember` and record attendance for it (org still derived from the token, active-status still enforced, duplicate protection intact: a second adult of the same household scanning yields the existing `alreadyCheckedIn` path). Membership identity keeps taking precedence when both exist.
- Client: replace the `memberId` redirect with capability gating (member identity OR household identity); prominent scanner entry on the dashboard for authorized users; full state rendering — success, duplicate, expired, revoked (stale version), wrong-org/not-eligible, unauthorized, offline, failure — using the server's closed rejection vocabulary; officer volunteer check-in linked from the same surface for `canCheckIn` holders.
- Never: parent scanning authority from parenthood alone (scanning here records only self/household attendance; officer scanning stays permission-gated), raw token contents or identifiers in UI/logs.
- **Separate assessment (report-only, not implemented):** parent-displayed family/member QR for admins to scan. Preliminary read: it inverts the current trust model (admin device becomes the verifier; would need a new token purpose + minting path for households). Recommendation deferred to the final report.

### Batch 7 — Visual system (commit 8)
- Extend `constants/theme.ts` with semantic tokens: brand palette, status colors (pending/approved/rejected/needs-correction/completed + info), workspace accents (parent vs admin), radii, elevation, icon-container tints — light/dark aware where surfaces branch.
- New primitives in `components/`: `Card`, `SectionHeader`, `StatusChip`, `IconBadge`, `StatTile`, `EmptyState`, `ScreenHeader` — accessible contrast, dynamic type, ≥44pt touch targets.
- Migrate the major parent and admin surfaces (dashboard, My Family, student detail, Volunteer, announcements/inbox, admin dashboard, approvals, composer, scanner, org-switcher, profile) — replacing hardcoded hex with tokens as each screen is touched.
- Screenshots: captured on the Android emulator if available in this environment; iOS simulator does not exist on Windows — any gap is documented honestly in the final report, never faked.

### Tests & verification (commit 9, plus per-batch tests)
Personas P/A/PA/S/M × the matrix above; multi-org and cross-tenant denial; photo upload/replace/remove + unauthorized access; change-request submit/approve/apply/reject; announcement authorization + duplicate; archive vs withdraw; approval authorization + idempotency; QR success/duplicate/expired/revoked/wrong-org; PTA vs member identity routing; flags and subscription gates; navigation parity; a11y labels/touch targets. Full required checks with baseline comparison (see §5).

## 5. Verification baseline (measured at `ef28b0d` in this worktree)

| Check | Result |
|---|---|
| Portal `npm run typecheck` | clean |
| Portal `npm test` (vitest) | 4796 passed / 178 skipped (418 files passed, 31 skipped) |
| Portal `npm run lint` | not in CI; 10 documented pre-existing errors on main |
| Mobile `npx tsc --noEmit` | clean |
| Mobile `npm run lint` | 0 errors, 2 pre-existing warnings (`(tabs)/__tests__/_layout.test.tsx` require-imports) |
| Mobile `npm test` | 73/73 suites, 480/480 tests |

## 6. Pre-existing issues found during audit (not caused by, and not silently fixed in, Build 27)

1. Push fan-out ignores `MobileDeviceToken.organizationId` entirely, and stale-token pruning deletes by token across all users (`push.ts:63-65`) — documented as "delivery target, not access boundary", but worth an owner decision.
2. `POST /api/labs/pta/my-household/photo` (web) has no rate limit; its mobile twin does.
3. Mobile announcement read endpoints have no rate limit (messages routes do).
4. `pta.householdName` hardcoded `null` at all four assignment sites (fixed in Batch 1 since it's additive and the client wants it).
5. `ptaVolunteerNativeMobileEnabled` is write-only (reserved; never read).
6. The PTA communications page maps a `"SCHEDULED"` status the enum doesn't contain (dead branch).
7. `attendance-scan.tsx` client gate is documented as a convenience gate; the real gate is the server's — the Batch 6 change keeps that discipline.

## 7. What Build 27 deliberately does not do

- No change to the `mobileAdmin` Labs rollout state (INTERNAL) — flagged as a business decision.
- No emergency contacts / DOB / medical fields on students (written data-minimization contract).
- No volunteer QR system (documented deferral stands).
- No hard delete or retention change for sent communications.
- No parent-displayed QR implementation (assessed and reported only).
- No store submission, no EAS build, no deploy, no merge — Build 26 artifacts remain the tested state.

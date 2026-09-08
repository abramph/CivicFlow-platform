# Build 27 — Final Report

**Program:** PTA Mobile Role, Administration, Communications, QR, and Visual Completion
**Branch:** `feature/pta-mobile-build27` · **Worktree:** `C:\dev\my-cbo-app-build27`
**Base commit:** `ef28b0d` (the exact Build 26 preview commit — the tree iOS build `d6933818` was built from)
**Final commit:** the commit introducing this report (commit 9 of the sequence below — `git log -1 feature/pta-mobile-build27`)

## Build 26 integrity

Build 26 remained untouched throughout:

- `test/build26-staging-preview` still points at `ef28b0d`; no commits were added, amended, or removed.
- PR #185 (`feature/pta-progression-mobile-ui-build26` @ `5672f1f`) was not merged, commented on, or modified.
- Local `main` was not pushed; nothing was deployed, migrated in production, EAS-built, or submitted to either store.
- All Build 27 work lives in a separate git worktree on a stacked branch.

## Commit sequence (reviewable batches)

| # | Commit | Content |
|---|---|---|
| 1 | `7667373` | Capability audit + documented plan (`docs/build27-pta-mobile-audit-and-plan.md`) |
| 2 | `50bebdb` | Additive dual-role capabilities and navigation |
| 3 | `5d9a4d2` | Student photos + parent-managed family updates (migration 1) |
| 4 | `0b5c7bd` | Operational admin dashboard + volunteer decline |
| 5 | `ae261b5` | Announcement composer: audiences, preview, confirmation, duplicate protection |
| 6 | `b635b8c` | Personal archive + administrative withdrawal (migration 2) |
| 7 | `5058fc8` | QR check-in for PTA parents on the existing token infrastructure |
| 8 | `22ae454` | Shared semantic design system + workspace-differentiated surfaces |
| 9 | _(this commit)_ | Final verification + this report |

## Capability matrix — before → after

Personas: **P** parent-only · **A** admin-only (no family) · **PA** admin + linked parent · **S** staff/authorized scanner (check-in permission only) · **M** ordinary member.
`†` = requires the org to hold the Labs `mobileAdmin` enrollment (unchanged INTERNAL rollout gate — see "Business decisions" below).

| Capability | P | A | PA | S | M |
|---|---|---|---|---|---|
| See My Family | ✅→✅ | ❌→❌ *(correct: no family)* | ⚠→✅ *(plus an in-app path to get linked: mobile admin household invite)* | ❌→❌ | ❌→❌ |
| Add/manage family members | ❌→✅ *(request-based, officer-approved)* | ⚠†→✅† | ⚠†→✅† (+ own family via the same invite/accept flow) | ❌→❌ | ❌→❌ |
| Edit family information | ❌→✅ *(own contact + interests direct; name/roster via review)* | ⚠†→✅† | ✅ both paths | ❌→❌ | ❌→❌ |
| Edit student information | ❌→✅ *(rename/placement/removal via review; applied to real records)* | ❌→✅† *(via change-request queue + first-ever student rename service)* | ✅ | ❌→❌ | ❌→❌ |
| Add a family photo | ✅→✅ | ⚠→⚠ *(web officer route, unchanged)* | ✅→✅ | ❌→❌ | ❌→❌ |
| Add/replace/remove a student photo | ❌→✅ *(own household only)* | ❌→✅ *(web officer route, `pta:students:manage`)* | ✅ | ❌→❌ | ❌→❌ |
| View messages & announcements | ✅→✅ | ⚠→⚠ *(inbox yes; announcements honestly explained — no recipient identity)* | ⚠→✅ *(union of both identities' inboxes, de-duplicated)* | ⚠→⚠ | ✅→✅ |
| Archive a personal inbox item | ❌→✅ | ❌→❌ *(no recipient rows)* | ❌→✅ | ❌→❌ | ❌→✅ |
| Compose/send an announcement | ❌→❌ | ⚠†→✅† *(audiences, preview, confirm, duplicate-safe)* | ✅† | ❌→❌ | ❌→❌ |
| Scan attendance/event QR | ❌→✅ *(household check-in, server-enforced)* | ⚠→⚠ *(only with a linked constituent OrgMember — admin status alone never scans)* | ❌→✅ | ⚠→⚠ | ✅→✅ |
| Approve volunteer hours | ❌→❌ | ✅→✅ *(+ decline with required reason, + queue visibility for approvals-only officers)* | ✅→✅ | ❌→❌ | ❌→❌ |
| Access progression information | ✅→✅ | ❌→❌ *(admin progression stays web)* | ✅→✅ | ❌→❌ | ❌→❌ |
| Access administrative tools | ❌→❌ | ⚠†→✅† *(operational dashboard: pending work, quick actions, activity)* | ✅† | ⚠→⚠ *(volunteer check-in tiles now surface on the dashboard)* | ❌→❌ |

**The architectural change behind the matrix:** capabilities are additive. The server's organizations endpoint now carries `constituentMemberId` on every row (legacy `memberId` semantics preserved byte-for-byte for fielded Build 25/26 clients), and the client derives independent booleans per org (`deriveOrgCapabilities`) instead of the old `hasMemberIdentity ? conventional : PTA` flattening. Nothing grants parent access for being an admin, or admin access for being a parent; every permission is enforced server-side and the client gates are explicitly display routing.

## Files and migrations changed

- **128 files changed, +7,240 / −784 lines** across the 8 code commits (`git diff --stat ef28b0d..HEAD` for the full list): portal routes/services including 3 new lib modules (`photo-pipeline`, `student-photo`, `family-change-requests`) and 14 new API route files; mobile screens including 4 new ones (`pta-edit-family`, `pta-student-photo`, `admin-pta-change-requests`, plus the shared `pta-photo-manager`) and 3 new shared components (`ui.tsx`, `unauthorized-notice`, `require-admin-capability`); and the per-batch test files on both sides.
- **Migrations (both additive, verified by applying all 128 migrations from scratch to a throwaway database plus the progression-constraint verifier):**
  - `20260906160954_build27_pta_student_photo_and_family_change_requests` — `PtaStudent.photoUrl`, `AttachmentEntityType.PTA_STUDENT`, `PtaFamilyChangeRequest` table + enums, plus one pre-existing index-name drift reconciliation Prisma emits for any new migration (rename only; the progression partial-unique index is untouched).
  - `20260907005342_build27_communication_lifecycle` — `CommunicationRecipient.archivedAt`, `CommunicationCampaign.withdrawnAt` / `withdrawnByUserId`.

## API and RBAC changes

**New mobile endpoints** (all on existing guard infrastructure; no new permission strings, no new roles):

| Endpoint | Guard |
|---|---|
| `GET/PATCH /api/mobile/pta/my/household` · `PATCH /api/mobile/pta/my/adult` · `GET /api/mobile/pta/my/classrooms` · `GET/POST /api/mobile/pta/my/change-requests` | household linkage (`requireMobilePtaHouseholdAccess`) — parent self-service never uses RBAC, per the standing rule |
| `GET/POST/DELETE /api/mobile/pta/students/[id]/photo` | household linkage + student-in-own-household check |
| `POST /api/mobile/pta/volunteers/hour-entries/[id]/reject` | staff + exact `pta:volunteer-hours:approve` + PTA vertical (approve's twin) |
| `POST /api/mobile/announcements/[id]/archive` (+ PTA twin) | membership / household linkage — own recipient row only |
| `GET /api/mobile/admin/pta/change-requests` + `[id]/approve` + `[id]/reject` | two-gate: `managePtaHouseholds` capability + exact `PTA_HOUSEHOLDS_MANAGE` |
| `POST /api/mobile/admin/pta/households/[hh]/adults/[a]/invite` | same two-gate; delegates to the existing PR #85 invite service |
| `POST /api/mobile/admin/campaigns/preview-recipients` · `GET .../targeting-options` · `POST .../[id]/withdraw` · `DELETE .../[id]` | `manageCommunications` capability |
| New web route `GET/POST/DELETE /api/labs/pta/students/[id]/photo` | GET dual-audience (`pta:directory:read` OR own-household parent); writes `pta:students:manage` |

**Changed endpoints (additive):** organizations (+`constituentMemberId`, real `householdName`), admin dashboard (+quick actions, +pending change requests, +recent activity, +approvals-permission-based hours queue), announcements lists (+`archived` view, withdrawn exclusion), mobile campaigns create (+duplicate 409), attendance check-in (+household-adult identity path).

**RBAC:** zero changes to permission definitions, role bundles, or `resolveMobileAdminCapabilities` flag rules. Existing permissions gained mobile surfaces only.

## Feature-flag behavior

- The Labs `mobileAdmin` INTERNAL/enrollment gate is **unchanged** — nothing in Build 27 widens the admin rollout (see Business decisions).
- Volunteer-hours program flags (`requireVolunteerHoursFlag` chain), progression flags, plan features (`emailCampaigns`, SMS/WhatsApp entitlements), and `assertOrganizationAccess` subscription gates are all untouched and still enforced at their existing chokepoints; every new admin route re-checks its capability + exact permission per request.
- No feature disabled for an organization was enabled by this program.

## Verification

_All numbers from full runs at the final commit in this worktree (Windows; CI runs the identical commands on ubuntu)._

| Check | Baseline @ ef28b0d | Final @ Build 27 |
|---|---|---|
| Portal `tsc --noEmit` | clean | clean |
| Portal vitest | 4796 passed / 178 skipped / 0 failed (449 files) | **4873 passed / 178 skipped / 0 failed** (456 files: 425 passed, 31 skipped) — +77 tests |
| Portal production build | (CI-green at base; not built locally at base) | **exit 0** (CI-equivalent command with placeholder `DATABASE_URL`) |
| Portal lint | not in CI; 10 documented pre-existing errors | unchanged — not touched |
| Mobile `tsc --noEmit` | clean | clean |
| Mobile lint | 0 errors / 2 warnings (pre-existing `require()` in `_layout.test.tsx`) | **0 errors / the same 2 pre-existing warnings** |
| Mobile jest | 480 passed / 0 failed / 0 skipped (73 suites) | **515 passed / 0 failed / 0 skipped** (77 suites) — +35 tests |
| Metro export iOS + Android | CI-green at base | **both exit 0** (run with `APP_VARIANT=preview` + staging URL — required by this line's fail-closed `app.config.js` guard; note CI's export step would need those env vars for a PR from this branch) |
| Migrations from scratch + progression constraint | 126 migrations, 23/23 | **all 128 migrations apply from scratch, `migrate status` clean, progression constraint 23/23** (throwaway database, since dropped) |

**New warnings vs baseline:** none — mobile lint's two pre-existing warnings are the only warnings before and after; no new tsc, jest, or vitest warnings were introduced.

**Test coverage added for the required matrix:** dual-role/persona routing (org-capabilities unit tests + organizations-route contract tests + dashboard persona tests), cross-tenant denial (student photo, change requests, invites, campaigns, check-in — each asserts org-scoped lookups and 404/403 for foreign ids), photo upload/replace/remove + unauthorized access (route tests + the shared-pipeline coverage riding the 36 household-photo contract tests + mobile privacy pin tests), change-request lifecycle (submit validation, per-household cap, CAS approve/reject, apply-through-services, rollback-on-apply-failure), announcement authorization + duplicate 409 + no-blind-fan-out, personal archive vs administrative withdrawal (own-row-only writes; withdrawn excluded from both member views; draft-only delete), volunteer approval/decline authorization + PENDING-only finalization, QR success/duplicate/expired/revoked/cross-org/household-identity/inactive-billing cases, PTA vs member identity (union announcements, RSVP contract regression suite), admin capability gating (guard HOC + per-screen no-access states), and a11y labels/44pt targets on every new interactive element.

## Security and tenant isolation evidence

- Every new route re-derives authorization per request from the database (`userId` × `organizationId`); `organizationId` is client-supplied but never trusted; the scan endpoint accepts no org id at all (token-derived).
- Parent self-service stays linkage-based (never RBAC); the only entity ids a parent client ever sends are a `studentId`/`classroomId`, which the server re-validates against the caller's own household and the current school year — at submit AND at apply time.
- Child-image handling: student photos share the family photo's hardened pipeline **by construction** (one extracted module), bytes-only delivery, no signed URLs, delete-object-first removal, id-only audit records; privacy doc extended and pinned by tests on both sides.
- Household billing identity is never surfaced as a personal identity (`constituentMemberId` exclusion rule, tested), and the legacy `memberId` field is byte-compatible for fielded clients (tested).
- Admin actions are audited (`pta.family_change_request.*`, `pta.student.photo_*`, `pta.student.renamed`, `communication_campaign.withdrawn`/`draft_deleted`, `pta.household_adult.invited`, hour-entry rejections) with id/shape metadata only — no student names, keys, or URLs.
- Concurrency: CAS claims on change-request decisions and withdrawal; conditional status-scoped draft delete; the duplicate-campaign window; DB-unique check-in idempotency (pre-existing, now also covering household scans).

## Parent-displayed QR (assessed, deliberately not implemented)

A parent-shown family/member QR that an administrator scans **inverts the current trust model**: today the *organization* displays a short-lived, rotating, session-bound token and the *member's authenticated device* proves identity by scanning. A member-displayed code would need a new token purpose, a new minting path bound to household identity, its own revocation story, and an admin-side scan surface — a second token issuance model, exactly what the "no second QR system" rule exists to prevent. The attendance need it would serve (front-desk check-in of a family by an officer) is already served by the roster-based officer check-in flow. **Recommendation: do not add it in this form.** If desk-scanning becomes a real operational need, design it as a purpose-tagged extension of `attendance-token.ts` with its own review, not as a bolt-on.

## Screenshots

Not captured in this environment, and reported as such rather than approximated: iOS simulators do not exist on Windows; the Android emulator's installed preview APK embeds Build 26 JavaScript and is not a development client, so rendering Build 27 UI would require producing a new build (excluded by this program's constraints); and the remaining local path required writing to the shared development database, which was declined mid-session. The Build 27 staging-preview device walkthrough — the same process Build 26 is undergoing now — is the recommended point to capture the before/after set (parent home, My Family, student detail/edit, admin dashboard, approvals, composer, scanner, announcements), since it produces real-device imagery of both builds against staging.

## Business decisions flagged (not taken unilaterally)

1. **Mobile Admin rollout**: the entire admin surface remains Labs `mobileAdmin`, INTERNAL, enrollment-required, billing-exempt-only. Testing Build 27's admin features in staging requires enrolling the staging org (a database/ops step, not code); promoting the feature beyond INTERNAL is an owner decision.
2. **Retention/permanent deletion** of sent communications: not implemented; the platform has no formal retention policy (`docs/customer-data-request-process.md`).
3. **Emergency contacts / DOB / medical fields** on students: excluded per the schema's written data-minimization contract; adding them would be a deliberate policy change.
4. **Push token org-scoping** (pre-existing): fan-out ignores `MobileDeviceToken.organizationId` and stale-token pruning is global — documented as intended, but worth an explicit confirmation.

## Remaining risks / deferred items

- PTA grade/class/committee/event announcement targeting is web-only on mobile (no mobile entity-list endpoints yet); the composer says so explicitly.
- Web member-facing announcement surfaces (if any outside the two mobile routes) do not yet filter `withdrawnAt`; the shared mobile listing function does. Follow-up: sweep web `/m/` pages for announcement queries.
- Change-request review is mobile-first; a web officer queue is a natural follow-up.
- Mobile volunteer approvals still have no "adjust before approving" (web-only, unchanged).
- `pta-my-family` shows student photo entry points but renders initials, not photo thumbnails, in the roster list (each thumbnail is an authenticated fetch; batching deferred).
- Archive state for PTA households is household-shared (mirrors read state) — a per-adult inbox state would need a new model.
- Jest on this Windows machine flakes with 5s timeouts when run concurrently with other heavy processes; runs clean in isolation (documented so nobody chases ghosts).

## Release recommendation

**A new EAS build is required** to ship any of this to devices: all mobile changes are compiled into the app bundle (no OTA/updates channel is configured), and the server changes deploy with the portal as usual (both migrations are additive and safe to run before any client ships).

Recommended numbering, following the existing per-bundle-id counters:

- **Staging preview (walkthrough)**: `com.aphtechnologies.unestra.preview` — version `1.0.0`, buildNumber `2` (iOS; the preview counter is at 1), built from a `build27-staging` EAS profile pointing at a staging server running this branch's portal. The Build 26 staging server must be upgraded (or a second staging stood up) before the walkthrough, since Build 27's client needs the new endpoints.
- **Production candidates (after preview approval)**: iOS `1.0.0 (27)`, Android `versionCode 15` — continuing from the Build 26 candidates (iOS 26 / vc14 line).

None of this has been triggered — no EAS build, no deploy, no store submission, per the program constraints.

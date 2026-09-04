# Build 26 — final report

Program: "Implement the next controlled mobile release end to end" (camera-
permission correction, PTA student/family progression, optional family-photo
upload, stable mobile UI upgrade, PTA volunteer-hours/QR completion),
followed by a focused independent code-review-and-correction pass. Branch:
`feature/pta-progression-mobile-ui-build26`, based on `main`@`db73f2a` (=
`origin/main` exactly, confirmed via `git merge-base`). Constraint honored
throughout both passes: no merge, push, deploy, build upload, store
submission, production setting change, real payment, or real notification.

**HEAD at time of this report:** `01b95aad491a7e06dcf8cdcc9a6590cda19b8b55`
(the Part 14 verification pass's closing commit); this report's own Part 15
was produced by a subsequent, narrower credential-containment review that
added a `.gitignore` rule and documentation only.
**Working tree:** tracked working tree clean; **four** untracked paths
remain (`civicflow-portal/docs/operations/` and three unrelated dated
HTML report files under `docs/`), all confirmed pre-dating the Build 26
program by roughly 19 hours (Part 14) and none modified by any pass. The
count was five until Part 15's credential remediation: `.claude/` no
longer appears, because the one flagged file inside it has been removed
(recoverably, after confirmed revocation) and its three remaining entries
are gitignored local-tooling files. Separately, earlier drafts of this
report described the original set as "four" items; Part 14 traces that to
a plain arithmetic error in one sentence, not a real change in the
working tree — an unrelated coincidence with today's count.
**`fix/import-auth-order-and-format-ui`:** unchanged at `e92ffd7`/`983c8e2`,
re-verified byte-identical at the end of the build pass, the review pass,
the Part 13 completion pass, and this Part 14 verification pass.
**`main`:** unchanged at `db73f2a`. Nothing has been merged, pushed,
deployed, built via EAS, or submitted to Apple or Google at any point in
any pass.

## Part 1 — Complete commit inventory (14 commits)

| # | Commit | Subject | Phase | Files changed | Content type | Shared-core vs PTA-only |
|---|---|---|---|---|---|---|
| 1 | `a45d142` | academic-year student progression foundation | B | migration.sql, schema.prisma, attachments.ts(+test), env.ts, rbac.ts | migration + code + tests | Shared-core files touched, all changes additive-only |
| 2 | `d1628ba` | student progression service + APIs | C | 8 new routes + 1 route test, student-progression.ts (new), errors.ts, 1 service test | code + tests | PTA-only |
| 3 | `f8fb39a` | student progression admin UI + feature flag | D | profile route/lib, layout.tsx, settings page, student-progression page (new), 2 components (1 new), 1 test | code + tests | PTA-only |
| 4 | `019d8ec` | family-photo upload backend | E | package.json (+sharp), 2 household-photo routes + tests, household-photo.ts (new) + test | code + tests + 1 dependency line | Mostly PTA-only; package.json additive only |
| 5 | `7fa0b7f` | mobile family-photo interface | F | dashboard.tsx (+1 button), mobile-api.ts (+functions), pta-family-photo.tsx (new) + test, mobile bridge route + test | code + tests | Mixed: shared files touched additively only; new screens PTA-only |
| 6 | `8fc0216` | Phase G investigation | G | 1 new doc | documentation only | PTA-only |
| 7 | `7e9e625` | shared action-color tokens + button components | H | 1 new doc, attendance-scan.tsx (non-PTA, 1 color line), pta-family-photo.tsx, action-buttons.tsx (new) + test, theme.ts | code + tests + docs | Most shared-core-touching commit of the build pass |
| 8 | `6c7d99d` | Apple 5.1.1(iv) correction | I | app.json, attendance-scan.tsx (non-PTA) + new test | code + tests | Entirely shared-core, non-PTA |
| 9 | `589aba0` | Phase J report | J | 2 new docs | documentation only | N/A |
| 10 | `5aeb980` | **review fix:** SAVEPOINT-isolated per-record commit failures | R4 | student-progression.ts, its test | code + tests | PTA-only |
| 11 | `af3fa60` | **review fix:** warn before committing unresolved (NEEDS_REVIEW) students | R4 | PtaStudentProgressionCenter.tsx | code (no test — see note below) | PTA-only |
| 12 | `278af06` | **review fix:** cross-check sharp's decode format against magic bytes | R5 | household-photo.ts | code | PTA-only |
| 13 | `a8182b4` | **review fix:** stop requesting unnecessary media-library permission | R6 | pta-family-photo.tsx (+test), report-payment.tsx (+test) — the latter pre-existing, not part of the original build pass | code + tests | Mixed: one PTA file, one pre-existing shared payment-adjacent file (picker function only) |
| 14 | `b82bf2b` | **review fix:** handle native camera/library-picker failure | R6 | pta-family-photo.tsx, its test | code + tests | PTA-only |

**Phase-to-commit mapping notes:** Phase A produced no commit (discovery
only). Phases G and J are documentation-only commits — G because the
investigation found the directive's premise didn't match reality (see Part
7), J because it's the original build pass's closing report. Commits 10–14
are new, from the independent review pass that produced this report; each
corrects one distinct, verified defect and is its own commit, per the
review's own instruction not to combine unrelated corrections.

**No dedicated test for commit 11:** `civicflow-portal` has zero `.tsx`
component tests anywhere in the repository and `@testing-library/react` is
not a dependency (confirmed by checking `PtaTransitionCenter.tsx`, the
component `PtaStudentProgressionCenter.tsx` already mirrors, and the whole
`src/components` tree) — introducing a new test framework for one UI
banner/string fix was judged out of proportion to the change.

**Verified clean of:** credentials/secrets, production data, test-database
copies, uploaded family photos, build artifacts, temporary logs, unrelated
formatting, and any change to authentication, payments, subscription
billing, or Stripe Connect. The full 14-commit diff (49 → 55 files across
all commits) was grepped for secret-like patterns (AWS keys, `sk_live`/
`sk_test`, private-key headers, inline passwords/API keys) with zero
matches, and for binary files with zero matches. The `schema.prisma` diff's
apparent `-`/`+` line pairs were individually inspected and confirmed to be
column-realignment artifacts from Prisma's formatter (identical relation
lines re-emitted, not real removals) — every schema change is additive.

## Part 2 — Test-count reconciliation

The build pass's own final report cited three different-looking numbers.
Investigated and reconciled:

- **"4,571 passed / 178 skipped"** (background task `bjjqxth8y`, file
  `phased-full-suite.json`) ran at commit `f8fb39a` (Phase D) — the file's
  mtime (`Sep 2 21:01`) matches that commit's authored timestamp
  (`21:01:32`) exactly. This was captured **before** Phases E, F, H, and I
  added their own new test files, which is the entire explanation for the
  lower count. Not an error, a different point in the branch's history.
- **"412 files / 4,620 tests" (portal) and "70 suites / 393 tests"
  (mobile)** were the build pass's own final figures, current as of its
  last commit (`589aba0`).
- **This report's authoritative numbers**, freshly re-run at the review's
  final HEAD (`b82bf2b`) rather than recalled from memory:

| Repo | Command | Commit | Started (UTC) | Files/Suites | Passed | Failed | Skipped | Total | Exit |
|---|---|---|---|---|---|---|---|---|---|
| civicflow-portal | `npx vitest run --reporter=json` | `b82bf2b` | 2026-09-03T02:37:49Z | 443 (412 clean + 31 w/ skips) | 4621 | 0 | 178 | 4799 | 0 |
| civicflow-mobile | `npx jest --json` | `b82bf2b` | 2026-09-03T02:38:35Z | 70 | 396 | 0 | 0 | 396 | 0 |

Both runs are unit/route-level (mocked Prisma / mocked native modules) —
neither includes live-database or on-device coverage; those are reported
separately in Parts 4 and 6 below. No test was weakened, skipped, or marked
pending to make a number pass during either the build or review pass.

## Part 3 — Repository state and background processes

- Active branch confirmed via `git status` / `git rev-parse --abbrev-ref
  HEAD`: `feature/pta-progression-mobile-ui-build26`.
- Base confirmed via `git merge-base main HEAD` = `db73f2a`, and
  `git merge-base --is-ancestor db73f2a HEAD` = true.
- Background processes identified before touching anything: two Postgres
  clusters were running — a Windows-service-managed instance on port 5432
  (pre-existing, unrelated, not started by this work) and a disposable dev
  cluster on port 5433 (`C:\pgdata-civicflow-dev`, postmaster PID
  confirmed via its own `postmaster.pid` file), which this program itself
  started earlier for local verification and deliberately left running as
  a standing local dev resource, as documented in the build pass's own
  report. No process was terminated; ownership and purpose were confirmed
  for both before concluding neither needed action. No `node.exe` /
  lingering dev-server process was found.

## Part 4 — PTA student/family progression: review findings and corrections

Full code-level review of the migration, service, permission model, admin
UI, and tests, re-verified against a live database (see below), turned up
two real, previously-unverified defects — both fixed, both re-verified,
both committed separately (commits 10 and 11 above).

**Defect 1 (real, verified, fixed) — a single student's commit conflict
could silently roll back an entire batch's progression.**
`commitProgressionBatch`'s per-record `try/catch` was written to mark one
student `FAILED` and keep processing the rest of the batch, but this could
never work as written: Postgres aborts the *entire* surrounding
transaction after any error, even one caught in application code, and
Prisma's interactive `$transaction()` does not auto-savepoint each query.
The catch block's own "mark this record FAILED" recovery write would
itself throw against the now-poisoned transaction, uncaught — aborting the
whole commit. Verified empirically (a minimal reproduction against the
disposable dev Postgres confirmed the poisoned-transaction failure, and
that wrapping each record in a real `SAVEPOINT`/`ROLLBACK TO SAVEPOINT`
fixes it), then re-verified end-to-end against the real
`commitProgressionBatch` function with a live seeded database and a
genuine `@@unique([studentId, schoolYear])` conflict: the conflicting
student failed cleanly with the real Postgres error recorded, the other
student in the same batch was promoted normally, and the batch still
reached `COMMITTED`. Fixed by wrapping each record's processing in its own
`SAVEPOINT`. New regression test added; both existing and new tests
(29 total) pass.

**Defect 2 (real, verified, fixed) — no warning before committing while
students remain unresolved.** `NEEDS_REVIEW` records are silently marked
`SKIPPED` at commit time — no target-year enrollment at all unless
corrected afterward one at a time. The admin UI's commit button and
confirm dialog said nothing about this, so an officer could commit a
whole year's rollover without noticing some students were about to be
dropped rather than promoted. Fixed with a visible warning banner and an
updated confirm-dialog message naming the count. No server-side behavior
changed — this only surfaces an existing, correct server decision before
the point of no return.

**Checklist verified (code-level, cross-referenced against the actual
files, not assumed):**
- Student (not household) is the progression unit; siblings get
  independent `PtaStudentProgressionRecord` rows and can progress
  differently in the same commit (dedicated test: "handles two students
  from one family progressing differently").
- Source-year `PtaStudentEnrollment` rows are never mutated or deleted —
  only new target-year rows are created; corrections/rollback deactivate
  (`status: INACTIVE`), never hard-delete.
- Families/guardians are never touched: grepped the whole module for
  `PtaHousehold`/`PtaHouseholdAdult` writes — zero.
- Grade promotion is automatic (`PtaGrade.sortOrder`); classroom
  assignment strictly requires an admin-configured mapping or becomes
  `NEEDS_REVIEW` — never guessed.
- All eight outcomes (`PROMOTE`, `RETAIN`, `GRADUATE`, `TRANSFER`,
  `WITHDRAW`, `EXCLUDE`, `MANUAL`, `NEEDS_REVIEW`) have dedicated handling
  in `commitProgressionBatch`, each covered by at least one test.
- Preview writes only `PLANNED` records, zero `PtaStudentEnrollment`
  writes.
- Commit requires `status === "PREVIEWED"` and an exact `previewedAt`
  match (`PTA_PROGRESSION_BATCH_STALE_PREVIEW` otherwise) — verified via
  dedicated test.
- Commit is transactional (now correctly, per Defect 1's fix).
- **Idempotency:** DB level via `@@unique([organizationId,
  fromSchoolYearId, toSchoolYearId])` (batch) and `@@unique([batchId,
  studentId])` (record); service level via a required `idempotencyKey`
  that safely replays an already-`COMMITTED` batch's result rather than
  re-applying, and rejects a *different* key against an already-committed
  batch (both paths tested).
- **Concurrent commit attempts cannot promote a student twice:** the
  underlying `@@unique([studentId, schoolYear])` constraint on
  `PtaStudentEnrollment` makes a duplicate enrollment structurally
  impossible regardless of request timing; Defect 1's fix additionally
  ensures the losing side of a race fails as one cleanly-recorded `FAILED`
  record instead of an opaque whole-transaction abort.
- **Cross-organization IDs are rejected:** every route resolves
  `organizationId` exclusively from `requirePtaAccess()`'s server-side
  session resolution, never from the request body/query; every service
  function re-scopes every lookup (`batchId`, `studentId`, classroom/grade
  IDs) by that same `organizationId`, so a client-supplied ID belonging to
  another org simply resolves to "not found," never leaks data.
- **RBAC, precisely mapped:** `PTA_STUDENT_PROGRESSION_PREVIEW` is granted
  to `STAFF`, `ORG_ADMIN`, and `ORG_OWNER`; `PTA_STUDENT_PROGRESSION_COMMIT`
  only to `ORG_ADMIN` and `ORG_OWNER` (verified by mapping all 5
  occurrences in `rbac.ts` to their exact containing role arrays). A PTA
  household adult (ordinary family member) holds no `OrganizationMembership`
  at all and therefore cannot reach any tier of this permission by
  construction.
- Source-year volunteer hours, dues, buyouts, and payment reports are
  never read or written anywhere in this module except one narrow,
  explicitly-documented read (`PtaVolunteerLedgerEntry`, for the rollback
  dependent-activity check) — grepped for every related model name with
  zero other matches.
- Every mutating function calls `createAuditEvent` with organization,
  actor, action, entity, and outcome metadata.
- Feature access requires the platform kill-switch
  (`isPtaStudentProgressionPlatformEnabled`, unset = false) *and* the
  per-org `PtaProfile.studentProgressionEnabled` flag (schema default
  `false`) *and* `requirePtaAccess`'s own `requirePtaVertical` check —
  confirmed both flags default off and both are checked in
  `assertProgressionEnabled` before any read.

**Live-database migration verification (re-verified this pass, using the
disposable local Postgres cluster):**
- **Empty case:** a fresh throwaway database, `prisma migrate deploy` —
  all 124 migrations in the project's history (including this program's)
  applied cleanly from nothing.
- **Populated case:** a full copy of the real `civicflow_dev` database (a
  non-empty database with real rows across Organization, Meeting,
  PtaCommittee, PtaVolunteerHourEntry, DuesCharge, PaymentReport, etc.),
  found 3 migrations behind, `prisma migrate deploy` applied all 3 cleanly
  with zero errors. Verified afterward: the new tables/columns/enum value
  exist with correct types and defaults, and every pre-existing row was
  unaffected.
- Both throwaway databases were dropped immediately after; the real
  `civicflow_dev` was only ever copied from, never written to.
- **Additive and non-destructive, confirmed from the SQL itself:** the one
  `NOT NULL DEFAULT` column addition (`PtaProfile.studentProgressionEnabled
  BOOLEAN NOT NULL DEFAULT false`) uses a constant default, which Postgres
  11+ applies as a metadata-only operation (no table rewrite); the other
  column addition (`PtaHousehold.photoUrl`) is nullable with no default;
  the enum-value addition (`AttachmentEntityType.PTA_HOUSEHOLD`) is
  metadata-only and doesn't appear in the same migration as any usage of
  that value, avoiding the one real transactional restriction Postgres
  places on enum additions.
- **Indexes/constraints:** every table the migration adds has an
  `organizationId` index at minimum; `PtaStudentProgressionBatch` also has
  a composite `(organizationId, status)` index and the year-pair
  uniqueness constraint; `PtaStudentProgressionRecord` has a `(batchId,
  outcome)` composite index, a `studentId` index, and the per-student
  uniqueness constraint.
- **Compatible with the currently-released mobile client:** this feature
  has no mobile surface at all (web-only admin UI, confirmed — no
  `/api/mobile/*` route references it), so the currently-shipping mobile
  build has no code path that would ever query these new tables/columns;
  an additive migration is trivially invisible to it.

## Part 5 — Family-photo security: review findings and corrections

Full audit of every upload/retrieval/replacement/deletion path. One real
defect found and fixed (commit 12); one real, honest UI-surface gap found
and documented rather than built under review scope (see below).

**Defect 3 (real, verified, fixed) — the actual decode result was never
cross-checked against the magic-byte detection.** `uploadHouseholdPhoto`
already compared declared MIME vs. magic bytes, but never checked that
`sharp`'s own decode (`metadata.format`) agreed with either — only two of
the three signals the review calls for ("declared MIME, magic bytes, and
actual decode results must agree") were cross-checked. Verified directly
(`sharp().metadata().format` returns exactly `'jpeg'`/`'png'`/`'webp'`/
`'heif'` for real files of each accepted type) and added the third
comparison. No dedicated adversarial test: constructing a real file whose
magic bytes and libvips's own decode disagree is impractical to engineer
reliably, and this is deliberate defense-in-depth for a narrow gap, not
proof a live exploit exists — the re-encode-from-scratch pipeline already
neutralizes most polyglot-smuggling concerns regardless, since the stored
bytes are never the client's original ones. All 18 existing tests (real
`sharp` fixtures, unchanged) still pass.

**Checklist verified:**
- Auth (`requirePtaHouseholdSelfAccess()` / `requirePtaAccess("pta:
  households:manage")`) runs before any multipart parsing on every route;
  `Content-Length` checked before parsing, `Content-Type` checked before
  parsing, `formData()` wrapped in `try/catch`.
- Household ownership/tenant scope enforced server-side: the parent route
  never accepts a client-supplied household ID at all (resolved from the
  caller's own `PtaHouseholdAdult` link); the officer route re-scopes by
  `organizationId` on every lookup.
- Declared size checked before parsing (`Content-Length`); actual buffer
  size checked after (`input.buffer.length`); decompression-bomb guard via
  `sharp`'s `limitInputPixels` on the decoded pixel count.
- File extension is never trusted — only magic bytes, declared MIME, and
  (as of Defect 3's fix) the actual decode format are used, and all three
  must agree.
- Full `sharp` decode; corrupt/malformed files throw and are rejected
  before ever reaching storage.
- Re-encoded as JPEG; `.rotate()` (no args) auto-applies EXIF orientation
  then the tag is gone; `.withMetadata()` is never called, so EXIF/GPS/
  ICC/IPTC are stripped by construction, not as a separate forgettable
  step.
- Storage objects are private: `uploadBufferToSpaces` sets `ACL: "private"`
  (verified directly in `storage.ts`).
- Retrieval requires either self-linkage or `pta:directory:read`, and
  issues a 300-second signed URL — never a raw client-supplied object key
  (the client never sees or supplies one; it's always resolved server-side
  from the org-scoped `Attachment` row).
- Failed replacement preserves the existing photo (new object uploaded and
  the `Attachment` row committed before the old object is deleted;
  verified by a dedicated test asserting call order).
- Successful replacement soft-deletes the old `Attachment` row and
  best-effort deletes the old storage object.
- Deletion: storage object is hard-deleted immediately
  (`deleteObjectFromSpaces`, not deferred); the `Attachment` database row
  is soft-deleted (`deletedAt` set) and retained indefinitely — no
  purge/retention job exists anywhere in this codebase for `Attachment`
  rows generally (confirmed: no worker/cron references one), matching this
  codebase's existing convention of never hard-deleting audit-relevant
  records. This is the actual, honest retention behavior — not something
  this program invented, and no separate "documented retention policy"
  exists to point to beyond that convention.
- **Abandoned uploads:** `uploadBufferToSpaces` is called before
  `prisma.attachment.create` — a DB failure after a successful S3 write
  could orphan a storage object. Confirmed this exact ordering is the
  **pre-existing, established pattern** in the generic `/api/attachments`
  upload route used across every other entity type in this codebase, not
  something newly introduced here. No lifecycle/purge policy for orphaned
  objects exists anywhere in the codebase. Documented as a real, honest,
  pre-existing, out-of-scope gap — not silently ignored, not falsely
  claimed as solved, and not something this review's scope extends to
  fixing across the whole attachment system.
- Never logs image bytes, signed URLs, credentials, or metadata: grepped
  every family-photo file for `console.` — zero matches; audit metadata
  is limited to `{attachmentId, byteSize, width, height}`.
- Family photos remain optional everywhere: no other feature reads
  `PtaHousehold.photoUrl`.
- Adult family members can manage only their own household's photo
  (self-linkage resolved server-side); students have no login/identity
  concept in this system at all, so "students cannot change it" is true
  by construction, not by an added check.
- Administrators were not granted new authority: the officer route reuses
  the pre-existing `pta:households:manage` permission, already used for
  every other household edit.
- Not exposed outside PTA: grepped the whole repository for `photoUrl`
  outside PTA-namespaced files — zero matches.

**Real, honest gap found and documented (not fixed in this pass): no
officer-facing UI surface exists for viewing/managing a family photo.**
The backend correctly and securely supports it — the dual-audience GET
route (`households/[householdId]/photo`) already accepts either an
officer with `pta:directory:read` or the household's own linked parent —
but grepping every web and mobile officer-facing PTA household screen for
`photoUrl` found zero references. Officers can technically upload/delete
via the backend route directly, but no screen exposes a button, thumbnail,
or any entry point to do so. Building this is a genuine new UI feature
(comparable in scope to a new sub-phase), not a defect correction, so it
was documented rather than built under this review's "correct defects"
scope. **This is a real gap the human owner should weigh before treating
the family-photo feature as complete for officers** — parent self-service
is fully built and working end-to-end; officer-side photo management is
backend-only today. **Still true after Part 13's completion pass below:**
that pass addressed a separate, parent-facing discoverability gap (a
proper "My Family" home, rather than a bare dashboard shortcut) — it
touched no officer-facing screen and does not narrow this gap.

## Part 6 — Apple Guideline 5.1.1(iv): review findings and corrections

Full repository search for directive pre-permission wording (`grep -rniE
"grant (camera|photo|access)|allow (camera|photo|access)|enable camera|you
must allow"`) found exactly four matches, all expected and benign: two are
code comments documenting the historical wording being corrected, two are
the banned-phrase constants inside the regression tests themselves. Zero
matches in actual rendered UI copy.

Inventoried every screen touching camera/photo-library APIs
(`expo-camera`, `expo-image-picker`) — three total, not two:
`attendance-scan.tsx`, `pta-family-photo.tsx`, and a third,
**previously-unreviewed, pre-existing screen: `report-payment.tsx`**
(its optional receipt-photo attachment).

**Defect 4 (real, verified, fixed, in two files) — unnecessary
photo-library permission requested before the library picker.**
`expo-image-picker`'s own doc comment for `launchImageLibraryAsync`:
"Requires `Permissions.MEDIA_LIBRARY` on iOS 10 only." On every iOS
version this app actually supports, and on Android (whose plugin config
never requests a storage/media-library runtime permission either), the
system picker runs out-of-process (PHPicker on iOS) and hands back only
the chosen file — no broad library grant is needed. Both
`pta-family-photo.tsx`'s "Choose from Library" path and
`report-payment.tsx`'s receipt-photo picker called
`requestMediaLibraryPermissionsAsync()` first anyway. Fixed in both: the
library picker now launches directly. The camera path in
`pta-family-photo.tsx` is unaffected — `launchCameraAsync`'s doc comment
confirms `Permissions.CAMERA` is required unconditionally (no
iOS-version carve-out), so the neutral priming/blocked flow from the
5.1.1(iv) correction stays exactly as built. `report-payment.tsx`'s
payment submission logic, validation, and every other field were not
touched — only the picker function. Two new regression tests added
(one per screen).

**Defect 5 (real, verified, fixed) — a native picker failure could leave
the screen silently stuck.** `launchPicker` in `pta-family-photo.tsx`
called `launchCameraAsync`/`launchImageLibraryAsync` with no `try/catch`.
A normal cancellation resolves with `canceled: true` (already handled),
but a genuine native-level failure (no camera hardware, or any other
rejection) was an unhandled promise rejection — the screen would stay on
its current stage indefinitely with no feedback. Fixed with a `try/catch`
that shows a plain, visible error and returns to a usable idle state,
matching the same recoverable-error pattern already used elsewhere in the
same file. New regression test simulates a rejection and asserts the
screen recovers.

**Checklist verified:**
- Camera permission is only ever requested after the user taps "Take
  Photo" — never at launch, sign-in, registration, or ordinary profile
  viewing (confirmed: no permission call exists outside these three
  screens' own explicit user-initiated action handlers).
- "Not Now" never triggers the native prompt (dedicated test).
- Denying camera access does not block anything else in the app — the
  family-photo screen remains fully usable for viewing/removing an
  existing photo, and every other screen is structurally unrelated.
- "Open Settings" now genuinely calls `Linking.openSettings()` in both
  `attendance-scan.tsx` (fixed in the original build pass, Phase I — the
  previous version's button was labeled "Open Settings" but its `onPress`
  was still the no-op `requestPermission`) and `pta-family-photo.tsx`
  (already correct since Phase F), and only appears once `canAskAgain` is
  `false`.
- Granted / denied-can-reask / denied-blocked are all covered by dedicated
  tests for both screens; "unavailable" (Defect 5) is now handled too.
  Simulator-specific behavior cannot be verified without a physical
  device or configured simulator (see Part 8).
- The system picker is used for library selection (PHPicker via
  `launchImageLibraryAsync`), and as of Defect 4's fix, no library
  permission is requested at all.
- No permission is requested at launch/registration/sign-in/profile
  viewing.
- `app.json`'s `NSCameraUsageDescription`/`NSPhotoLibraryUsageDescription`
  strings (via the `expo-camera`/`expo-image-picker` plugin config) were
  updated in the original build pass to describe every real use of each
  permission (QR scan + family photo; receipt photo + family photo);
  `expo-image-picker`'s own plugin independently writes
  `NSCameraUsageDescription` too, so its `cameraPermission` string was set
  explicitly to the identical text, removing any dependence on plugin
  execution order for which description ships in the actual binary.
- Android: the plugin config manages only `CAMERA` and `RECORD_AUDIO`
  permissions; it was never asked to manage a storage/media-library
  permission, consistent with the picker needing none.
- No committed native `Info.plist`/`AndroidManifest.xml` exists to
  diverge from `app.json` — this is a managed Expo workflow with no
  committed `ios/` directory; a local, gitignored `android/` build
  directory exists from a prior local build and would regenerate fresh
  from `app.json` on the next real build.

## Part 7 — Volunteer-shift QR: scope confirmation

Re-verified, not re-investigated (the original build pass's Phase G
already reached this conclusion; this pass confirms nothing has drifted):

- **Existing scanner identity gating is correct, not a bug:**
  `attendance-scan.tsx`'s member-identity gate is deliberate — check-in is
  recorded against an `OrgMember`, which PTA household adults structurally
  never have. The existing volunteer roster check-in flow
  (`volunteer-checkin.tsx` and its backend) was independently re-confirmed
  correctly PTA-scoped throughout (`PERMISSIONS.PTA_VOLUNTEERS_CHECKIN`,
  `selectedOrganization.pta.canCheckIn` — never a generic member check);
  its test suite (4 tests) still passes unchanged.
- **No incomplete QR infrastructure exists anywhere on this branch:**
  grepped the *entire* 14-commit diff for QR-token-shaped code additions —
  the only two matches are a jest mock referencing the pre-existing
  `checkInWithQrToken` function (from this review's new
  `attendance-scan.test.tsx`) and a comparison-only comment in the
  deferral doc. No new endpoint, UI button, feature flag, schema, or dead
  navigation entry was added.
- Existing meeting/attendance QR behavior is unchanged except its
  permission-screen wording (Part 6); its handling of a scanned code is
  untouched.
- Existing manual volunteer-hour entry remains functional — its test
  suite (53 tests across `volunteers.test.ts`, `volunteers-hours.test.ts`,
  `volunteers-ledger-wiring.test.ts`) passes unchanged.
- No report in this branch's history claims volunteer-shift QR was
  implemented; both this report and the deferral doc state plainly that
  it is not part of Build 26.

**Deferred work** (unchanged from the original Phase G investigation,
`civicflow-portal/docs/pta-volunteer-shift-qr-checkin-deferral.md`):
shift-specific single-use QR tokens, server-authoritative check-in/out,
volunteer-ledger integration, idempotency, expiration and organization
validation, RBAC, manual correction, audit history, and dedicated
security/cross-tenant tests — all still to be designed and built as a
separately-scoped effort before this capability exists in any form.

## Part 8 — Shared UI impact across verticals

Phase H's tokens/components, re-audited:

- Grepped every shared-core file this program touches
  (`attachments.ts`, `env.ts`, `rbac.ts`, `mobile-api.ts`, `dashboard.tsx`,
  `attendance-scan.tsx`, `theme.ts`, `package.json`) for
  `stripe|billing|subscription|payment.*process|auth.*token|password|
  session.*secret` — zero matches in any of them.
- `env.ts`'s pre-existing server-config cache (`let cached`) is untouched
  by this program's diff (confirmed by inspecting the exact diff hunks) —
  it's a process-level, org-agnostic env-var cache, not per-organization
  permission state, so it carries no cross-org leakage risk regardless.
- Cross-vertical regression: the vertical-isolation/entitlement/navigation
  test suites (`vertical-capabilities`, `vertical-terminology`,
  `vertical-navigation`, `vertical-import`,
  `admin-organization-primary-vertical-route`, `attachments-union-case`,
  `portal-layout-billing-exempt-wiring`) — 79 tests total — all pass
  unchanged, alongside the full 4621/396-test suites covering PTA,
  Community, Church, and Union code paths together.
- PTA progression and family-photo controls are confirmed (Parts 4-5) to
  appear nowhere outside PTA-namespaced code.
- `action-buttons.tsx`'s own 7 dedicated tests cover accessibility role,
  explicit-vs-fallback accessibility label, disabled state, and loading
  state directly.
- No file this program touches sets `allowFontScaling={false}` anywhere —
  consistent with this app's existing, unchanged, app-wide convention.
- Existing dashboard/payments/inbox/announcements/events/profile behavior:
  covered by the same full suites; zero related test failures at any
  point across either pass.

## Part 9 — Integration-risk analysis vs. `fix/import-auth-order-and-format-ui`

Read-only; no merge or rebase performed at any point.

- **Zero file overlap:** `comm -12` between the two branches' changed-file
  lists (15 files vs. 55 files, both relative to `db73f2a`) returns
  nothing.
- **`git merge-tree --write-tree`** (a read-only simulation — writes a
  tree object to the object database only, touches no ref, no index, no
  working-tree file, creates no commit) run in both directions, exit code
  0 both times, no conflict output.
- **No `package-lock.json` risk:** neither branch touches it; only Build
  26 touches `package.json` (adding `sharp`, already present transitively).
- **No migration-order risk:** the import-security branch touches zero
  files under `prisma/migrations/`.
- **No auth-before-parse regression risk:** the family-photo routes are
  structurally disjoint from the import routes and were independently
  re-verified (Part 5) to follow the identical auth-before-parse
  discipline the import branch established.
- **Recommended sequence: merge `fix/import-auth-order-and-format-ui`
  first, then `feature/pta-progression-mobile-ui-build26` second.** Order
  doesn't affect conflict risk (there is none), but the import branch is
  smaller, security-focused, already has an open PR, and ships no new
  user-facing surface — landing it first gets the security fix into
  `main` sooner without waiting on the larger, flag-gated feature branch.

## Part 10 — Local build-readiness results

| Check | Command | Result |
|---|---|---|
| Portal typecheck | `npx tsc --noEmit -p tsconfig.json` | Clean |
| Mobile typecheck | `npx tsc --noEmit` | Clean |
| Portal lint | `npx eslint <touched files>` | Clean |
| Mobile lint | `npx expo lint` | Clean (2 pre-existing warnings, unrelated file) |
| Portal unit/route/RBAC tests | `npx vitest run` | 412 files / 4621 tests passed, 0 failed |
| Mobile unit/component tests | `npx jest` | 70 suites / 396 tests passed, 0 failed |
| Migration tests | `prisma migrate deploy` ×2 (empty + populated) | Both clean, 0 errors |
| `npm audit` (portal, production deps) | `npm audit --omit=dev` | 31 pre-existing transitive advisories (via `@sentry/webpack-plugin`, `exceljs`'s `uuid`/`undici`), none newly introduced, none tracing through the new `sharp` dependency |
| Dependency-health baseline | `npm run check:deps` | OK — `sharp`'s native-binary variants and pre-existing baseline mismatches all recognized |
| Production portal build | `npm run build` | Exit 0, zero errors or warnings in the full build log |
| Mobile bundle export | `npx expo export --platform ios` | Metro bundled all 1212 modules cleanly, zero errors |
| Mobile project health | `npx expo-doctor` | 17/18 checks pass; the one failure (expo/expo-constants/jest-expo one patch version behind) is confirmed pre-existing — `civicflow-mobile/package.json` has zero diff anywhere in this branch |

No EAS Build, TestFlight, Play Console, App Store Connect, or any
artifact-uploading command was invoked at any point.

## Part 11 — Device-verification checklist (for the later, separately-authorized phase)

No physical device, iOS Simulator, or Android emulator is available in
this environment (Windows, no Mac, no configured emulator) — this remains
unperformed and is not claimed to have happened. The exact checklist for
that phase, using **synthetic data only**:

**Install**
- [ ] Fresh install, iOS
- [ ] Fresh install, Android
- [ ] Upgrade from a prior build, iOS
- [ ] Upgrade from a prior build, Android

**Identity coverage** (each walked through on both platforms)
- [ ] PTA administrator (`ORG_ADMIN`/`ORG_OWNER`) — full progression
      preview → classroom mapping → exceptions → commit → correction →
      rollback cycle
- [ ] Ordinary PTA family member (household adult, no `OrganizationMembership`)
      — confirm zero access to any progression screen/route
- [ ] Staff-only identity (`STAFF` role, no personal member/household
      identity) — confirm preview-tier access only, commit blocked
- [ ] A family with multiple students — confirm each child's outcome is
      independent in the same batch

**Progression**
- [ ] Progression becomes visible only after both the platform flag and
      the org's `studentProgressionEnabled` flag are turned on
- [ ] A batch with at least one unresolved (`NEEDS_REVIEW`) student shows
      the new warning banner and confirm-dialog wording before commit

**Family photo**
- [ ] Select an existing photo from the library — confirm no permission
      prompt appears at all
- [ ] Take a new photo with the camera — confirm the neutral
      Continue/Not-Now screen appears only after tapping "Take Photo,"
      never before
- [ ] Crop/preview step before upload
- [ ] Upload, replace, and delete, each followed by a refetch confirming
      the change
- [ ] Deny camera permission when prompted — confirm the app doesn't
      crash and the rest of the screen stays usable
- [ ] Deny twice (or deny once, background/foreground, deny again) to
      reach the OS-blocked state, then tap "Open Settings" — confirm it
      genuinely opens the system Settings app, not a no-op
- [ ] Visually confirm no directive permission language appears anywhere
      in either flow ("Grant," "Allow Access," "Enable Camera," "You Must
      Allow")
- [ ] Confirm the library-picker flow never shows the native
      "Unestra Would Like to Access Your Photos" system prompt at all

**Cross-vertical**
- [ ] All four verticals (PTA, Community/Nonprofit, Church, Union) open
      correctly and show no PTA-progression or family-photo UI
- [ ] Existing payments, inbox, announcements, events, and profile screens
      behave exactly as before this program, on all four verticals

## Part 12 — Confirmations

- No merge, push, deployment, external build, artifact upload, or store
  submission occurred at any point across the build pass, the review pass,
  or the Part 13 completion pass below.
- `983c8e2` and `e92ffd7` on `fix/import-auth-order-and-format-ui` remain
  unchanged — re-verified at the start and end of the review pass and
  again at the end of the Part 13 completion pass, by exact hash
  comparison each time.
- `main` remains at `db73f2a`, untouched.

## Part 13 — Completion pass: user-facing family-photo entry point

A separate, narrowly-scoped pass following the review above. Its target
was distinct from Part 5's documented officer-facing gap: parents already
had a *working* family-photo flow (`pta-family-photo.tsx`, built in Phase
F), but its only entry point was a flat "Family Photo" quick-action button
on the dashboard, with no household/family framing around it. This pass
added that framing without touching the photo pipeline itself.

**What was built:**
- `src/app/pta-my-family.tsx` (new) — a "My Family" home screen containing
  one card, "Family Photo," which shows the current photo (or a
  placeholder — the household name's first letter, or a generic family
  glyph if no name is available) and an "Add Family Photo" / "Edit Family
  Photo" button. The button navigates to the existing, entirely unchanged
  `pta-family-photo.tsx` for the actual take/choose/preview/upload/
  replace/remove/cancel flow — **no second implementation was created.**
- `src/app/(tabs)/dashboard.tsx` (modified) — the "Family Photo" quick
  action now reads "My Family" and routes to `/pta-my-family` instead of
  straight into the photo picker; this is the only dashboard change.
- Data refresh: `useFocusEffect` re-fetches the household photo every time
  the screen regains focus (initial mount and every return trip from
  photo management), so an upload, replace, removal, or org switch is
  reflected immediately on return with no app restart.
- Upload controls live only on this household-level card, never on a
  student card — this screen renders no student list at all.

**Authorization and vertical isolation (server-side remains the only real
boundary — hiding the button is not a security control):**
- The screen's client-side `hasPtaIdentity` check only decides whether to
  render vs. redirect for UX purposes. The actual data call
  (`getPtaHouseholdPhoto`) is authorized entirely server-side by the
  pre-existing, untouched `requirePtaHouseholdSelfAccess()` /
  `requireMobilePtaHouseholdAccess()` — re-confirmed unchanged (zero
  backend files touched this pass) and re-verified passing via the same 47
  backend family-photo tests re-run in Part 13's verification matrix
  below.
- The screen never reads, stores, or sends a household/family ID from
  anywhere but the caller's own server-resolved session — its one API call
  takes only the active `organizationId`; there is no `householdId`
  parameter anywhere in the file. A dedicated test asserts the call
  receives exactly one argument.
- An account with no PTA household link (staff-only identity, or a member
  of a different vertical) is redirected to `/dashboard` before any photo
  data is requested — verified by a dedicated test asserting
  `getPtaHouseholdPhoto` is never called in that case, and confirming
  direct navigation to `/pta-my-family` is not a bypass.
- An org switch clears any stale photo: re-rendering with a different
  `organizationId` and triggering a fresh focus event shows the new org's
  data (or its placeholder), never the previous org's photo — dedicated
  test.
- Non-PTA verticals never see this entry point: the Church and Union
  dashboard test suites (10 tests, re-run this pass, all passing) confirm
  neither vertical's dashboard renders "My Family" or the prior "Family
  Photo" button — the same `hasPtaIdentity` gate as before controls it.
- Signed-out access redirects to `/login` with `redirectTo=/pta-my-family`,
  matching this app's existing auth-gating convention.

**Apple-compliant permission behavior — unchanged, reused, not
re-implemented:** `pta-my-family.tsx` imports no camera/photo-library API
at all (`expo-camera`, `expo-image-picker` do not appear in the file).
Opening the screen — including viewing an existing photo — never triggers
a permission prompt; a dedicated test asserts the only network call made
on open is the read-only photo fetch. The neutral Continue/Not-Now
priming flow, the "Open Settings" deep link, and the unnecessary-
media-library-permission fix all live untouched in `pta-family-photo.tsx`
(zero diff this pass) and remain covered by that file's own 13-test suite,
re-run and passing.

**New tests (16, all passing):** `src/app/__tests__/pta-my-family.test.tsx`
covers entry-point display states (photo vs. placeholder vs. household
name), navigation to the existing management screen from both button
labels, refresh-on-regaining-focus (upload, replace, removal, and
org-switch — four dedicated cases), authorization (authorized access,
unauthorized redirect, signed-out redirect, no client-suppliable ID),
no-permission-prompt-on-viewing, and accessibility (role/label/hint on the
action button, and that the placeholder/photo are never icon-only).
Deliberately not re-tested here: cancel/upload-failure handling, picker
rejection, and the permission flow itself — already covered by
`pta-family-photo.test.tsx` and unchanged.

**Verification matrix (fresh commands, this pass, all exit 0):**

| Check | Command | Result |
|---|---|---|
| Backend family-photo tests (4 files: `household-photo.test.ts` + 3 route tests) | `npx vitest run <4 files>` | 47 passed, 0 failed |
| Mobile family-photo + dashboard nav tests | `npx jest pta-family-photo dashboard.test` | 2 files, 17 passed, 0 failed |
| New `pta-my-family` tests | `npx jest pta-my-family` | 1 file, 16 passed, 0 failed |
| Cross-vertical dashboard tests (Church, Union) + org-switcher | `npx jest dashboard org-switcher` | 4 files, 19 passed, 0 failed |
| Full mobile suite (regression) | `npx jest` | 71 suites, 412 passed, 0 failed (was 70/396 before this pass — exactly +1 file / +16 tests) |
| Mobile typecheck | `npx tsc --noEmit` | Clean |
| Lint (changed files) | `npx eslint <3 changed/new files>` | Clean |
| Metro bundle export | `npx expo export --platform ios` | 1213 modules bundled cleanly, exit 0 |

Not run, and not required this pass: portal typecheck, portal production
build, and the import-auth-order regression suite — zero
`civicflow-portal` files were touched (confirmed via `git status`), so
none of these are implicated.

**The five pre-existing untracked items, individually classified** (see
Part 14 below for the full reconciliation of the earlier "four" wording,
hard mtime evidence, and gitignore analysis):

| Path | Type | Predates this pass? | Build-26-related? | Sensitive content? | Should stay untracked? |
|---|---|---|---|---|---|
| `.claude/` | Directory: 2 benign local-tool files (`settings.local.json` — Claude Code permission config; `scheduled_tasks.lock` — this session's own lock file) + 1 flagged file (see below) | Yes | No | **`Application Password WP` (18 bytes, one line) is almost certainly a real WordPress application-password credential from unrelated prior work (the Unestra marketing-site launch). Flagged per instruction; contents were never printed, copied, or included in this report. Not created or modified this pass.** | Yes — must never be committed |
| `civicflow-portal/docs/operations/` | 9 markdown operational runbooks (deployment checklist, incident response, security review, etc.) | Yes | No | None found — grepped for credential-shaped patterns (`key/secret/password/token` followed by a real value); files only discuss these concepts in prose | Yes (no action taken; not this pass's decision to make) |
| `docs/brevo-email-migration-report-2026-07-14.html` | Standalone HTML status report from unrelated prior work | Yes | No | None found (same grep) | Yes |
| `docs/domain-migration-report-2026-07-14.html` | Standalone HTML status report from unrelated prior work | Yes | No | None found (same grep) | Yes |
| `docs/unestra-website-launch-report-2026-07-14.html` | Standalone HTML status report from unrelated prior work | Yes | No | None found (same grep) | Yes |

None of these five items were created, modified, staged, or committed by
this pass or any prior Build 26 pass.

## Part 14 — Untracked-item reconciliation and Community/Nonprofit isolation

A second, narrower verification pass following Part 13. Two open items:
why the untracked-item count read "four" in one place and "five" in
another, and whether Community/Nonprofit organizations — never previously
tested with a demonstrably vertical-tagged fixture — can see or reach the
PTA family-photo feature.

### Four-to-five reconciliation

**Root cause: a plain counting error in the R12 report's own sentence, not
a change in the working tree.** At commit `7ddbca5`, that report's Part 0
read: *"clean except four pre-existing untracked paths present... (`.claude/`,
`civicflow-portal/docs/operations/`, and three unrelated dated HTML report
files under `docs/`)"* — the sentence says "four" but then enumerates
1 + 1 + 3 = 5 items. The Part 13 completion pass (commit `ca1fab1`) already
corrected the headline number to "five" using direct `git status` evidence;
this pass re-confirms that correction with two additional, independent
sources of evidence:

1. **Consistent counting method, applied uniformly:** `git status --short`,
   `git status --porcelain=v1 --untracked-files=all`, and
   `git ls-files --others --exclude-standard` were run and cross-checked —
   all three agree on exactly five untracked-and-not-ignored paths. The
   counting method used throughout this report is "one line in
   `git status --short`'s default (directory-collapsed) output" — under
   that method, `.claude/` and `civicflow-portal/docs/operations/` are each
   one item despite containing multiple files internally, and each of the
   three HTML reports is its own item. This is the same method both the
   R12 and Part 13 reports used; the discrepancy was arithmetic, not a
   difference in counting convention.
2. **Filesystem timestamp evidence, independent of git history:** every
   file underlying all five items — the one flagged `.claude/` file, all
   nine `civicflow-portal/docs/operations/*.md` files, and all three HTML
   reports (13 files total) — shares the identical modification timestamp
   `2026-09-01T01:46:43` (sub-second-identical across all 13, consistent
   with one bulk filesystem event such as a workspace restore, not organic
   creation over time). This predates this branch's first commit
   (`a45d142`, authored `2026-09-02T20:43:48`) by roughly 19 hours —
   independent confirmation that all five items genuinely predate Build 26
   in its entirety, not merely "untracked since some unknown point."

**Not created by any Build 26 tooling — checked explicitly, not assumed:**
- Metro/Expo export: this pass's and Part 13's exports both wrote to a
  scratchpad path outside the repository entirely
  (`/tmp/build26-c7-export`), already deleted; zero export output exists
  inside the repo tree.
- Test execution: this project's Jest config writes no coverage/output
  files into the repo by default; no such directory appears anywhere in
  `git status`.
- Database migration verification (Part 4): performed against entirely
  separate, disposable local Postgres clusters, never touching the working
  tree.
- Documentation generation by this program: Build 26's own docs live under
  `civicflow-mobile/docs/build-26-*.md` — a different path from all five
  untracked items.
- Developer scratchpad or this session specifically: ruled out by the
  mtime evidence above (predates this branch by ~19 hours).
- **Actual origin:** leftover artifacts from unrelated prior work sessions
  — the WordPress credential from an earlier marketing-site launch, and
  the operations docs / HTML reports from separate earlier documentation
  work, consistent with this account's own project history.

**Two additional files exist on disk inside `.claude/` but are correctly
excluded from all five counts and from every `git status` invocation
above** — `.claude/settings.local.json` (Claude Code's own local
permission config) and `.claude/scheduled_tasks.lock` (this session's own
lock file) are both genuinely gitignored: `settings.local.json` via a
`**/.claude/settings.local.json` rule in the user's global git ignore
file, `scheduled_tasks.lock` via a `**/.claude/scheduled_tasks.lock` rule
in this repo's local `.git/info/exclude` (confirmed via
`git check-ignore -v` against each, individually). Neither appears under
`--untracked-files=all` or `ls-files --others --exclude-standard`. By
contrast, **`.claude/Application Password WP` has no ignore rule at all**
— `git check-ignore -v` returns no match for it — meaning it is the one
`.claude/`-directory file that a careless `git add -A` or `git add
.claude/` would actually stage. None of the five counted items (including
this one) are covered by `.gitignore` or any other ignore mechanism.

**Precise wording, used consistently in this report from here on:**
"Tracked working tree clean; five untracked paths remain. All five
predated the Build 26 program by roughly 19 hours (filesystem-timestamp
evidence, independent of git history). None were modified, staged, or
committed by any pass."

### Community/Nonprofit isolation

**Server-side (backend) — already explicitly tested against a demonstrably
COMMUNITY-vertical fixture; nothing was missing here.** Both guards the
family-photo routes depend on already had a dedicated test using
`primaryVertical: "COMMUNITY"`, re-run this pass and confirmed passing,
unchanged:
- `civicflow-portal/src/lib/labs/pta/__tests__/guard.test.ts` →
  *"denies a user whose organization isn't PTA-vertical"* — tests
  `requirePtaHouseholdSelfAccess()` (the guard behind the web
  `/api/labs/pta/my-household/photo` route), asserting rejection with
  `PTA_ORGANIZATION_NOT_PTA_VERTICAL` and that the household lookup
  (`findFirstAdult`) is never even called.
- `civicflow-portal/src/lib/__tests__/mobile-pta-auth.test.ts` →
  *"denies access when the organization's primaryVertical is not PTA (PR
  #40 — no Labs enrollment involved)"* — tests
  `requireMobilePtaHouseholdAccess()` directly, the exact guard the
  mobile app's `/api/mobile/pta/household/photo` route calls. A second
  test, *"throws for a non-PTA organization, even with a real officer
  permission already granted"*, covers the underlying
  `requirePtaVerticalForMobile()` check in isolation.

Both files were re-run this pass: `npx vitest run
src/lib/labs/pta/__tests__/guard.test.ts
src/lib/__tests__/mobile-pta-auth.test.ts` → 2 files, 36 passed, 0 failed,
exit 0. No backend test was added — none was missing.

**Client-side (mobile) — genuinely missing before this pass, now added.**
Prior coverage (`authWith({ householdAdultId: null })` in
`pta-my-family.test.tsx`, and `conventionalMemberOrg()`/`staffOnlyOrg()`
in `dashboard.test.tsx`) only proved "no PTA identity" generically — none
of those fixtures set `capability.primaryVertical`, the field this app's
own vertical-gating logic actually reads elsewhere (`(tabs)/_layout.tsx`,
the org switcher). Per this pass's own standard, that's insufficient to
claim demonstrated Community/Nonprofit isolation. Four new tests, all
using an explicit `capability: { primaryVertical: 'COMMUNITY' }` fixture:

- `dashboard.test.tsx`, describe `Dashboard -- Community/Nonprofit
  isolation for the PTA "My Family" entry point`:
  - *"a Community/Nonprofit organization member never sees the My Family
    entry point, even with a real member record"* — proves a genuine
    `memberId` doesn't upgrade a generic member into a PTA identity.
  - *"switching from a PTA organization to a Community/Nonprofit
    organization removes the My Family entry point and stops PTA data
    fetching"*.
- `pta-my-family.test.tsx`:
  - *"a Community/Nonprofit organization member (demonstrably non-PTA
    vertical) is redirected to /dashboard without any family-photo
    request"* (describe: authorization).
  - describe `PtaMyFamilyScreen -- organization switching (PTA ->
    Community/Nonprofit)` → *"clears the displayed family photo and name,
    redirects away, and never fetches using the new organization id"* —
    proves `load()`'s `!hasPtaIdentity` guard no-ops regardless of the new
    organization's id, so no request is ever made with it.

PTA progression controls: confirmed absent by construction, not by a
mobile UI test — this feature has no mobile surface at all (web-only,
portal-admin; grepped `civicflow-mobile/src` for `progression`, zero
matches), so there is nothing to assert against on this platform.

**No isolation defect was found.** All four new tests, and both
pre-existing backend tests, passed on first run with zero production-code
changes — this was a coverage-completion pass, confirming behavior that
already worked (the client-side `hasPtaIdentity` gate and the server-side
vertical guards were already correct), not a fix for a real gap in
behavior.

### Verification (this pass, fresh commands, all exit 0)

| Check | Command | Result |
|---|---|---|
| `pta-my-family` + `dashboard.test` (targeted) | `npx jest pta-my-family "dashboard.test"` | 2 files, 24 passed, 0 failed |
| Backend PTA guard + mobile-pta-auth (Community fixture) | `npx vitest run src/lib/labs/pta/__tests__/guard.test.ts src/lib/__tests__/mobile-pta-auth.test.ts` | 2 files, 36 passed, 0 failed |
| Org-switcher | `npx jest org-switcher` | 1 file, 4 passed, 0 failed |
| Full mobile suite (regression) | `npx jest` | 71 suites, 416 passed, 0 failed (was 71/412 before this pass — exactly +4 tests, 0 new files) |
| Mobile typecheck | `npx tsc --noEmit` | Clean |
| Lint (changed files) | `npx eslint <2 test files>` | Clean |

**Metro export not re-run this pass, deliberately:** only test files
(`dashboard.test.tsx`, `pta-my-family.test.tsx`) and this documentation
changed — zero application/production code. A bundle re-verification adds
no information when nothing bundled could have changed; Part 13's export
(1213 modules, exit 0) still reflects the current production code exactly.
Portal typecheck, portal production build, and the import-auth-order
regression suite remain not required for the same reason as Part 13 —
zero `civicflow-portal` production files changed (only two portal test
files were *read*, not modified, to confirm existing coverage).

### Vertical-coverage matrix, all four considered

| Vertical | My Family entry point visible? | Direct navigation | Server-side guard |
|---|---|---|---|
| PTA/PTO | Yes, when `pta.householdAdultId` is set | Renders normally | `requirePtaHouseholdSelfAccess` / `requireMobilePtaHouseholdAccess` grant |
| Community/Nonprofit | No (new tests, this pass) | Redirects to `/dashboard`, no request made (new tests, this pass) | Rejects with `PTA_ORGANIZATION_NOT_PTA_VERTICAL` / "PTA is not available for this organization" (pre-existing tests, re-confirmed) |
| Church | No (`dashboard-church.test.tsx`, unchanged, re-run in Part 13) | Not separately re-tested this pass — same `hasPtaIdentity`/vertical-guard mechanism as Community, no vertical-specific branching exists in either the screen or the guards | Same guards as above — vertical-agnostic beyond the single `primaryVertical === "PTA"` check |
| Union | No (`dashboard-union.test.tsx`, unchanged, re-run in Part 13) | Same as Church | Same as Church |

HOA is a fifth `OrganizationVertical` enum value with no PTA-identity
concept at all (structurally cannot hold a `PtaHouseholdAdult` link); it
was not separately re-tested here as it was never part of this program's
named four-vertical scope (PTA, Community, Church, Union — see Part 8/11).

## Part 15 — Credential-containment review: `.claude/Application Password WP`

A narrowly scoped review, separate from Build 26's own functionality,
prompted by the flagged file first noted in Part 13. **No credential value,
username, or site address is reproduced anywhere in this section or was at
any point printed, logged, staged, or committed during this review.**

**Sanitized classification** (metadata only — content was never read for
this purpose beyond safe boolean/structural checks):
- Path: `.claude/Application Password WP` (18 bytes on disk, one line,
  regular file, not a symlink, `-rw-r--r--` permissions).
- Structural content check: does **not** match WordPress's standard
  generated Application Password format (six lowercase-alphanumeric
  groups of four, space-separated, 29 characters). It more closely
  resembles a general strong password (mixed case, digits, and at least
  one non-alphanumeric symbol, 16 characters, no internal separators).
  **Revised from Part 13/14's earlier, more confident characterization**
  ("almost certainly a real WordPress application-password credential")
  — that assessment was a filename-and-shape heuristic, not a structural
  check; this pass's closer, still content-blind inspection found the
  shape doesn't match WordPress's own format. The filename strongly
  suggests WordPress-related credential material of *some* kind; the
  exact credential type (application password vs. account password vs.
  something else) cannot be confirmed without reading the value, which
  this review does not do.
- `WordPress application password detected: uncertain (shape mismatch — see above)`
- `Associated username detected: no` (single value, no separator embedded)
- `Site identifier detected: no` (no URL, no `@`, no `:` in the content)
- `git check-ignore`: not ignored prior to this pass (now ignored — see
  Repository protection below).
- Predates Build 26: yes — mtime `2026-09-01T01:46:43`, ~19 hours before
  this branch's first commit (Part 14).

**Git-history exposure review — exhaustive, secret-safe, all local refs
plus reflog plus stash plus the raw object store:**
- The exact file **path** was never tracked at any point on any ref
  (`git log --all --full-history` for this path: 0 results); neither was
  any file anywhere under `.claude/`.
- An exhaustive scan of **every object in the repository's local object
  database** (13,783 objects — every blob, tree, commit, and tag ever
  created, reachable or not) for the file's exact content, using a
  pattern-file-based `grep -f` so the value never touched a shell
  argument, environment variable, or history: **exactly one match.**
- That one match is a single **blob object, unreachable from every local
  branch, every tag, every `refs/remotes/origin/*` remote-tracking ref,
  and the one existing stash** (confirmed via `git rev-list --objects`
  against each category and `git fsck --unreachable`). `git log --all
  --find-object=<hash>` returns zero commits — no commit, past or
  present, on any ref this repository knows about, was ever built from a
  tree containing this blob.
- The loose object's own filesystem mtime (`2026-09-01T01:45:48`) is
  about 55 seconds before the working-tree file's own mtime — consistent
  with a `git add` of this same content during the same 2026-09-01
  bulk event identified in Part 14, immediately followed by an unstage
  (`git reset`) or equivalent, before any commit was ever made. This
  repository's object store also contains roughly 250 other unreachable
  objects from ordinary rebase/amend activity across its many feature
  branches — this blob is one of many, not a uniquely anomalous entry.
- Because `git push` only ever transmits objects reachable from the
  ref(s) being pushed, and this blob is reachable from **none** of this
  repository's local refs, none of its remote-tracking refs, and no
  commit anywhere — it is not structurally possible for a normal push
  from this clone to have ever transmitted it. Combined with zero matches
  against every `refs/remotes/origin/*` ref (which mirror the last-fetched
  state of the actual GitHub remote), there is no evidence of remote
  exposure.
- **Classification: `UNTRACKED_ONLY`** — the credential was never part of
  any tracked commit and was never pushed. The one caveat beyond a pure
  "never touched by git" reading: a single orphaned, unreachable blob with
  this content still physically exists in the local `.git/objects` store
  on this machine. It is unreachable from every commit, branch, tag,
  stash, and remote-tracking ref, and **an unreachable blob cannot be
  included in an ordinary push** — so it carries no history or remote
  exposure.

**Correction — garbage collection is NOT a safe or recommended cleanup
step here.** An earlier draft of this section described `git gc
--prune=now` as removing the blob "non-destructively." **That
characterization was wrong and is retracted.** `git gc --prune=now` does
not target one object: it may permanently remove *every* unreachable
object in the repository at once. This repository currently holds roughly
250 other unreachable objects produced by ordinary rebase, amend, and
reset activity across its many feature branches — those are exactly the
objects that make accidental work recoverable, and pruning them would
permanently destroy that safety net for unrelated work. The same applies
to `git prune` and to any manual deletion inside `.git/objects`.

Accordingly:
- **No Git garbage collection, pruning, object deletion, or history
  rewriting was performed at any point** in this or any prior pass.
- **Garbage collection is unnecessary for Build 26 integration.** The
  orphan blob does not affect the branch's mergeability, its contents, or
  what a push would transmit.
- **The real priorities are credential invalidation (external, by the
  account holder) and removal of the working-tree file** — not touching
  the object store. Once the credential is revoked, the orphan blob holds
  only a dead value, and Git's own default maintenance will age it out on
  its normal schedule without any manual intervention.

**Other untracked artifacts checked for duplication:** all 9
`civicflow-portal/docs/operations/*.md` files, all 3 dated HTML reports
under `docs/`, and the two other `.claude/` files (`settings.local.json`,
`scheduled_tasks.lock`) — 14 files total, direct on-disk content scan
using the same pattern-file `grep -f` approach. **Zero contain the exact
credential value.** No affected item beyond the one already identified.

**Repository protection added:** `.gitignore` now excludes the exact path
`.claude/Application Password WP` (narrowest option — the project has no
existing dedicated local-secrets directory convention to reuse, and a
broader `.claude/`-wide rule was deliberately not added, since nothing
established that the rest of `.claude/`'s current or future contents
should always be excluded; the existing precedent in this file, a
"Local keys" section with narrowly-scoped individual paths, was followed
directly). Verified: the file no longer appears in `git status --short`
or `--porcelain=v1 --untracked-files=all`; the other four legitimate
untracked items still appear normally, unaffected; `git diff --check`
passed with no whitespace/conflict-marker issues.

### Credential-purpose investigation (local repository evidence only)

A follow-up pass attempted to establish what this credential is for,
using only local repository context — no external service was contacted,
and the credential was never used, tested, or read for this purpose.

Sanitized findings:
- **WordPress integration present: yes** — `civicflow-marketing-theme/`
  (34 tracked files) is a WordPress theme for the public marketing site.
- **Credential file referenced by code: no** — zero tracked source files,
  scripts, `package.json` commands, CI workflows
  (`.github/workflows/*`), or environment loaders reference this path or
  any path under `.claude/`.
- **Credential file referenced by documentation: no** — the only two
  tracked files naming it are `.gitignore` and this report, both created
  by this containment work itself.
- **Likely environment-variable name: none exists.** No tracked
  `.env.example` across any of the five packages defines any
  WordPress-related variable, and no `WP_*`/`WORDPRESS_*` identifier
  appears anywhere in tracked content.
- **Site association (at the time of this investigation): could not be
  narrowed** — the untracked
  `docs/unestra-website-launch-report-2026-07-14.html` mentions
  "application password" twice, with more than one of this project's
  three public domains near each mention. **Since resolved by the account
  holder — see the identification below.**
- **Active use can be established locally: no** — the theme's own README
  documents manual installation through the WordPress admin UI, not
  automated API publishing. No committed automation consumes this
  credential.

**Operational-requirement classification: `UNREFERENCED LOCAL CREDENTIAL
NOTE`.** Nothing in the repository reads this file, so removing it cannot
break any local or production workflow, any Build 26 test or build, or
any documented deployment step. It appears to be a human convenience note,
not wiring for an automated integration.

### Credential identified by the account holder

**Classification: `GETUNESTRA WORDPRESS UPDATE CREDENTIAL — CONTINUING
USE UNCONFIRMED`.**

The account holder has identified this file as **a credential used to
update the GetUnestra WordPress website**. Its service and purpose are
therefore no longer unknown, and the earlier
`CREDENTIAL PURPOSE UNRESOLVED` status is superseded. This identification
came from the account holder directly, not from repository inference or
from reading the file. No website login URL, WordPress username,
application-password label, or credential value appears in this report.

What remains open is only whether it is still *needed*:

- **Not used by this repository.** It is referenced by no Unestra
  application code, test, CI workflow, build command, package script, or
  deployment workflow. A dedicated non-authenticating review (below)
  re-confirmed this.
- **It may have been created for a one-time website update** — the
  documented process for updating this site is manual, through the
  WordPress admin UI — **but ongoing external use has not yet been
  confirmed** by the account holder.
- **It remains untracked** and excluded by the exact-path `.gitignore`
  rule added earlier in this part.
- **It never appeared in reachable or remote Git history** — re-verified
  by a batched scan of all 13,375 reachable objects and all 13,089
  remote-tracking-ref objects: zero matches in both.
- **It must be treated as potentially active until revoked or confirmed
  obsolete.** Nothing in this work established that it has stopped
  working, and no attempt was made to find out.
- **No Git garbage collection is necessary or authorized** (see the
  correction note above).

### Non-authenticating review for an ongoing publishing process

Performed against repository evidence only; WordPress was not contacted
and the credential was not used or tested.

| Surface checked | Finding |
|---|---|
| Package scripts (all 5 packages) | No WordPress/site publishing. The root `publish`/`dist`/`build:*` scripts are Electron desktop-app packaging (`electron-forge`/`electron-builder`). |
| CI/CD workflows (3 tracked) | None reference WordPress, `wp-json`, FTP/SFTP, or theme deployment. |
| Deployment/publishing scripts | None exist in tracked content. |
| WordPress REST API clients | None. The one `wp_remote_post` call lives *inside* the theme (`functions.php`) and posts the contact form to Brevo's email API — it runs on the WordPress server and consumes no application password. |
| Website publishing scripts | None. |
| Scheduled tasks | The one scheduled workflow (`report-export-scheduler.yml`) calls the Unestra portal API, not WordPress. |
| Automation documentation | `docs/macos-dmg-release.md` states explicitly that no WordPress or marketing-site link is touched by the release pipeline; the theme README documents manual admin-UI updates. |
| Environment-variable names | No `WP_*`/`WORDPRESS_*` identifier exists anywhere in tracked content, and no `.env.example` across the five packages defines one. |
| Committed external-service config | None for WordPress. |
| References to the credential filename/path | Only `.gitignore` and this report — both created by this containment work. |

**`No repository-controlled ongoing integration found.`** This does not
prove no external process uses it — a manual or externally-scheduled
workflow would leave no trace here — so account-holder confirmation is
still required before revocation.

### One-time determination and revocation authorization

**The account holder has confirmed the credential was created for the
completed one-time GetUnestra WordPress website update, and that no
ongoing automation or integration needs it.** This matches the
repository-side finding above (`No repository-controlled ongoing
integration found.`). Revocation was explicitly authorized, with no
replacement to be created.

**Revocation: COMPLETED by the account holder.** The one-time GetUnestra
WordPress application password has been revoked, confirmed directly by
the account holder. **No replacement was created or required.**

An intermediate attempt to perform the revocation from this environment
was correctly abandoned rather than forced: reaching the WordPress
application-passwords page redirected to the login screen (`reauth=1`),
showing no authenticated administrative session existed. Signing in would
have required entering credentials, which is never done, and asking the
account holder to paste a password was explicitly excluded. No login was
attempted, the credential was never used or tested at any point, and the
browser tab opened for that check was closed immediately. The revocation
was therefore performed by the account holder directly, which is the
correct locus for it.

**Local plaintext file: REMOVED.** After (and only after) revocation was
confirmed, the exact file `.claude/Application Password WP` was deleted
using a **recoverable** removal — Windows Recycle Bin, via
`Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(..., SendToRecycleBin)`
— not a permanent unlink, so it stays restorable if it is ever needed for
audit. Ordering was deliberate throughout: revoke first, delete second,
because deleting the local copy while the credential was still live would
have destroyed the record of *which* credential needed revoking without
reducing real risk.

Verified before removal:
- Same file previously reviewed — **cryptographically confirmed**, not
  just by name: the file hashed to blob `61161b01…`, byte-identical to
  the object identified in the original containment scan.
- 18-byte regular file, not a symbolic link.
- Still untracked and still matched by the exact-path `.gitignore` rule.

Verified after removal:
- The exact file no longer exists in the working tree.
- **Zero plaintext duplicates** anywhere in the workspace (recursive
  content scan excluding `.git/` and `node_modules/`).
- **Zero matches in reachable Git history** (13,390 objects across all
  refs) and **zero in remote-tracking refs** (13,089 objects).
- The parent `.claude/` directory was **not** removed; its three
  unrelated local-tooling entries (`worktrees`, `scheduled_tasks.lock`,
  `settings.local.json`) are present and unchanged.
- The four legitimate untracked items (operations docs and three dated
  HTML reports) are untouched.
- The unreachable orphan blob is **untouched and still unreachable** —
  not deleted, not pruned, not inspected beyond the content comparison
  needed for the duplicate/history scans. It now holds a dead,
  revoked value.
- Tracked working tree clean; Build 26 application code unchanged.

**No Git garbage collection, pruning, object deletion, reflog expiration,
or history rewriting was performed at any point** across this or any
prior pass — and none is needed. The orphan blob cannot be included in an
ordinary push and does not block integration.

**File removal: DONE** — see the one-time determination and remediation
section above. Removed to the Recycle Bin (recoverable) only after
revocation was confirmed. No replacement was required. No plaintext
duplicate of the value exists anywhere in the workspace.

**Build 26 confirmation:** zero PTA progression, family-photo, mobile
navigation, permission-flow, authentication, payment, subscription,
Stripe Connect, QR, or migration files were touched by this review — only
`.gitignore` and this documentation section changed.

## Part 16 — Local integration into `main`

Authorized local integration of both completed workstreams. **Nothing was
pushed, deployed, externally built, uploaded, activated, or submitted**;
no production migration was run and no feature flag was enabled.

### Starting branch heads (all verified before acting)

| Ref | Hash |
|---|---|
| `main` | `db73f2a` (== `origin/main`) |
| `fix/import-auth-order-and-format-ui` | `e92ffd7` (preceded by `983c8e2`) |
| `feature/pta-progression-mobile-ui-build26` | `66b74a3` |

Merge base of both feature branches: `db73f2a` for each. `983c8e2` is an
ancestor of `e92ffd7`. Neither branch had been merged into `main`.
One factual note: the **import branch had already been pushed**
(`origin/fix/import-auth-order-and-format-ui` == `e92ffd7`) — expected,
since it carries an open PR from earlier work. Build 26 has no upstream
and has never been pushed. A recovery point was recorded before any
merge: **`db73f2a`**. No branch was deleted, rebased, amended, squashed,
reset, or force-updated at any point; no `git gc`/`prune`/reflog
expiry/history rewriting was run.

### Merge-conflict analysis (read-only, before any merge)

- **Zero file overlap** between the two branches' changed-file sets.
- `git merge-tree --write-tree` run three ways (import→main,
  build26→main, and the two branches against each other): **exit 0, no
  conflicts** in all three.
- Only Build 26 touches `prisma/migrations/` (one additive migration),
  `civicflow-portal/package.json`, and `civicflow-mobile/app.json`. The
  import branch touches none of them, so no migration-ordering,
  dependency, or store-config contention exists.
- No shared route, upload, authorization, parser, or test utility is
  modified by both branches, so neither can regress the other:
  auth-before-parse belongs solely to the import routes, and the
  family-photo upload pipeline is a separate module.

### Import-security preflight (on `e92ffd7`, before merging)

| Check | Result |
|---|---|
| 7 targeted import test files | 147 passed, 0 failed, exit 0 |
| Full portal suite | 407 files / 4,565 tests passed, 178 skipped, 0 failed, exit 0 |
| Portal typecheck | Clean, exit 0 |
| Portal production build | Exit 0 |
| Lint (8 affected files) | 1 error — **pre-existing on `main`** (`migration/page.tsx`'s `<a href="/members">`, `@next/next/no-html-link-for-pages`), untouched by this branch and merely line-shifted; not introduced by the import work |
| Shared legacy `.xls` message | Unchanged — single exported constant `LEGACY_XLS_MESSAGE` in `spreadsheet-parser.ts` with reason code `LEGACY_XLS_UNSUPPORTED`, asserted by the route tests |

**Environment correction worth recording:** the first typecheck run on
this branch reported ~20 errors. All were stale-artifact contamination
from branch switching, not code defects — a `.next/types/*` tree
generated while on Build 26 (referencing progression/photo routes absent
from this branch) plus a Prisma client generated from Build 26's schema
(so `AttachmentEntityType` carried `PTA_HOUSEHOLD`, which this branch's
`attachments.ts` correctly does not map). Clearing `.next` and running
`prisma generate` produced a clean `exit 0`. Also confirmed while
diagnosing: `main`'s two `PTA_HOUSEHOLD` grep hits are the **plural**
`PTA_HOUSEHOLDS` of a different enum (`ImportEntityType`); the singular
`AttachmentEntityType.PTA_HOUSEHOLD` is genuinely added by Build 26.

### Merge 1 — import-security into `main`

- **Merge commit: `8ba7957`** (`--no-ff`), **zero conflicts**, no manual
  resolution required.
- Merged `main` tree `f338d4c` is **byte-identical** to `e92ffd7`'s tree,
  proving the merged content is exactly what was preflighted.
- Re-verified on merged `main`: 7 import test files 147/147 passed;
  typecheck exit 0; production build exit 0.

### Merge 2 — updated `main` into Build 26

- **Merge commit: `d2f74ce`** (`--no-ff`), **zero conflicts**. Build 26's
  pre-merge head was confirmed still `66b74a3`. History was not rebased
  or rewritten.

### Integrated database verification (disposable databases only)

Run against the local disposable cluster on port 5433. **No production
database, storage bucket, or organization was touched**, and no
production credentials or data were used. The source `civicflow_dev` was
only ever used as a `CREATE DATABASE … TEMPLATE` source, never migrated
in place.

| Case | Result |
|---|---|
| Clean empty DB (`civicflow_int_empty`) | All **124** migrations applied from scratch, exit 0 |
| Populated copy (`civicflow_int_pop`, template copy of `civicflow_dev`) | 3 pending migrations applied cleanly, exit 0 |
| Pre-existing rows intact | **Yes** — the only row-count change across every table was `_prisma_migrations` 121 → 124. `OrgSettings`, `Organization`, `OrganizationMembership`, `PlatformAccess`, `User`, `WhatsAppTemplate` all unchanged |
| Migrations edited after prior application | **No** — 124 applied, 0 failed, 0 rolled back (a checksum mismatch would have failed `migrate deploy`) |
| Progression schema additive | `PtaStudentProgressionBatch` + `PtaStudentProgressionRecord` created; `PtaProfile.studentProgressionEnabled` added `NOT NULL DEFAULT false`; `PtaHousehold.photoUrl` added nullable with no default; `AttachmentEntityType.PTA_HOUSEHOLD` enum value added |
| **Feature flag default** | **OFF** — `studentProgressionEnabled` default is `false` |
| Unique constraints / indexes | Present as Prisma unique indexes: batch year-pair `…_organizationId_fromSchoolYearId__key`, `…_commitIdempotencyKey_key`, record `…_batchId_studentId_key`; plus `organizationId`, `(organizationId,status)`, `(batchId,outcome)`, `studentId` indexes. The concurrency guard `PtaStudentEnrollment_studentId_schoolYear_key` (UNIQUE) is present |
| Side effects | None — no payments, assessments, buyouts, notifications, or messages were triggered |

Both disposable databases were dropped immediately afterward.

### Integrated regression (on `d2f74ce`)

**Portal**

| Command | Result |
|---|---|
| `npx vitest run` (full) | 413 files passed / 31 skipped; **4,666 passed, 0 failed, 178 skipped**; exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | Exit 0 |
| `npm run build` | Exit 0 |

**One transient failure, honestly recorded:** the *first* integrated full
run reported 1 failed file / 1 failed test. It did **not** reproduce
across three subsequent full-suite runs (0 failed each, 4,666 passed) or
three targeted runs of the timing-sensitive rate-limiter suites (2 files
/ 35 tests passed each). Its identity was not captured — only the tail of
that first run was retained — so it is reported as an **unidentified,
non-reproducing flake**, not as a clean sweep. The most likely candidate
is one of the wall-clock rate-limit window tests, but that is a
hypothesis, not a confirmed finding. Worth watching in CI; not treated as
a resolved issue.

**Mobile**

| Command | Result |
|---|---|
| `npx jest` (full) | **71 suites / 416 tests passed, 0 failed, 0 skipped** |
| `npx jest pta-my-family pta-family-photo dashboard org-switcher attendance-scan report-payment` | 9 suites / 64 tests passed, 0 failed |
| `npx tsc --noEmit` | Exit 0 |
| `npx expo lint` | 0 errors, 2 pre-existing warnings in an unrelated test file |
| `npx expo export --platform ios` | Exit 0 |
| `npx expo export --platform android` | Exit 0 (local bundle only; no cloud/EAS service used) |

**Behavioural confirmations**

- **No directive camera-permission wording** in rendered UI copy —
  repo-wide search returns only two hits, both *code comments*
  documenting the historical wording that was corrected.
- **`Open Settings` functional** — both `attendance-scan.tsx` and
  `pta-family-photo.tsx` call `Linking.openSettings()`.
- **Family-photo entry point discoverable** — the dashboard's "My Family"
  action routes to `/pta-my-family`.
- **Community/Church/Union cannot reach PTA family-photo or
  progression** — covered by the vertical-tagged isolation tests; PTA
  progression has no mobile surface at all.
- **Organization switching clears stale PTA data** — dedicated tests.
- **Authentication and payment behaviour unchanged** — no such file is
  touched by either branch.
- **Volunteer-shift QR remains deferred** and is not represented as
  implemented; the only QR code present is the pre-existing *meeting
  attendance* `checkInWithQrToken`.
- **Import auth-before-parse regression suite green** throughout.

### Merge 3 — Build 26 into `main`

- **Merge commit / final local `main`: `2d88759`** (`--no-ff`), **zero
  conflicts**.
- `main` was confirmed still at the import merge `8ba7957` immediately
  before merging.
- **Final `main` tree `9c48bfe` is byte-identical to the tested Build 26
  branch tree `9c48bfe`** — the strongest available proof that what
  landed on `main` is exactly what was verified, with no drift.

### Post-merge verification from final `main` (`2d88759`)

| Check | Result |
|---|---|
| Portal typecheck | Exit 0 |
| Portal production build | Exit 0 |
| Targeted security + feature suites (14 files: import ×7, progression, family-photo ×4, PTA/mobile guards ×2) | **259 passed, 0 failed**, exit 0 |
| Mobile typecheck | Exit 0 |
| Mobile full suite | 71 suites / 416 tests passed |
| Metro iOS export | Exit 0 |
| `prisma migrate deploy` + `migrate status` vs a fresh disposable DB | All 124 applied; "Database schema is up to date"; DB dropped afterward |
| Secret scan of tracked content | No real key material — the only hits are the CI scanner's own pattern, `DEPLOYMENT.md` documentation, a `sk_live_REPLACE_ME` placeholder in `.env.example`, and two script usage comments |
| Revoked credential file | **Absent**, and the exact-path `.gitignore` rule remains |
| Unreachable orphan blob | **Not pruned**, still unreachable from every ref |
| Working tree | Tracked clean; the same four legitimate untracked items remain, unmodified |

No EAS build, native store binary, TestFlight upload, Play Console
upload, or store submission was created at any point.

### Conflicts and resolutions

**None.** All three merges completed with zero conflicts and required no
manual resolution, so no files were touched by conflict resolution and no
resolution-driven tests were needed. This matches the pre-merge
merge-tree analysis exactly.

### Remaining gates

Native build installation and **physical-device verification remain
mandatory and outstanding** before any store submission (see Parts
10–11). Volunteer-shift QR check-in remains deferred (Part 7). PTA
progression stays flag-gated OFF by default and is not activated by this
integration.

## Part 17 — Read-only mobile student progression

A follow-on feature built on the Build 26 branch and locally integrated
into `main`. **Nothing was pushed, deployed, externally built, uploaded,
activated, or submitted**; no production migration was run and **no
feature flag was enabled**.

### Scope: read-only, and why administration stays portal-only

Families can now see each child's current placement and any confirmed
next-year placement in the mobile app. Everything that *changes*
progression — preview, classroom mapping, commit, correction, exclusion,
retain/withdraw/transfer, rollback and audit — remains portal-only,
unchanged, behind `requirePtaAccess` and the progression permissions
(`PTA_STUDENT_PROGRESSION_PREVIEW` is staff-and-above;
`..._COMMIT` is `ORG_ADMIN`/`ORG_OWNER` only). The mobile route exposes
**no write verb at all**, asserted by a dedicated test.

Keeping administration portal-only is deliberate: those operations are
multi-step, irreversible-in-practice, and need the batch preview,
conflict resolution and audit context that only the full admin UI
provides. A phone-sized surface invites exactly the kind of partial,
under-informed commit that the SAVEPOINT and unresolved-student-warning
work earlier in this program existed to prevent.

### Publication rule

`PtaEnrollmentStatus` has only `ACTIVE`/`INACTIVE` — **there is no
explicit publish/visibility state**, and none was added (no schema change
was required or made). The safest existing signal is used instead, and it
was *verified against `student-progression.ts`*, not assumed:

- `previewProgressionBatch` only **reads** enrollments; it writes
  `PtaStudentProgressionRecord` rows in `PLANNED` state and creates no
  enrollment.
- Target-year `PtaStudentEnrollment` rows are created in exactly two
  places, both inside commit/correction, always with `status: "ACTIVE"`.
- Correcting a student away from an enrolling outcome, and rolling a
  batch back, both set that row to `INACTIVE` rather than deleting it.

So **"an ACTIVE target-year enrollment exists" ≡ "committed and not
rolled back"**, which is exactly the publication rule required. A preview
alone never publishes anything.

The structural privacy guarantee is stronger than filtering:
`parent-progression.ts` **never queries the progression batch or record
tables at all.** Preview calculations, draft mappings, `NEEDS_REVIEW`
state, administrator notes, conflict details, audit actors, batch
idempotency keys and outcome codes are therefore unreachable from the
family surface by construction — no future edit to that file can leak one
by accident. The service test enforces this by wiring both tables to
**throw** on any access.

Students who are `NEEDS_REVIEW`, skipped, excluded, graduated,
transferred or withdrawn all have no ACTIVE target-year enrollment and
are reported **identically** as "not yet available" — indistinguishable
to the family, by design. **No graduation/transfer/withdrawal wording was
invented**: those outcomes mark only the progression record `APPLIED`,
they do not deactivate the student, and the product has no existing
family-visible convention for announcing them. Inventing one risked
telling a family something sensitive before an administrator had.

### Family-facing statuses

| Status | Meaning |
|---|---|
| `Confirmed` | Committed, non-rolled-back next-year placement |
| `Not yet available` | No publishable future placement (covers every administrative reason, indistinguishably) |
| `Completed` | Rolled into the active year with no later year defined |
| `Current` | Current placement, no prior history and no later year defined |

Internal statuses and outcome codes are never rendered. `Ready` (an
administrator preview concept) is deliberately absent.

### API contract

`GET /api/mobile/pta/progression?organizationId=…` → `{ ok, data }` with
`currentSchoolYear`, `nextSchoolYear`, and `students[]` of
`{ studentId, displayName, currentGrade, currentClassroom, nextGrade,
nextClassroom, status }`. Additive, minimal, stable; no other field is
returned.

Authorization, in order, via the existing shared guard
`requireMobilePtaHouseholdAccess` (no new auth path invented): bearer
authentication → PTA vertical + active organization
(`requirePtaVerticalForMobile`) → the caller's own **active** household
linkage → organization access. Then `assertProgressionEnabled` — the
*same* helper the administrative entry points use, exported rather than
duplicated so the two cannot drift — enforces both feature flags.

**The client never supplies a household or student id.** The household
comes only from the caller's own `PtaHouseholdAdult` linkage, and the
guard's *verified* organization id is used rather than the raw query
value. Extra `householdId`/`studentId` query parameters are ignored
entirely (tested). Queries are bounded at three regardless of family
size; student ordering is deterministic (`displayName`, then `id`).

### Entry point and screen

`PTA → My Family → Progression` card → `Student Progression` screen.
The card is rendered **only when the server confirms availability**: My
Family probes the flag-gated endpoint and shows the card only on success,
so it is absent whenever either flag is OFF, absent for non-PTA
identities, and absent for Community/Nonprofit, Church and Union. The
probe fails closed and stays silent, so an unavailable optional card
never raises an error over the screen's primary family-photo content.

The screen is read-only — no editable control and no administrative
action — and covers loading, empty, network-error-with-retry, a distinct
feature-unavailable state, unauthorized redirect, and organization-switch
clearing. Each child's card carries one composed accessibility sentence
rather than fragments. **No new device permission of any kind** (camera,
photo library, location, notification, tracking) is requested.

### Feature-flag behavior

Both flags remain **OFF by default** and were **not** enabled for Pine
Grove or any production organization. With either OFF the entry point is
hidden, no progression data is fetched, direct navigation exposes
nothing, and the endpoint returns the application's standard 403 with the
existing `PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED` /
`PTA_STUDENT_PROGRESSION_DISABLED` codes. Tests use synthetic
organizations with the flags enabled.

### Tests added (70)

| File | Tests |
|---|---|
| `civicflow-portal/src/lib/labs/pta/__tests__/parent-progression.test.ts` | 21 |
| `civicflow-portal/src/app/api/mobile/pta/progression/__tests__/route.test.ts` | 12 |
| `civicflow-mobile/src/app/__tests__/pta-progression.test.tsx` | 25 |
| `civicflow-mobile/src/app/__tests__/pta-my-family.test.tsx` (extended) | +6 (24 total) |

Covering both flags off, tenant/household scoping, cross-tenant household
ids, client-supplied id rejection, unauthenticated and staff-only denial,
Community/Nonprofit + Church + Union denial with vertical-tagged
fixtures, the publication rule, indistinguishability of all withheld
administrative outcomes, multiple children progressing differently in
deterministic order, no students, no current placement, missing academic
year, year gaps, non-canonical labels, bounded query count, every UI
state, organization switching, and accessibility.

### Verification

| Check | Commit | Result |
|---|---|---|
| Portal full suite | `18aa539` | 4,701 passed, **0 failed**, 178 skipped, exit 0 |
| Mobile full suite | `18aa539` | 72 suites / **447 passed**, 0 failed |
| New progression tests (portal) | `18aa539` | 2 files / 33 passed |
| New progression tests (mobile) | `18aa539` | 25 passed |
| Import auth-order + family-photo + guards (targeted) | `18aa539` | 14 files / 259 passed |
| Portal typecheck / mobile typecheck | `18aa539` | Both exit 0 |
| Lint (changed files, both packages) | `18aa539` | Exit 0 |
| Portal production build | `18aa539` | Exit 0 |
| Metro iOS / Android export | `18aa539` | Both exit 0 |
| Post-merge targeted suite | `30584c2` | 14 files / **274 passed** |
| Post-merge portal typecheck / build | `30584c2` | Exit 0 / exit 0 |
| Post-merge mobile typecheck / full suite / iOS export | `30584c2` | Exit 0 / 72 suites / 447 passed / exit 0 |
| Secret scan of tracked content | `30584c2` | No real key material (hits are AWS's public `AKIAIOSFODNN7EXAMPLE` doc value in a sanitizer test, and a prose paragraph describing a past scan) |

**Failures and flakes:** none in this pass. Every failure encountered
during development was deterministic, identified, and fixed at the source
rather than retried — a Vitest mock-factory hoisting error, a Jest
mock-factory rejection of TypeScript parameter properties, a
`clearAllMocks`-does-not-reset-implementations leak between tests, and a
pending fetch promise held across a test boundary that corrupted React
19's process-global `act()` nesting counter (the same failure mode
documented in `dashboard.test.tsx`). The unidentified non-reproducing
portal flake recorded in Part 16 **did not recur** in any run here.

### Commits and integration

| Item | Hash |
|---|---|
| `feat(pta): add family-safe mobile progression API` | `1b2d71d` |
| `feat(mobile): add read-only PTA progression screen` | `2c95bfd` |
| `test(pta): verify mobile progression privacy and isolation` | `18aa539` |
| Local merge into `main` (`--no-ff`, **zero conflicts**) | `30584c2` |

Feature branch before this work: `d2f74ce`; after: `18aa539`. Local
`main` before: `9cfab2f`; after the merge: `30584c2`.

The merged `main` tree differs from the tested feature tree by exactly
one file — `build-26-final-report.md` (+194 lines), the Part 16
integration documentation already committed on `main` and deliberately
preserved. **Zero application-code difference** between what was verified
and what landed.

### Preserved unchanged

Administrative progression execution, commit/rollback rules,
family-photo upload security, the Apple camera-permission correction and
`Open Settings`, payments, authentication, subscription billing, Stripe
Connect, import security, the volunteer-shift QR deferral (still
deferred, still not represented as implemented), and the credential
remediation (revoked file still absent, `.gitignore` rule intact, orphan
blob still unreachable and **not pruned**).

### Remaining gates

Native build installation and **physical-device verification remain
mandatory and outstanding**, as does remote CI, before any store
submission.

## Part 18 — Progression publication control (Publish to Families)

An explicit, audited disclosure step separating "the office finished the
data work" from "the school is ready to tell families." **Nothing was
pushed, deployed, externally built, uploaded, submitted, or activated; no
production migration was run and no feature flag was enabled.**

### The problem this fixes

Part 17 shipped the read-only mobile progression screen, but it treated a
committed `ACTIVE` target-year enrollment as *immediately* family-visible.
That conflated two different decisions, made at different times by
different people. An administrator finishing a rollover on a Tuesday had
no way to review the result privately before every affected family could
see it.

### Publication architecture

Publication state lives on **`PtaStudentProgressionBatch`**, because
`@@unique([organizationId, fromSchoolYearId, toSchoolYearId])` already
makes one batch the unique representation of a single source-to-target
transition — so two batches can never disagree about whether the same
transition is disclosed. No generic school-year or enrollment model was
touched, so **no other vertical is affected**.

The five states are now distinct:

| State | Meaning | Family-visible? |
|---|---|---|
| Previewed | Proposed movement; no enrollments written | No |
| Committed | Target enrollments exist and are ACTIVE | **No — private** |
| Published | Eligible committed results disclosed | Yes |
| Withdrawn | Previously published, now hidden from future reads | No |
| Rolled back | Target enrollments INACTIVE | No |

`WITHDRAWN` is deliberately distinct from `UNPUBLISHED`: withdrawal hides
future results from later reads but **cannot undo a disclosure that
already happened**, and the record should show that.

### Migration

`20260903120000_pta_progression_publication`, strictly additive: the enum
is created before any column references it; every column is nullable or
has a constant `DEFAULT` (metadata-only on PG11+, no table rewrite);
nothing is dropped, renamed or narrowed; old clients that never select
these columns keep working. New: `PtaProgressionPublicationStatus` enum,
`publicationStatus` (default `UNPUBLISHED`), `publishedAt/By`,
`unpublishedAt/By`, `publicationVersion` (default 0), unique
`publishIdempotencyKey`, and an
`(organizationId, toSchoolYearId, publicationStatus)` index.

Verified on **disposable databases only** — production untouched, source
`civicflow_dev` used only as a `TEMPLATE` copy source:

| Case | Result |
|---|---|
| Empty DB | All 125 migrations applied from scratch, exit 0 |
| Populated copy | Applied cleanly; **every pre-existing row intact** (only `_prisma_migrations` moved 121 → 125) |
| **Existing committed batch defaults unpublished** | **Proven** — reconstructed the pre-migration table shape, inserted a legacy `COMMITTED` batch, re-applied the `ALTER`: it landed `publicationStatus=UNPUBLISHED`, `publicationVersion=0`, `publishedAt=NULL` |
| Defaults, enum values, indexes | All verified directly against `information_schema`/`pg_indexes` |
| Final `main` re-verification | `migrate deploy` + `migrate status` → "Database schema is up to date" |

### Administrator workflow

Portal-only, in `PtaStudentProgressionCenter`. After a commit the batch
now **stays active** (it previously dropped straight into history, which
made the workflow appear to end at commit) until it is published or
rolled back. A "Family visibility" panel shows status, the year pair,
eligible and unresolved/excluded counts, and — once published — the
timestamp and publishing administrator, above the line:
*"Committed progression results remain private until you publish them to
families."*

`Publish to Families` confirms with the exact disclosure, not a generic
prompt: *"Publish progression results? Families will be able to see
confirmed next-year grade and classroom information in the Unestra mobile
app. Draft, unresolved, and excluded records will not be shown."*
Withdrawal is labelled `Hide Future Results from Families` and warns
*"Families may already have viewed these results. Hiding them does not
undo prior disclosure."*

### Blocking-validation behavior — chosen policy

**Publication is blocked, never partial.** Any record that is
`NEEDS_REVIEW` and not applied, `FAILED`, or `APPLIED` with no target
enrollment blocks the whole publish with
`PTA_PROGRESSION_PUBLISH_BLOCKED` and a reason string carrying counts
only. A family shown "Confirmed" for a student the office has not
actually resolved is worse than a family shown nothing yet, and a partial
publish gives no signal that anything is missing.
Graduated/transferred/withdrawn/excluded records are counted as
**excluded, not blocking** — there is simply nothing to disclose for
them.

### Mobile visibility rule

A **current-year** placement is always shown — it is the student's
ordinary official enrollment and has nothing to do with disclosure. A
**future-year** placement appears only when all of: an ACTIVE target-year
enrollment exists, the linking record is `APPLIED` with a real placement
outcome, and its batch is `PUBLISHED`.

`parent-progression.ts` must now read publication state, so Part 17's
"never touches the progression tables at all" guarantee is replaced by a
stricter, more useful **minimal-access** guarantee, enforced by tests: it
reaches publication only through the record→batch relation (never a
direct batch query), selects exactly `{ targetEnrollmentId }` from the
record, and filters on organization, `APPLIED`, real outcomes and
`publicationStatus: PUBLISHED`. No batch id, actor, timestamp,
idempotency key, outcome code, exception reason or audit field can reach
the response. Committed-but-unpublished, withdrawn, rolled-back,
unresolved and excluded are **byte-identical** to the family. A safe
`publicationStatus: "NOT_AVAILABLE" | "PUBLISHED"` field is returned that
never explains *why*.

### Correction and rollback

- **Correction after publication is allowed**, because blocking it would
  leave families looking at a placement the office knows is wrong. The
  live enrollment is the source of truth, so the family view updates on
  the next read. It is flagged in the per-record audit metadata
  (`correctedAfterPublication`) and in a batch-level
  `pta.progression.corrected_after_publication` event recording that
  families may have seen the previous result.
- **Rollback is blocked while published**
  (`PTA_PROGRESSION_ROLLBACK_BLOCKED_PUBLISHED`) rather than
  transactionally unpublishing as a side effect. Withdrawing a disclosure
  should be a deliberate, separately-audited act the administrator
  performs and sees. The portal disables the Roll back button and explains
  why.

### Authorization, concurrency and audit

New `PTA_STUDENT_PROGRESSION_PUBLISH` permission (`ORG_ADMIN`/`ORG_OWNER`,
same tier as commit but **separate**, so an organization can audit and
withhold the disclosure step independently of the data step). Status and
history use the existing PREVIEW permission. Every verb authorizes before
parsing the body; the organization id is always server-resolved.

Publication is transactional, guarded by an optimistic
`publicationVersion` (a losing concurrent publisher gets
`PTA_PROGRESSION_PUBLICATION_STALE` rather than double-publishing), and
idempotent on `publishIdempotencyKey` (a retried HTTP publish is a
recorded replay, not a second disclosure). Audit events cover publish,
idempotent replay, blocked attempt, withdrawal, and post-publication
correction — carrying counts and year labels but **never student names**.
**No notification is sent by any of this.**

### Feature flags

Both progression flags remain **OFF by default** and were **not** enabled
for Pine Grove or any production organization. With either flag off, the
publication service denies before doing any work and the mobile entry
point stays hidden.

### Tests and results

| Check | Commit | Result |
|---|---|---|
| Portal full suite | `1cb34a7` | **4,749 passed, 0 failed**, 178 skipped |
| Mobile full suite | `1cb34a7` | 72 suites / **456 passed, 0 failed** |
| Publication service | `1cb34a7` | 26 passed |
| Publication routes | `1cb34a7` | 12 passed |
| Parent-progression (rewritten for publication) | `1cb34a7` | 28 passed |
| Progression service (incl. 3 new rollback-publication tests) | `1cb34a7` | 32 passed |
| Mobile progression screen (incl. 9 new publication tests) | `1cb34a7` | 34 passed |
| Portal + mobile typecheck | `1cb34a7` | Both exit 0 |
| Lint (changed files) | `1cb34a7` | **0 errors** (1 unused-arg warning in a test) |
| Portal production build | `1cb34a7` | Exit 0 |
| Metro iOS / Android export | `1cb34a7` | Both exit 0 |
| Post-merge targeted suite | `f7754ce` | 12 files / **246 passed** |
| Post-merge portal typecheck / build | `f7754ce` | Exit 0 / exit 0 |
| Post-merge mobile typecheck / suite / iOS export | `f7754ce` | Exit 0 / 72 suites / 456 passed / exit 0 |
| Post-merge migration verification | `f7754ce` | Applied + "schema is up to date", DB dropped |
| Secret scan | `f7754ce` | No real key material |

**Failures and flakes: none in this pass.** Three expected failures
appeared mid-implementation — the parent-progression tests that asserted
the *old* rule (committed ⇒ visible). Those were not flakes; they were
the change being detected correctly, and the directive required replacing
them. Each was identified by name and rewritten. Full JSON reporter
output was captured for both suites rather than tailed. The unidentified
non-reproducing portal flake recorded in Part 16 **did not recur**.

### Commits and integration

| Item | Hash |
|---|---|
| `feat(pta): add progression publication state` | `b036519` |
| `feat(pta): add publish-to-families workflow` | `002fdfa` |
| `fix(mobile): gate future progression on publication` | `1cb34a7` |
| Local merge into `main` (`--no-ff`, **zero conflicts**) | `f7754ce` |

Feature branch before: `18aa539`; after: `1cb34a7`. Local `main` before:
`3da678c`; after the merge: `f7754ce`. The merged `main` tree differs from
the tested feature tree by exactly one file — `build-26-final-report.md`
(the Part 17 documentation already on `main`, preserved) — so there is
**zero application-code difference** between what was verified and what
landed.

### Confirmations

- **Current placements remain visible** regardless of publication state.
- **Committed but unpublished future placements remain hidden.**
- **Only published future placements appear.**
- Credential remediation intact: revoked file absent, `.gitignore` rule
  present, orphan blob still unreachable and **not pruned**.
- Physical-device verification and **remote CI** remain outstanding gates.

## Part 19 — Progression lifecycle and mutability audit

Triggered by the Part 18 change that keeps a committed-but-unpublished
batch in the "active" grouping so the publication panel stays reachable.
The question: does that leave committed data editable, or change
history/reporting behavior? **Nothing was pushed, deployed, externally
built, uploaded, activated, or submitted.**

### Audit conclusion

The active-grouping change is **safe and retained (Outcome A)** — but the
audit found a **real, pre-existing immutability defect** elsewhere,
unrelated to that change, which is now fixed.

### Exact lifecycle states (repository values, not invented)

`PtaStudentProgressionBatchStatus`: `PREPARING`, `PREVIEWED`,
`COMMITTED`, `CORRECTED`, `ROLLED_BACK`.
`PtaProgressionPublicationStatus`: `UNPUBLISHED`, `PUBLISHED`,
`WITHDRAWN`.

### Editable vs actionable vs family-visible vs historical vs terminal

These are five separate concepts and no single flag decides them:

- **Editable** — the *plan* may still change (mappings, exceptions,
  preview regeneration). Decided **only** by `assertBatchEditable()`
  server-side: `PREPARING` or `PREVIEWED`, and never `PUBLISHED`.
- **Actionable** — some valid next administrative action exists (publish,
  correct, withdraw, roll back). This is what the portal's "active"
  grouping means. **Actionable ≠ editable.**
- **Family-visible** — future placements only when
  `publicationStatus = PUBLISHED`; current placements always.
- **Historical** — appears in the history list (published or rolled back).
- **Terminal** — `ROLLED_BACK`: no further action.

### Transition table

| Starting state | Action | Permitted? | Resulting state | Editable? | Family-visible? |
|---|---|---|---|---|---|
| PREPARING / PREVIEWED | Edit mappings / exceptions / regenerate preview | Yes | Unchanged (PREVIEWED after preview) | Yes | No |
| PREVIEWED | Commit | Yes (fresh preview + idempotency key) | COMMITTED, UNPUBLISHED | **No** | No |
| COMMITTED, unpublished | Edit mappings / exceptions / preview | **No** — `PTA_PROGRESSION_BATCH_NOT_CORRECTABLE` | Unchanged | No | No |
| COMMITTED, unpublished | Commit again, same key | Idempotent replay of prior result | Unchanged | No | No |
| COMMITTED, unpublished | Commit again, different key | Rejected — `PTA_PROGRESSION_BATCH_ALREADY_COMMITTED` | Unchanged | No | No |
| COMMITTED, unpublished | Publish | Yes (PUBLISH permission, blocked if unresolved records) | PUBLISHED | No | **Yes** |
| COMMITTED, unpublished | Roll back | Yes (unless dependent volunteer-ledger activity) | ROLLED_BACK | No | No |
| PUBLISHED | Edit mappings / exceptions / preview | **No** — status *and* publication both refuse | Unchanged | No | Yes |
| PUBLISHED | Correct via correction service | Yes, audited twice (record + batch-level) | CORRECTED, still PUBLISHED | No | Yes (updated) |
| PUBLISHED | Roll back directly | **No** — `PTA_PROGRESSION_ROLLBACK_BLOCKED_PUBLISHED` | Unchanged | No | Yes |
| PUBLISHED | Unpublish | Yes (PUBLISH permission, audited) | WITHDRAWN | No | No |
| WITHDRAWN | Roll back | Yes | ROLLED_BACK | No | No |
| WITHDRAWN | Publish again | Yes (new disclosure; replay key cleared) | PUBLISHED | No | Yes |
| ROLLED_BACK | Publish | **No** — `PTA_PROGRESSION_ROLLED_BACK` | Unchanged | No | No |
| ROLLED_BACK | Edit or recommit | **No** | Unchanged | No | No |
| Any | Concurrent publish (stale version) | Rejected — `PTA_PROGRESSION_PUBLICATION_STALE` | Unchanged | — | — |
| Any | Cross-organization batch id | Rejected — `PTA_PROGRESSION_BATCH_NOT_FOUND` | Unchanged | — | — |

### Defect found and fixed

**All three plan-editing services used a denylist, not an allowlist:**

```
if (batch.status === "COMMITTED" || batch.status === "ROLLED_BACK") throw …
```

That omits `CORRECTED` — the status `correctProgressionRecord` itself
sets. So **one correction re-opened a committed batch for wholesale
editing.** Reproduced before fixing with a probe: a `CORRECTED` batch's
classroom mappings were **deleted and recreated with no error raised**,
while a `COMMITTED` batch was correctly rejected. `generateProgressionPreview`
would likewise have overwritten committed records outright — including
while results were published to families.

This predates the publication work; the active-grouping change did not
cause it, but the audit is what surfaced it.

**Fix:** a shared `assertBatchEditable()` allowlist —
`EDITABLE_BATCH_STATUSES = ["PREPARING", "PREVIEWED"]` — plus an
independent refusal of any `PUBLISHED` batch as defence in depth. An
allowlist cannot fail the same way when a state is added later. Re-probed
after the fix: `CORRECTED` now throws and writes nothing.

### Active-batch consumer matrix

| File / function | R/W | Meaning of "active" | Includes committed-unpublished? | Includes published? | Permits mutation? | Guard | Tests |
|---|---|---|---|---|---|---|---|
| `student-progression/page.tsx` (`active` / `history`) | Read | Has a valid next action | **Yes** | No (→ history) | **No** — display only | n/a | Page-level |
| `PtaStudentProgressionCenter` `canEditMappings` | Read | Editable | No | No | No (UI only) | `PREPARING`/`PREVIEWED` allowlist | Component |
| `saveProgressionClassroomMappings` | **Write** | — | No | No | Yes | `assertBatchEditable` | 3 new |
| `generateProgressionPreview` | **Write** | — | No | No | Yes | `assertBatchEditable` | 3 new |
| `saveProgressionException` | **Write** | — | No | No | Yes | `assertBatchEditable` | 3 new |
| `commitProgressionBatch` | **Write** | — | Idempotent replay only | No | Yes | `PREVIEWED` required | Existing |
| `correctProgressionRecord` | **Write** | — | Yes | Yes | Yes | `COMMITTED`/`CORRECTED` only | Existing + audit |
| `rollbackProgressionBatch` | **Write** | — | Yes | **Blocked** | Yes | status + `assertNotPublishedForRollback` | 3 existing |
| `publish/unpublishProgressionResults` | **Write** | — | Yes | Yes | Publication only | state + version + idempotency | 26 |
| `listProgressionBatches` / `GET .../student-progression` | Read | **No split — returns all** | Yes | Yes | No | flags | Route tests |
| `getProgressionBatchDetail` | Read | Single batch | Yes | Yes | No | org-scoped | Existing |
| `parent-progression.ts` (mobile) | Read | n/a | Hidden | Shown | No | publication join | 28 |

**No dashboard, report, export, scheduled job, or data-health check
consumes batch state** — verified by a repo-wide search, not just changed
files. The only remaining "progression" matches are the feature flag
(profile/settings/env/rbac/layout).

### History and reporting

Unchanged. The list API returns **all** batches with no active/history
split, so reporting, counts, exports and audit views are unaffected. The
grouping change is confined to one page's display. No lifecycle state
disappears from all administrator views: draft/committed-unpublished/
corrected-unpublished appear in the working view; published and
rolled-back appear in history; published remains discoverable for
auditing and withdrawal.

### Authorization

Separate server-side enforcement confirmed for preview/edit
(`…:preview`), commit (`…:commit`), publish/unpublish (`…:publish`),
rollback (`…:commit`), and family mobile read (household self-access).
`PTA_STUDENT_PROGRESSION_PUBLISH` remains distinct from commit; holding it
grants no edit or commit rights. Every route enforces the PTA vertical,
organization scope, and both flags. Frontend visibility is never the sole
control — the probe exercised the services directly, bypassing the UI.

### Lint warning

The unused `_args` parameter in `parent-progression.test.ts` (introduced
in Part 17) was removed by dropping the parameter **and** its spread call
sites, not by suppression and without weakening the test. Build 26 now
produces **zero new warnings**. Pre-existing, unrelated: 2
`no-require-imports` warnings in `(tabs)/__tests__/_layout.test.tsx`.

### Tests added

13 lifecycle regression tests: mapping edits, preview regeneration and
per-student overrides each denied for `COMMITTED`, `CORRECTED` and
`ROLLED_BACK` (9); published batches non-editable regardless of status
(1); `PREPARING`/`PREVIEWED` still editable (2); cross-organization batch
id not found (1). Progression suite 32 → 45.

### Verification

| Check | Commit | Result |
|---|---|---|
| Portal full suite | `ac0b6ae` | **4,762 passed, 0 failed**, 178 skipped |
| Mobile full suite | `ac0b6ae` | 72 suites / **456 passed, 0 failed** |
| Portal + mobile typecheck | `ac0b6ae` | Both exit 0 |
| Lint — all 15 Build 26 files | `ac0b6ae` | **0 errors, 0 warnings** |
| Portal production build | `ac0b6ae` | Exit 0 |
| Metro iOS / Android | `ac0b6ae` | Both exit 0 |
| Post-merge targeted (14 files: lifecycle, publication, import, family-photo, cross-vertical) | `d0fc194` | **285 passed** |
| Post-merge portal typecheck / build | `d0fc194` | Exit 0 / exit 0 |
| Post-merge mobile typecheck / suite / iOS | `d0fc194` | Exit 0 / 72 suites / 456 passed / exit 0 |
| Secret scan | `d0fc194` | No real key material |

**Failures and flakes: none.** No schema or query change was made, so
disposable-database migration re-verification was not required.

### Commits

| Item | Hash |
|---|---|
| `fix(pta): separate editable and publishable progression states` | `ac0b6ae` |
| Local merge into `main` (`--no-ff`, zero conflicts) | `d0fc194` |

Feature `1cb34a7` → `ac0b6ae`; main `64cdd30` → `d0fc194`. The merged tree
differs from the tested feature tree by exactly one file
(`build-26-final-report.md`, already on `main`) — zero application-code
drift.

### Confirmations

- Committed-unpublished batches are **actionable but not editable**.
- Publication panel reachable after commit, reload, re-login, direct
  authorized navigation, correction, and withdrawal; **not** shown for
  draft-only, rolled-back, wrong-organization, non-PTA verticals,
  flag-disabled, or users without publish permission — and reachability
  was achieved without weakening any status validation.
- No progression flag was activated.
- Credential remediation intact; orphan blob unreachable and not pruned.

## Final status

**GETUNESTRA WORDPRESS CREDENTIAL REMEDIATED — BUILD 26 READY FOR
INTEGRATION AUTHORIZATION**

Part 15's credential-containment review found the flagged file
(`.claude/Application Password WP`) was **never tracked, never committed,
and never pushed** — classified `UNTRACKED_ONLY` after an exhaustive,
secret-safe scan of all 13,783 objects in the local git object database,
every local ref, every `refs/remotes/origin/*` ref, and the one stash.
The account holder identified it as the **GetUnestra WordPress
website-update credential**, created for a completed **one-time** update
with no ongoing automation needing it — matching the repository-side
finding of no committed integration. **The credential has since been
revoked by the account holder, with no replacement required, and the
local plaintext file has been removed** (recoverably, to the Recycle Bin,
only after revocation was confirmed). Zero plaintext duplicates remain in
the workspace, and the value remains absent from all reachable (13,390
objects) and remote-tracking (13,089 objects) Git history. One
orphaned, unreachable local blob with matching content exists in
`.git/objects` (not reachable from anything, structurally unpushable, and
one of roughly 250 similar unreachable objects this repository's history
already contains). **No garbage collection, pruning, or object deletion
was performed, and none is recommended** — `git gc --prune=now` would
permanently remove all ~250 unreachable objects, not just this one,
destroying the recoverability safety net for unrelated work; it is also
unnecessary for Build 26 integration (see Part 15's correction note). The
blob now holds a dead, revoked value and is left untouched. Repository
protection (a narrow `.gitignore` rule for the exact path) remains in
place, so the same filename cannot be reintroduced accidentally. No
secret value was printed, logged, staged, or committed at any point.

This status carries forward, not replaces, the prior
**BUILD 26 CODE REVIEW COMPLETE**, **BUILD 26 USER-FACING FAMILY PHOTO
COMPLETE**, and **BUILD 26 CROSS-VERTICAL ISOLATION VERIFIED** verdicts
above: the review pass's five defect fixes and one documented
officer-facing gap (Part 5), the completion pass's new entry point, and
the verification pass's Community/Nonprofit isolation evidence all stand
as reported and are unaffected by this credential work — Build 26's own
production code was never touched by any of Parts 15's passes. This
status means: the credential matter is closed, and Build 26 remains ready
for a human reviewer to authorize merging, on the same terms as before —
**not** "ready for store submission." Native build installation and
physical-device verification remain incomplete and are separate required
gates (Parts 10-11); volunteer-shift QR check-in remains fully deferred
(Part 7).

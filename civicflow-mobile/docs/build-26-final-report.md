# Build 26 — final report

Program: "Implement the next controlled mobile release end to end" (camera-
permission correction, PTA student/family progression, optional family-photo
upload, stable mobile UI upgrade, PTA volunteer-hours/QR completion),
followed by a focused independent code-review-and-correction pass. Branch:
`feature/pta-progression-mobile-ui-build26`, based on `main`@`db73f2a` (=
`origin/main` exactly, confirmed via `git merge-base`). Constraint honored
throughout both passes: no merge, push, deploy, build upload, store
submission, production setting change, real payment, or real notification.

**HEAD at time of this report:** `ca1fab17c615f7d3ebfa23e719c34976ca610a03`
(the Part 13 completion pass's closing commit); this report's own Part 14
was produced by a subsequent, narrower verification pass that added tests
and documentation only.
**Working tree:** tracked working tree clean; five untracked paths remain
(`.claude/` — see Part 13/14 for the one flagged file inside it,
`civicflow-portal/docs/operations/`, and three unrelated dated HTML report
files under `docs/`), all confirmed pre-dating the Build 26 program by
roughly 19 hours (Part 14) and none modified by any pass. Earlier drafts
of this report described these as "four" items; Part 14 traces this to a
plain arithmetic error in one sentence, not a real change in the working
tree.
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

## Final status

**BUILD 26 CROSS-VERTICAL ISOLATION VERIFIED — READY FOR INTEGRATION
AUTHORIZATION**

The parent-facing family-photo entry point is discoverable at PTA →
My Family → Family profile card, reusing the existing, unmodified photo
pipeline end-to-end. Authorization remains entirely server-side
(unchanged across every pass); the four-vs-five untracked-item count is
reconciled with independent filesystem evidence (Part 14) — it was always
five, a prose miscount in one earlier report, never a real change in the
working tree. Community/Nonprofit isolation is now explicitly proven with
demonstrably vertical-tagged fixtures on both the mobile screen/dashboard
(4 new tests) and re-confirmed on the server side, where it was already
covered (2 pre-existing backend tests, re-run and passing) — alongside the
previously-verified Church and Union isolation. No isolation defect
existed; zero production code changed in this pass. The Apple-compliant
permission flow remains untouched and unaffected. One pre-existing
untracked file (`.claude/Application Password WP`) remains flagged as a
likely credential, unrelated to this program, unchanged and untouched.

This status carries forward, not replaces, the prior
**BUILD 26 CODE REVIEW COMPLETE** and
**BUILD 26 USER-FACING FAMILY PHOTO COMPLETE** verdicts above: the review
pass's five defect fixes and one documented officer-facing gap (Part 5),
and the completion pass's new entry point, stand as reported and are
unaffected by this verification pass. This status means: ready for a
human reviewer to authorize merging this branch and to schedule the
separately-authorized native-build and device-verification phase — **not**
"ready for store submission." Native build installation and
physical-device verification remain incomplete and are separate required
gates, as set out in Parts 10-11 above. Volunteer-shift QR check-in
remains fully deferred (Part 7, re-confirmed: zero files under its
scope touched by this pass).

# Build 26 — final report

Program: "Implement the next controlled mobile release end to end" (camera-
permission correction, PTA student/family progression, optional family-photo
upload, stable mobile UI upgrade, PTA volunteer-hours/QR completion).
Branch: `feature/pta-progression-mobile-ui-build26`, based on `main`@`db73f2a`
(= `origin/main` exactly at branch creation). Constraint honored throughout:
no merge, push, deploy, build upload, store submission, production setting
change, real payment, or real notification.

Starting commit confirmed and re-verified at every phase boundary:
`fix/import-auth-order-and-format-ui`'s two prior commits (`983c8e2`,
`e92ffd7`) remain byte-identical throughout this program — this work never
touched that branch.

## Phases and commits

| Phase | What | Commit |
|---|---|---|
| A | Discovery: architecture inventory, design notes, test plan (no code) | — |
| B | PTA student/family progression data model + migration (additive: 3 tables, 1 enum-value addition, 2 nullable columns) | `a45d142` |
| C | Progression service (preview/commit/correct/rollback), 8 API routes, 28 service tests + 15 route tests | `d1628ba` |
| D | PTA admin progression UI, dual feature-flag gate (platform + org), 4 flag-gating tests | `f8fb39a` |
| E | Family-photo backend: sharp-based security pipeline (magic-byte detection, decode, EXIF-strip re-encode), dual-audience download route, 36 tests | `019d8ec` |
| F | Family-photo mobile UI + neutral camera/library permission priming, mobile bearer-token bridge route, 22 tests | `7fa0b7f` |
| G | Volunteer-hours/QR investigation — no code change (findings below) | `8fc0216` |
| H | Shared `ActionColors` tokens + `PrimaryActionButton`/`SecondaryLinkButton`, adopted incrementally | `7e9e625` |
| I | Apple Guideline 5.1.1(iv) correction (attendance-scan.tsx) + Info.plist accuracy fix, 6 tests | `6c7d99d` |
| J | This report: full regression, live-DB migration verification, App Review response draft | — |

## Section-by-section outcomes

**1. Apple 5.1.1(iv) correction** — Done. `attendance-scan.tsx`'s
pre-permission screen used directive wording ("Grant Camera Access") and is
now the same neutral Continue/Not-Now pattern used by the new family-photo
screen. A real functional bug was found and fixed alongside the copy: the
"Open Settings" label was previously wired to the no-op `requestPermission`
call rather than `Linking.openSettings()`. Draft App Review response at
`build-26-app-review-response-draft.md`.

**2. PTA student/family progression** — Done. Student (not household) is the
progression unit; multi-student families supported (each `PtaStudent` gets
its own `PtaStudentProgressionRecord`); history is never overwritten
(mirrors the existing `PtaStudentEnrollment` "never overwrite, only add"
convention); org/year scope is always server-resolved from the authenticated
session, never client-supplied. Double-promotion and duplicate-batch
execution are prevented at both the DB level (`@@unique([organizationId,
fromSchoolYearId, toSchoolYearId])`, `@@unique([batchId, studentId])`) and
the app level (required `previewVersion` + `idempotencyKey` on commit,
verified against the batch's live `previewedAt`). Grade progression is
automatic; classroom assignment requires an admin-configured mapping or
becomes `NEEDS_REVIEW` — never guessed.

**3. Optional family-photo upload** — Done, and verified never mandatory
anywhere (no code path requires `photoUrl` to be set). Server-side auth runs
before any request body is read on every route (`Content-Length` check →
`Content-Type` check → `formData()` inside `try/catch`), matching the
auth-before-parse discipline `fix/import-auth-order-and-format-ui`
established. Real upload security: declared 15 MB limit enforced before
touching bytes, magic-byte signature detection independent of the client's
declared content-type, full `sharp` decode (corrupt files rejected before
reaching storage), single re-encode via `.rotate()` (auto-applies then
strips EXIF orientation) with `.withMetadata()` never called (EXIF/GPS/ICC/
IPTC stripped by construction), private non-public storage with a
short-lived (300s) signed download URL, safe replacement (new object
uploaded and committed before the old one is deleted), real soft-delete +
storage-object removal on remove.

**4. Stable mobile UI improvements** — Done, deliberately incremental (see
`mobile-ui-tokens.md`). New `ActionColors` tokens and two shared button
components, adopted by the two screens this program touched
(`pta-family-photo.tsx`, `attendance-scan.tsx`); a real drifted color value
(`#B45309` vs. the standard `#B54708`) was found and fixed in the process.
The other 200+ pre-existing hardcoded occurrences across the rest of the app
are explicitly and deliberately left for incremental follow-up, not
mass-migrated — no auth or payment screen's styling was touched.

**5. PTA volunteer-hours/QR** — Investigated, not built. The directive's
premise (incorrect member-identity gating on "the scanner") did not match
the current architecture: `attendance-scan.tsx`'s member-identity gate is
deliberate and correct (attendance is recorded against an `OrgMember`, which
PTA household adults structurally never have), and the existing volunteer
roster check-in flow was already confirmed correctly PTA-scoped throughout
(`PERMISSIONS.PTA_VOLUNTEERS_CHECKIN`, `selectedOrganization.pta.canCheckIn`
— never a generic member check). A camera-based volunteer-shift QR check-in
does not exist in any partial form; building one to this program's security
bar (signed single-use tokens, replay protection, a second permission-primed
scan screen, a new dual-gated flag) is separately scoped. Per the
directive's own explicit fallback, this is deferred — no flag was
introduced for a feature with no implementation behind it. Full reasoning:
`civicflow-portal/docs/pta-volunteer-shift-qr-checkin-deferral.md`.

## Automated verification

- **civicflow-portal**: `tsc --noEmit` clean, `eslint` clean, `npm run
  check:deps` OK (the new `sharp` dependency introduces no new baseline
  mismatch), `vitest run` — **412 test files passed, 4620 tests passed**
  (31 files / 178 tests pre-existing skips, unrelated to this program), 0
  failures. Includes the full `fix/import-auth-order-and-format-ui`
  regression suite (`.xls` rejection, spoofed extensions, auth-before-parse
  ordering, 413 handling) — confirmed still passing, proving this program
  did not regress that work.
- **civicflow-mobile**: `tsc --noEmit` clean, `expo lint` clean (2
  pre-existing warnings in an unrelated file), `jest` — **70 test suites
  passed, 393 tests passed**, 0 failures.
- **`npm audit`** (civicflow-portal, production deps): 31 pre-existing
  vulnerabilities, all transitive (via `@sentry/webpack-plugin` and
  `exceljs`'s `uuid`/`undici` dependencies), none newly introduced by this
  program and none tracing through `sharp`.

## Live database migration verification

Phase B's migration (`20260902200000_pta_student_progression_foundation`)
was generated via schema-diff (no live DB was reachable at authoring time)
and explicitly flagged as needing live verification later. That
verification was completed in this phase:

- Started the disposable local Postgres cluster (`C:\pgdata-civicflow-dev`,
  port 5433) that this environment already uses for local dev/testing.
- **Empty case**: created a fresh throwaway database and ran `prisma migrate
  deploy` against it — all 124 migrations (the project's entire history,
  including this program's) applied cleanly from nothing.
- **Populated case**: created a full copy of the existing `civicflow_dev`
  database (a real database with real Organization/Meeting/PtaCommittee/
  PtaVolunteerHourEntry/DuesCharge/PaymentReport rows — not empty), found it
  was 3 migrations behind (including this program's), and ran `prisma
  migrate deploy` against the copy — all 3 applied cleanly with zero errors.
  Verified afterward: `PtaStudentProgressionBatch` exists with the correct
  columns/types/defaults, `AttachmentEntityType` contains `PTA_HOUSEHOLD`,
  `PtaHousehold.photoUrl` and `PtaProfile.studentProgressionEnabled` exist
  as nullable/defaulted columns with every pre-existing row unaffected.
- Both throwaway databases were dropped immediately after; the real
  `civicflow_dev` database was never written to (only copied from); the
  scoped connection-string env file used for this check was deleted. The
  Postgres server itself was left running, as found — it's a standing local
  dev resource used across sessions, not something created or torn down for
  this check alone.

This database did not have `PtaStudent`/`PtaSchoolYear` rows populated at
copy time, so the new tables' foreign keys to those tables were verified as
correctly *defined* against the live schema, but not exercised against
actual referenced rows in this pass — the relational logic those FKs
support (grade progression, classroom mapping, idempotent commit) is
covered instead by Phase C's 28 service-layer tests, which exercise it
directly (with a mocked Prisma client, not a live DB).

## Manual device / simulator verification — not performed

Consistent with every prior release pass in this project (see
`device-test-results.md`): **no physical device, iOS Simulator, or Android
emulator is available in this environment** (Windows, no Mac, no configured
emulator). This was not attempted and is not claimed. What substitutes for
it in this report: the automated test suites above (business logic and
component behavior, including every permission-flow branch — granted,
never-asked, denied-and-blocked, cancel — for both camera screens), and the
live-database migration check. Actual on-device rendering, the real iOS/
Android system permission dialogs, and real camera/photo-picker interaction
were not observed directly and remain the required next step before store
submission.

## Build readiness

- `eas.json` uses `appVersionSource: "remote"` with `production.
  autoIncrement: true` — EAS Build resolves the next iOS build number
  (26, following the rejected 25) and Android version code automatically
  at actual build time. There is no local build-number field to hand-edit,
  and per this program's explicit constraint, no build was produced or
  submitted in this pass.
- `app.json`'s camera and photo-library usage strings were corrected to
  describe every real use (see Phase I above) — no unnecessary permission
  was added; both were already required for pre-existing features and are
  now reused, not newly requested, for the family-photo feature.
- Draft App Review response: `build-26-app-review-response-draft.md`.

## What the human owner does next

1. Review this report and the diffs on `feature/pta-progression-mobile-ui-build26`.
2. Run an actual on-device/simulator pass — at minimum, both camera-
   permission screens' three states (never-asked, granted, denied) and the
   full family-photo add/replace/remove flow — before submission.
3. Decide whether to enable `PTA_STUDENT_PROGRESSION_PLATFORM_ENABLED` for
   any organization (defaults off) and separately whether any specific PTA
   org should have `studentProgressionEnabled` turned on.
4. Merge, build, and submit build 26 when satisfied — none of those actions
   were taken in this pass.

## Final status

**BUILD 26 RELEASE PACKAGE READY FOR REVIEW**

Every security, migration, RBAC, privacy, permission-flow, and automated
regression check that can be run in this environment passes. The one
category explicitly not covered — real on-device rendering and system
permission dialogs — is a persistent environmental constraint documented
across every prior release pass in this project, not something new to this
program, and is called out above as the required next step rather than
silently assumed.

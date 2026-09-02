# Spreadsheet Import & Outbound Mail Security Hardening (Security Patch A)

## Why this exists

A dependency-security review of `civicflow-portal` found `xlsx@0.18.5` (SheetJS) carried two unpatched advisories — prototype pollution ([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)) and ReDoS ([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)) — with **no fixed version published to the public npm registry**; `0.18.5` is simultaneously "latest" and "vulnerable." Application-code review confirmed `xlsx` genuinely parsed attacker-uploadable files on three server-side HTTP routes with no content validation beyond a byte-size cap. `nodemailer@7.0.13` separately carried SMTP command/header-injection advisories.

This document covers the fix: `xlsx` removed entirely, replaced by a hardened parsing pipeline; `nodemailer` upgraded with centralized header-injection validation.

## Decision: remove `xlsx` entirely (not isolate it)

`exceljs` was already a direct dependency (used for exports) with no prototype-pollution/ReDoS advisory of its own, and its `workbook.xlsx.load()` API covers everything the app's read paths needed. Isolating `xlsx` in a worker process was considered and rejected: a full replacement was achievable safely, so temporary risk-acceptance wasn't necessary. No SheetJS build was sourced from outside the npm registry — that would be a separate supply-chain decision, out of scope here.

**Important, hard-won lesson from building this:** don't trust a replacement parser blindly just because it lacks a public CVE. Testing ExcelJS's own `workbook.csv.read()` against a column literally named `__proto__` showed it silently corrupts that cell into an empty object internally — evidence of the same class of bug (an unguarded `obj[key] = value` on a plain object literal somewhere in its CSV-specific code path) this whole patch exists to eliminate. CSV parsing was therefore **not** delegated to ExcelJS; it's a small, direct, positional-only state machine in `spreadsheet-parser.ts`. XLSX parsing does use ExcelJS (its XML/ZIP path doesn't have this issue — confirmed separately), but a second real bug was found there too: its *streaming* `WorkbookReader` throws (`this.model` is undefined) on an ordinary multi-sheet workbook — a common real-world shape — so parsing uses the buffered `workbook.xlsx.load()` reader instead, with the ZIP-bomb defense (below) covering the memory risk that streaming would otherwise have avoided.

## Supported formats

| Format | Before | After |
|---|---|---|
| `.csv` | Yes (via `xlsx`) | Yes (hand-rolled RFC-4180 parser) |
| `.xlsx` | Yes (via `xlsx`) | Yes (via `exceljs`, hardened — see below) |
| `.xls` (legacy binary) | Yes (via `xlsx`) | **No longer accepted.** No actively-maintained library with an acceptable security posture was already a dependency, and `.xls` usage is a small, declining share of uploads. Every route now returns a clear message: *"Legacy .xls files are no longer supported. Please re-save the file as .xlsx or .csv and try again."* |
| `.db` / `.sqlite` (desktop migration only) | Unaffected — never went through `xlsx` | Unaffected |
| `.json` (desktop migration only) | Unaffected | Unaffected |

## Architecture

One module, `src/lib/imports/spreadsheet-parser.ts`, is the single entry point every upload route calls (`parseSpreadsheetBuffer(buffer, claimedExtension)`). Nothing else in the app imports a spreadsheet-parsing library directly.

```
Upload routes                    Client (browser)
  /api/imports    (POST)           ImportUploadForm.tsx  ─┐
  /api/import     (POST)           ImportPageClient.tsx  ─┤  no client-side parsing —
  /api/migration/upload (POST)                            │  headers/preview come from
        │                                                  │  the server's preview mode
        ▼                                                  │  (same hardened pipeline)
  spreadsheet-parser.ts  ◄──────────────────────────────────┘
        │
        ├─ detectFormat()            magic-byte sniff, independent of the claimed extension
        ├─ preflightXlsxContainer()  ZIP central-directory walk (xlsx only, no decompression)
        ├─ parseXlsxRows()           exceljs workbook.xlsx.load() + positional row extraction
        └─ parseCsvRows()            hand-rolled RFC-4180 state machine
```

Client-side spreadsheet parsing was removed entirely. `ImportUploadForm.tsx` and `ImportPageClient.tsx` now submit the file to the server for a `preview`-mode response (headers + first 5 rows), the same hardened pipeline the real import uses — this also closes what would otherwise be a second, unhardened copy of the parsing logic running in the browser.

## Validation pipeline (applied to every upload, in order)

1. **Extension allow-list**: only `.csv`/`.xlsx` claimed extensions are accepted at all (`.xls` and anything else rejected with a clear message, before any parsing).
2. **Format/content agreement**: the buffer's actual magic bytes are independently detected and must match the claimed extension — a CSV renamed to `.xlsx`, or a real `.xlsx` renamed to `.csv`, is rejected (`FORMAT_MISMATCH`), not silently parsed as whichever format it actually is.
3. **ZIP structural preflight** (`.xlsx` only, before any decompression):
   - Central directory entry count capped (`maxZipEntries`, 2000).
   - Sum of every entry's *declared* uncompressed size capped (`maxUncompressedBytes`, 500 MB) — the actual zip-bomb defense: a maliciously small file that claims to decompress to gigabytes is rejected from its header alone, without decompressing anything.
   - Any entry with the ZIP encryption bit set is rejected (`ENCRYPTED_ARCHIVE`) — no password-guessing attempted.
   - Any entry name containing `..`, a leading `/`, or a backslash is rejected (`PATH_TRAVERSAL_ENTRY`).
   - A `xl/vbaProject.bin` entry (macro-enabled workbook) is rejected (`MACRO_WORKBOOK`).
   - Any `xl/externalLinks/*` or `xl/connections*` entry (external data connections) is rejected (`EXTERNAL_LINKS`).
   - Total declared sheet-entry count capped (`maxSheets`, 50).
4. **Structural limits during parsing** (both formats, same enforcement points): max rows (50,000), max columns (500), max total cells (2,000,000), max single-cell length (32,767 characters, matching Excel's own real limit).
5. **Header safety**: any header literally named `__proto__`, `prototype`, or `constructor` (case/whitespace-insensitive) is rejected outright (`UNSAFE_HEADER_NAME`). Every row object is additionally built with `Object.create(null)` rather than a `{}` literal, so even a header that somehow evaded the name check could never reassign an object's prototype via `row["__proto__"] = value` — defense in depth, not the only defense. Duplicate normalized headers (`Name` and `name`) are rejected (`DUPLICATE_HEADER`) since column mappings require uniqueness.
6. **Formulas treated as untrusted data**: a formula cell's cached `result` (computed by whatever application last saved the file) is used; the formula text itself is never evaluated and never surfaces as if it were data — a cell with no cached result is treated as blank.
7. **Parse timeout**: 30 seconds, race-condition-safe against the parse promise.

A rejected file produces a specific, safe, pre-written error message (see `SpreadsheetRejectionReason` in `spreadsheet-parser.ts`) — never a raw exception message, stack trace, or file content.

## Upload-route behavior

All three routes preserve their pre-existing permission/organization/rate-limit checks exactly, evaluated **before** the file is ever parsed (an unauthorized caller's file is never touched). The organization ID is always resolved server-side from the authenticated session — never accepted from client input.

- **`/api/imports`** (resumable import engine): gained a `preview=1` mode (mirrors `/api/import`'s existing convention) so the upload form's column-mapping step never parses client-side. A rejected file during the real `analyzeBatch()` worker step now cleanly transitions the batch to `FAILED` (with its own audit event, via the existing `transitionImportBatch()` machinery) instead of leaving it stuck in `ANALYZING` forever — this matters more now than before the patch, since a rejection is an expected, not rare, outcome once real structural limits are enforced.
- **`/api/import`** (legacy generic import): previously fell through to the spreadsheet parser for *any* extension that wasn't `.db`/`.sqlite` — a file named `malware.exe` would have been hand straight to `XLSX.read()`. Now explicitly validates the extension first.
- **`/api/migration/upload`** (desktop migration, `ORG_ADMIN`-only): `.xls` removed from its accepted-extensions list; unexpected parser exceptions are converted to a generic safe message rather than interpolating the raw exception into the response.

No route's rate limiting, permission model, or tenant scoping changed. `/api/import` still has no rate limit of its own — this patch did not add one, since doing so would be a separate, unrelated behavior change outside this patch's scope.

## Nodemailer

**Target**: `nodemailer@7.0.13` → `9.1.1` (skips the `8.x` line; no unpatched advisory affects the `stable createTransport`/`sendMail` API surface this app uses — `host`/`port`/`secure`/`auth.user`/`auth.pass` for the transport, `from`/`replyTo`/`to`/`subject`/`text`/`html`/`attachments` for sending — which has been stable across these majors). Both `7.0.13` and `9.1.1` declare the same `node >= 6.0.0` engine floor; no runtime incompatibility. `@types/nodemailer` bumped `7.0.11 → 8.0.1` (DefinitelyTyped has not published a `9.x`-targeted release; `8.0.1` is the closest available and typechecks cleanly against the app's actual usage).

**Known, investigated, benign side effect**: `next-auth@4.24.15` declares its own `nodemailer: "^7.0.7"` peer expectation (for its optional built-in Email magic-link provider) and now shows as `invalid` under `npm ls`. This application does not use next-auth's Email provider anywhere (`grep` for `next-auth/providers/email` / `EmailProvider` returns nothing in `src/`), and next-auth's own `require("nodemailer")` call lives exclusively inside that unused provider module (`next-auth/providers/email.js`) — never loaded by this app's actual auth configuration. `npm install`/`npm ci` do not hard-fail on peer-dependency mismatches; this is a cosmetic warning, not a functional issue.

### Header-injection hardening

New module `src/lib/mail-header-safety.ts`, wired into `sendEmail()` in `mail.ts` as the very first thing that function does — before the "safe dev mode" log line, before constructing any nodemailer message — so no caller can construct or even log a message carrying an injection payload, and no caller can bypass validation by calling a different code path (there isn't one; `sendEmail()` is the sole send function).

- `assertSafeEmailAddress(field, value)`: rejects CR/LF/NUL/other C0 control characters, and separately validates RFC-5321-ish syntax (reusing the same `isValidEmail()`/Zod schema already used at member-creation/import time). Applied to `to`.
- `assertSafeHeaderValue(field, value)`: rejects the same control-character set (tab excepted — legitimate in folded header continuations). Applied to `subject` and every `attachments[].filename`.
- Violations **reject**, they do not silently strip the offending character — a caller gets a clear `MailHeaderValidationError`, not a message that looks like it sent successfully but was quietly altered.
- Malicious input is never logged. On rejection, only `{ event: "brevo_request_rejected_invalid_header", reason: "<field>: contains a disallowed character" }` is logged — the actual payload text never appears in a log line or audit-event metadata.

`from` (always `env.FROM_EMAIL`) and `replyTo` (always the hardcoded `SUPPORT_EMAIL`) are never attacker-influenced and were not validated further, since they're not user-controlled input at all.

**Residual, accepted risk**: application-code review (part of the underlying dependency-security investigation) found no anonymous/unauthenticated CRLF-injection path — every `to` address entering the system via signup/import/member-creation is already Zod-`.email()`-validated upstream, which rejects whitespace/CR/LF. The one real remaining exposure before this patch was an authenticated staff member's free-text campaign `subject` or organization display name reaching the SMTP `subject` header with only a length cap, no character-set check — now closed by the validation above for every caller, with no exceptions.

## Testing

- `src/lib/__tests__/spreadsheet-parser.test.ts` (31 tests): valid xlsx/csv, multi-sheet handling, formula-as-data, every rejection reason (format mismatch, malformed ZIP, prototype-pollution/duplicate headers, all structural limits, ZIP-bomb/encryption/macro/external-link/path-traversal detection via hand-built minimal ZIP central-directory fixtures — no real exploit payloads or multi-hundred-megabyte files are committed; each fixture is the smallest input that crosses the relevant boundary).
- `src/lib/__tests__/mail-header-safety.test.ts` (13 tests) and the header-injection additions to `src/lib/__tests__/mail.test.ts` (11 tests): normal/Unicode subjects, CR/LF/CRLF/NUL injection attempts, malicious attachment filenames, malicious recipient addresses, confirmation the mocked SMTP transport is never called after a rejection, confirmation malicious input never reaches a log line. All mail tests use a mocked `nodemailer.createTransport` — no test in this patch sends a real email.
- `src/lib/__tests__/import-route.test.ts` (10), `src/lib/__tests__/migration-upload-route.test.ts` (8), and 4 new tests in `src/lib/__tests__/imports-create-route.test.ts`: route-level, running the *real* parser (not mocked) against real small file fixtures, proving the wiring end-to-end — valid imports, spoofed extensions, `.xls` rejection, `__proto__`/duplicate headers, permission-gate-before-parse ordering.
- `src/lib/__tests__/imports-engine-analyze.test.ts` (3): the new clean-`FAILED`-transition behavior in `analyzeBatch()`.
- `src/lib/imports/__tests__/engine.test.ts` (pre-existing, 32 tests): updated to mock `spreadsheet-parser.ts` instead of the removed `xlsx` package (same layering the old mock had — this file tests row-classification/dispatch logic, not parsing correctness, which has its own dedicated suite above) and to include `fileName` in its batch fixtures, matching `engine.ts`'s new signature. No test cases were added, removed, or had their assertions changed.

## Rollback

Application-level: redeploy the prior commit. No schema/migration changes were made by this patch, so no database rollback is needed.

If `nodemailer` or `exceljs` needed to be reverted independently, that's a plain `package.json`/lockfile revert — neither introduced a persistent-state or schema dependency.

## Operator troubleshooting (without logging workbook contents)

A user reporting "my file won't upload" — check, in order, without ever needing to inspect the file's actual cell values:

1. **Extension**: is it `.csv` or `.xlsx`? `.xls` is no longer accepted (ask them to re-save as `.xlsx` or `.csv` in Excel/Sheets: *File → Save As*).
2. **The rejection reason returned in the API response** (`error` field) — every rejection has a specific, human-readable message (e.g. "This file has too many rows and was rejected," "Columns 'Name' and 'name' both map to the same name") that identifies the problem class without needing file content.
3. **Size**: each route's existing byte-size cap (50–100 MB) is checked before this pipeline even runs; a `413`/"File too large" response is a pre-existing, unrelated check.
4. If the reason is unclear from the message alone, ask the user to confirm the file opens correctly in Excel/Sheets/LibreOffice first (rules out local corruption) before escalating — support should never need the file's actual contents to diagnose a rejection class.

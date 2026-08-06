# Resumable Import Program — Row Statuses and Decisions (PR A)

## Row status enum

```
PENDING             — reserved initial value; analyzeBatch() always classifies immediately, so rows are never left PENDING after analysis.
NEW                  — no existing OrgMember matched this row.
EXACT_DUPLICATE      — reserved for PR B. Not produced by any code path in PR A.
POSSIBLE_DUPLICATE   — reserved for PR B. Not produced by any code path in PR A.
UPDATE_AVAILABLE      — an existing OrgMember was matched by exact email.
IMPORTED             — the row's decision was carried out; OrgMember was created or updated.
SKIPPED              — decision was SKIP; no write happened.
INVALID              — missing both first and last name, or an unparseable email.
FAILED               — the OrgMember create/update itself threw (e.g. a database error); the row's errorMessage records why.
BLOCKED_PLAN_LIMIT   — the row was eligible and decided, but capacity ran out before it could be written. See import-resume-and-plan-limits.md.
```

## What PR A actually classifies

Only three outcomes are ever produced by `analyzeBatch()` (`src/lib/imports/engine.ts`) in this PR:

- **`NEW`** — no `OrgMember` in this organization has this row's email.
- **`UPDATE_AVAILABLE`** — an `OrgMember` in this organization already has this exact email. This is the one exact-match rule already live in production today (previously: `src/lib/member-import.ts`'s `importMembers()` silently updated on email match with no review step). PR A **changes that default** to require an explicit decision, per the program's own safe-default table (below) — this is a deliberate, spec-directed behavior change, not an oversight.
- **`INVALID`** — first and last name are both blank, or the mapped email column doesn't parse as a valid email.

`EXACT_DUPLICATE` and `POSSIBLE_DUPLICATE` exist in the schema (so PR B doesn't need a migration to start using them) but no PR A code path ever sets a row to either status. The rest of the matching hierarchy — phone number, name plus a corroborating field, fuzzy matching — is explicitly PR B's job.

## Safe default decisions

Applied by `applyDefaultDecisions()` when a batch moves from `READY_FOR_REVIEW` to `IMPORTING`, to any row an administrator never touched individually:

| Row status | Default decision |
|---|---|
| `NEW` | `IMPORT_NEW` |
| `EXACT_DUPLICATE` | `SKIP` |
| `POSSIBLE_DUPLICATE` | `REVIEW_REQUIRED` (blocks the row — never silently imported) |
| `UPDATE_AVAILABLE` | `REVIEW_REQUIRED` (blocks the row — never silently updated) |
| `INVALID` | no decision needed — already excluded from execution entirely |

Nothing is ever auto-merged. A `REVIEW_REQUIRED` row simply never becomes eligible for `executeBatch()` until an administrator explicitly picks `SKIP`, `UPDATE_EXISTING`, or `CREATE_ANYWAY` via `POST /api/imports/[id]/rows/[rowId]/decide`.

## Decision permission tiers

`IMPORT_NEW`/`SKIP`/`REVIEW_REQUIRED` only require `imports:review`. `UPDATE_EXISTING`/`CREATE_ANYWAY` additionally require `imports:resolve-duplicates` — genuinely deciding what to do with a matched existing record is a higher-authority action than accepting or skipping a brand-new one, mirroring the multi-tier authority pattern already used for HOA Violations (`hoa:violations:review` vs. `hoa:violations:resolve`) and Architectural Requests (`review` vs. `decide`) in `src/lib/rbac.ts`.

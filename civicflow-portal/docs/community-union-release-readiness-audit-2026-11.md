# Community and Union release-readiness audit — 2026-11-18

Status: **Code-review findings; not a production certification.** Source: main branch. No production changes.

## Union: verified code-level controls
- `src/lib/union/cases-guard.ts`: organization capability and active-status gate; staff RBAC; mobile and web member ownership checks.
- `src/app/api/mobile/union/cases/route.ts`: bearer-authenticated member/org resolution; server-derived member ID on create/list.
- `src/app/api/mobile/union/cases/[caseId]/route.ts`: ownership check and organization-scoped case lookup.
- `src/lib/union/cases.ts`: conditional status transitions and audit records; member-safe serializer.
- Tests exist: `src/lib/union/__tests__/cases-tenant-isolation.test.ts`, `src/lib/__tests__/mobile-union-cases-route.test.ts`. **Not executed in this audit.**

## Findings requiring action
1. **P1 — Confidentiality of case notification email.** `cases.ts` includes `updated.title` in email bodies for assignment/status notifications. Case titles may reveal sensitive employment or representation details. Push bodies are generic already. Decide on generic email text or an explicit notification preference, then add a regression test. No exposure confirmed; this is a privacy hardening recommendation.
2. **P2 — Case list recent-update accuracy.** `cases-guard.ts` fetches only the newest 10 comments and then filters private comments in `toMemberSafeUnionCase`. If >10 newer private comments exist, an older public update is not returned. Existing inline comment describes a fallback, but 10 is not exhaustive. Query most recent public comment separately, or use a filtered relation query. Add regression test with 11+ private comments.
3. **P2 — Stale documentation.** `docs/vertical-capability-matrix.md` states Union has no dedicated business logic, contradicted by the shipped Union Case Center and mobile case routes. Refresh matrix and distinguish shared platform modules from Union-specific features.
4. **P2 — Community onboarding.** `docs/vertical-capability-matrix.md` describes generic finish-setup banner rather than Community-specific setup checklist. Validate onboarding for different organization types before declaring launch-ready.
5. **P1 validation gap — live end-to-end verification.** Run isolated staging flows for Union intake, assignment, member visibility, deadlines, reminders, withdrawal, closing, org switching; and Community onboarding, membership, dues, events, payments, RBAC. Use synthetic data, not real member cases.

## Suggested test matrix
| Test | Expected result |
| --- | --- |
| Member A attempts to read member B case | 403 |
| Member from org A accesses org B case | Denied without data |
| Member receives case detail with internal notes | Internal notes absent |
| Union case created through mobile | NEW, not formal grievance |
| 11 private comments after one public comment | Public update still appears |
| Case title contains sensitive text; email notification sent | No sensitive case title in notification |
| Community org accesses Union Case Center | Denied |
| Inactive org attempts case intake | Denied |
| Community member dues/payment and event attendance | Correct tenant, permissions and reconciliation |

## Release gate
Do not merge or publish based on this audit alone. Resolve P1 confidentiality recommendation, run automated tests, confirm staging authorization/tenant isolation, and separately review iOS/Android EAS builds.

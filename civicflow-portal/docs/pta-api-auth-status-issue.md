# PTA household API routes return 500 instead of 401 for unauthenticated requests

**Status**: documented, not fixed. Does not block pilot preparation (see "Does this block pilot testing?" below). Recommended branch: `fix/pta-api-auth-status`.

## Summary

Any unauthenticated (no valid session) direct request to one of the 15 affected API routes returns HTTP `500` with a generic `[api-route] Unhandled error` instead of a clean `401`. Discovered during dormant-deployment smoke testing 2026-08-28.

## Root cause

`requirePtaHouseholdSelfAccess()` (`src/lib/labs/pta/guard.ts:108`) calls `requireOrganization()` (`src/lib/auth-guards.ts:99`) with no arguments, which defaults to `onFail: "redirect"`. On no session, `requireOrganization` calls Next.js's `redirect("/login")` — a function that works by *throwing* a special `NEXT_REDIRECT` error, designed to be caught by Next.js's own page-rendering machinery. Called from inside a Route Handler instead of a Server Component, that throw is caught by `withApiErrorHandling`'s generic catch-all instead, producing a sanitized-but-generic 500.

**This is not a new class of bug in this codebase.** `requireOrganization`'s own docstring documents that it already fixed exactly this problem once before (GitHub issue #41) by adding the `onFail: "redirect" | "throw"` parameter — every other API-route caller of `requireOrganization` in the codebase already passes `"throw"`. `requirePtaHouseholdSelfAccess` is the one guard that never adopted that parameter, because it has always been called with the implicit default.

## Why `redirect()` is used inside API-route execution

Not a deliberate choice — `requirePtaHouseholdSelfAccess()` was written once and reused by both the (nonexistent, see below) page-component case and every Route Handler that needs "is this session linked to a PTA household" without a specific RBAC permission. It never received the same dual-mode treatment `requireOrganization` itself already has.

## Affected routes (14, all confirmed exact call sites — grep-verified, not inferred)

- `POST /api/labs/pta/events/[eventId]/rsvp`
- `GET/POST /api/labs/pta/my/documents`
- `GET /api/labs/pta/my/documents/[attachmentId]/download`
- `GET/POST /api/labs/pta/my/elections`
- `GET /api/labs/pta/my/elections/[electionId]/results`
- `POST /api/labs/pta/my/elections/[electionId]/vote`
- `GET /api/labs/pta/my/governance/[documentId]/download`
- `GET/POST /api/labs/pta/my/handoff`
- `GET/POST /api/labs/pta/my-household`
- `GET /api/labs/pta/my-household/dues`
- `POST /api/labs/pta/my-household/dues/report-payment`
- `GET /api/labs/pta/my-household/volunteer-hours`
- `GET /api/labs/pta/volunteers/my-commitments`
- `POST /api/labs/pta/volunteers/slots/[slotId]/claim`
- `POST /api/labs/pta/volunteers/slots/[slotId]/cancel`

Plus every route behind `requireVolunteerHoursHouseholdAccess()` (`volunteer-hours/guard.ts`), which itself calls `requirePtaHouseholdSelfAccess()` internally — the 9 `my-household/*` volunteer-hours routes (`summary`, `report`, `report/export`, `quote`, `election`, `disputes`, `checkout`, `assessments`, `assessments/[chargeId]/checkout`).

**No page/Server Component in the codebase calls `requirePtaHouseholdSelfAccess()` directly** — grep-verified. One file (`src/app/labs/pta/layout.tsx`) mentions it only in a comment, referencing "the convention," not an actual call. This matters for the fix design below.

## Does this block pilot testing?

**No.** Confirmed by tracing the guard's control flow: the `redirect()`-triggered 500 fires *only* on the fully-unauthenticated path (no session at all). Once a session exists, `requirePtaHouseholdSelfAccess()` throws proper `PtaError`s (`PTA_NOT_A_HOUSEHOLD_MEMBER`, `PTA_HOUSEHOLD_INACTIVE`), both mapped to a clean `403` by `withApiErrorHandling`'s existing `PtaError` branch — already correct. An authenticated pilot household member hitting any of these routes gets the correct behavior today. This issue only affects bots, logged-out visitors, and direct/unauthenticated probing — exactly the traffic pattern this session's own smoke tests generated.

## Can any data be exposed?

**No.** Read `src/lib/api-route.ts`'s generic catch-all directly: in production (`NODE_ENV === "production"`), the response body is always `{ ok: false, error: "Something went wrong on our end... reference: <8-char-id>" }` — never the raw error message, never a stack trace, never the `NEXT_REDIRECT` internals. The only non-public-facing side effect is `Sentry.captureException(error, ...)` plus a `console.error` — which is itself the next finding.

## Unnecessary error monitoring

**Yes.** Every unauthenticated hit on any of the 15 routes files a Sentry exception and a `console.error` log line for what is, semantically, a completely ordinary "not logged in" response. At any nonzero rate of bot/scanner/logged-out traffic against these paths, this pollutes error monitoring with false-positive "Unhandled error" alerts, which could mask a real regression (or trigger alert fatigue) during the pilot's own monitoring window.

## Safest shared correction

One-line change, single call site, zero risk to existing behavior:

```ts
// src/lib/labs/pta/guard.ts, inside requirePtaHouseholdSelfAccess()
export async function requirePtaHouseholdSelfAccess() {
  const { organizationId, session } = await requireOrganization("throw");
  // ...unchanged below
}
```

Because **no page component calls this function** (confirmed above), there is no caller to preserve `redirect()` behavior for — the fix does not need `requirePtaHouseholdSelfAccess` to grow its own `onFail` parameter the way `requireOrganization` has one; it can simply always pass `"throw"`. If a future page component ever needs the linkage check, it should call `requireOrganization()` (default redirect mode) directly plus its own household lookup, or a new dual-mode variant should be added at that time — not by regressing this fix.

`requireOrganization("throw")` on no session throws `UnauthenticatedError` (`status = 401`), already handled cleanly by `withApiErrorHandling`. No other change needed — `PtaError` throws downstream in the same function already map to 403 correctly today.

## Regression tests required

Add to `src/lib/labs/pta/__tests__/guard.test.ts` (new `describe("requirePtaHouseholdSelfAccess")` block, mirroring the existing style in that file and in `volunteer-hours/__tests__/guard.test.ts`):

1. No session → rejects with `UnauthenticatedError` / `status: 401` (not a thrown `NEXT_REDIRECT`, not a call to `redirect()` — assert the mocked `redirect` from `next/navigation` is never invoked).
2. Session exists, no organization on session → rejects with `OrganizationRequiredError` / `409` (via `requireOrganization("throw")`'s existing second branch — confirm it still fires correctly through this call site).
3. Session + org, but no linked `PtaHouseholdAdult` row → rejects with `PtaError` `PTA_NOT_A_HOUSEHOLD_MEMBER` / `403` (unchanged behavior, regression-guard only).
4. Session + org, household `status !== "ACTIVE"` → rejects with `PTA_HOUSEHOLD_INACTIVE` / `403` (unchanged, regression-guard only).
5. Valid household adult → resolves normally (unchanged, regression-guard only).

At the route level, extend `pta-profile-route.test.ts`'s established pattern (or a new file) with at least one representative route from the affected list (e.g. `my-household/route.ts`) asserting the actual HTTP `Response.status` is `401` for no session, end to end through `withApiErrorHandling` — not just that the guard function throws the right error class, since the goal is the real HTTP contract, not just the intermediate exception type.

## Recommended process

Branch `fix/pta-api-auth-status` off `main` (current tip `595eda9`), one commit: the guard change + the tests above. Run full suite/typecheck/lint/build per this program's established gate. This is a small, low-risk, well-isolated fix — appropriate to land whenever convenient, independent of pilot timing, but per the pilot-preparation authorization it is **not implemented now**.

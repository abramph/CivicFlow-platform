# Fictional Demo Environment & Platform Administrator Impersonation

Two permanent, reusable internal tools: a fictional PTA (and non-PTA) demo
environment, and a secure way for a Platform Administrator to experience the
product exactly as any real member does. Both are intended for demos, QA,
and support across **all** current and future verticals — neither is
PTA-specific in mechanism, only in today's seed data.

## 1. Demo organizations

### Pine Grove School PTA (`pine-grove-school-pta`)

The primary fictional PTA, enrolled in `ptaVertical`. Covers, deliberately,
one scenario per household so every screen has real (fictional) data to
show rather than a single repeated happy path:

| Household | Scenario |
|---|---|
| The Morgan Household | Current dues paid |
| The Kim Household | Dues unpaid (2 students) |
| The Chen Household | A payment reported by the parent, pending officer review |
| The Osei Household | Dues waived (financial hardship, with a recorded adjustment) |
| The Patel Household | Prior school year (2025-2026) fully paid, in addition to the current year |
| The Whitfield Household | No students on file |

Also seeded: 5 officers (President/ORG_OWNER, VP/ORG_ADMIN,
Treasurer/FINANCE, Secretary/STAFF, a general READ_ONLY member — all with
password `PtaDemo!Change1`), 6 grades, 3 teachers, 3 classrooms, 4
committees (3 active + 1 "concluded"), 2 events with RSVPs, 2 volunteer
opportunities (one partially filled, one fully claimed, plus a third
entirely empty opportunity), 1 fundraising campaign with a contribution, 3
announcements (sent / scheduled / canceled), 2 fictional document records
(bylaws, budget), 1 approved meeting-minutes document, and 2 payment
reports (1 pending, 1 approved).

### Riverdale Community Association (`riverdale-community-association`)

A second, **non-PTA** organization — deliberately **not** enrolled in any
Labs feature — used to verify that impersonation, organization switching,
and tenant isolation all work correctly across a completely different
vertical, not just across two PTAs. Has its own director, member, dues
charge, event, and announcement. Pine Grove's President (Alex Morgan) is
also a STAFF-role member here, giving one fictional identity real,
different roles in two unrelated organizations — the cross-organization
test case.

### Creating / refreshing the demo data

```bash
cd civicflow-portal
npx tsx prisma/seed-pta-demo.ts
```

Safe to re-run at any time (idempotent — every row is created via
find-or-create/upsert keyed on stable ids or unique constraints). Point
`DATABASE_URL` at a disposable/local database before running this —
**never** run it against production. It never touches any organization
other than the two it creates.

## 2. Platform Administrator impersonation

### What it does

From `/admin/platform/organizations/[organizationId]`, a SUPER_ADMIN can
search/filter that organization's active members and click **Impersonate**
next to one. This immediately makes every part of the product — every
page, every permission check, every Labs-enrollment check — behave exactly
as if that user had signed in themselves. A persistent amber banner
("You are impersonating {name} in {organization}. Return to Platform
Admin.") is always visible, on every page, for the duration.

### Architecture — why it's safe

The signed JWT (`token.userId`) is **never** rewritten to represent the
target user. It always remains the real admin's id for the life of the
browser session. Impersonation is an *overlay* applied inside
`authOptions.ts`'s `session()` callback (`src/lib/impersonation.ts`),
driven by a small httpOnly cookie (`cf_impersonation`). Because every
existing authorization guard (`requireOrganization`, `requirePermission`,
`requireSuperAdmin`, ...) reads from the *session* object that callback
produces — never from the raw token — they all automatically operate on
the impersonated identity with **zero code changes to any of them**.

The critical safety property is `resolveImpersonationOverlay()`: it
re-validates, on **every single session read** (not just when impersonation
starts), that:

1. The cookie's claimed `actorUserId` matches the REAL, JWT-signed
   `token.userId` for this request (a cookie can't be replayed under a
   different account).
2. The cookie is younger than a hard 4-hour cap.
3. The REAL identity still holds `PlatformAccess` (SUPER_ADMIN) — a
   mid-session revocation takes effect on the very next request.
4. The target user still has an **active** `OrganizationMembership` in the
   **pinned** organization, and that organization is still `active`.

Any single failure returns `null` — silently falling back to the real,
non-impersonated identity — never "fails open." Because this function only
ever *reads* the cookie (never writes/clears it), it's safe to call from a
plain Server Component render, where Next.js forbids mutating cookies.

`hasPlatformAccess`/`platformRoles`/`permissions` are recomputed fresh for
the **target** user inside the overlay, so no platform-admin ability ever
leaks into an impersonated session — an impersonated PTA president has
exactly a PTA president's permissions, nothing more. Labs enrollment
(`getOrganizationLabAccess`) was already keyed purely off
`organizationId` with no awareness of the caller's identity at all, so it
requires no changes to behave correctly under impersonation: dropping into
an unenrolled organization simply shows no PTA nav, exactly as it would for
that user directly.

Nested impersonation (calling start while already impersonating) is
rejected as an emergent property of the design, not a separate check: while
impersonating, `getServerSession()` resolves `hasPlatformAccess` for the
**target** (an ordinary member), so `requireSuperAdmin()` at the start
route correctly returns 403.

### Exiting

One click ("Return to Platform Admin") calls `POST
/api/admin/impersonate/stop`, which clears the impersonation cookie and
restores the admin's own `cf_active_org` cookie to whatever it was
immediately before impersonation began (captured at start) — the admin
lands back where they were, not wherever the target last happened to be
browsing.

### Audit logging

Every start and stop is written to the existing `AuditEvent` log (no new
table) via `createAuditEvent()`:

- `platform.impersonation.started` — organization, real admin (actor),
  target user/email/display name, reason (optional), source IP
  (`getClientIp()`).
- `platform.impersonation.ended` — the same `entityId` (a random session
  id correlating the pair), plus `durationMs` computed directly from the
  cookie's own `startedAt`.

View history at `/admin/platform/impersonation` (a dedicated, filtered
view over these two actions) or the full `/admin/platform/audit` log.

### Multi-organization & Labs behavior

- Organization switching works unmodified during an impersonated session:
  `/api/organization/select` resolves `session.userId` (the target, via
  the overlay) and re-validates against **that user's own** real
  memberships, exactly as it would outside impersonation.
- A Platform Admin impersonating a user in an organization with no
  `ptaVertical` enrollment gets no PTA nav entry and no PTA access —
  verified directly by Labs access resolution never having depended on
  caller identity in the first place.

## 3. Security safeguards summary

| Risk | Mitigation |
|---|---|
| Non-admin forges the impersonation cookie for themselves | Every session read re-verifies the REAL `token.userId` still holds `PlatformAccess`; a non-admin's overlay resolves to `null` |
| Cookie replayed under a different logged-in account | `payload.actorUserId` must equal the current request's real `token.userId` |
| Platform-admin ability leaking into the impersonated view | `hasPlatformAccess`/`platformRoles`/`permissions` recomputed for the TARGET inside the overlay, never inherited |
| Forgotten/stale impersonation session | Hard 4-hour cookie cap, re-checked server-side (not just cookie expiry) |
| Mid-session revocation, deactivation, or org suspension | Re-checked on every request, not cached |
| Nested impersonation | Rejected automatically — `requireSuperAdmin()` sees the target's (non-admin) access while impersonating |
| Audit trail attribution during exit | The "ended" event uses the actor id captured in the cookie at start, not whichever identity the ambient session currently resolves to |

## 4. Known limitations

- `PtaCommittee` has no `archived`/status field in the current schema — the
  "concluded" committee scenario is simulated via naming/description only,
  not a real lifecycle state. A genuine archive flag would need a
  migration, out of scope here.
- `CommunicationCampaignStatus` has no literal `SCHEDULED` or `ARCHIVED`
  value — the demo uses `READY` + a future `scheduledFor`, and `CANCELED`,
  as the closest real equivalents.
- The fictional "documents" (bylaws, budget) are `Attachment` **metadata
  only** — no real file bytes exist behind `objectKey`, and no PTA-specific
  document UI reads them yet (the existing Documents page is still an
  honest placeholder; see `docs/pta-officer-ui-integration.md`).
- Impersonation has no time-remaining indicator in the banner itself
  (only a hard server-side cutoff) — a visible countdown would be a
  reasonable follow-up.
- No dedicated automated Playwright/Cypress walkthrough was run this
  session for the impersonation UI (picker → impersonate → banner → exit)
  — validated instead via 18 targeted unit/integration tests covering the
  overlay logic, the start/stop routes, and the session-callback
  integration, plus a manual code review of the picker and banner
  components against the same API contracts.

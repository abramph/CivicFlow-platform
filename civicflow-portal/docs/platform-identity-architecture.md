# Platform identity architecture

Unestra has two independent authorization systems that are easy to conflate
but must never be merged: **organization authorization** (what a user can do
within one tenant they belong to) and **platform authorization** (whether a
user is a platform operator, with access to `/admin/platform` and friends,
regardless of which organization — if any — they belong to). This doc
describes both, the boundary between them, and how to bootstrap a new
platform administrator.

## Platform Identity

"Platform Identity" is the umbrella term for a user's platform-operator
status. It is:

- **Global** — not scoped to any organization, not affected by which
  organization is the user's active session org.
- **Independent of `OrganizationMembership`** — a user can hold platform
  identity with zero organization memberships, and a user with an
  `ORG_OWNER` membership on ten organizations has zero platform identity
  unless separately granted.
- **Resolved fresh on every request** — never cached in the signed JWT, so a
  revocation takes effect on the affected user's very next request rather
  than waiting for token rotation.

Platform Identity is carried entirely by the `PlatformAccess` model. There is
no other source of it anywhere in the codebase.

## PlatformAccess

```prisma
model PlatformAccess {
  id          String               @id @default(cuid())
  userId      String
  role        PlatformRole         // currently: SUPER_ADMIN
  status      PlatformAccessStatus // ACTIVE | SUSPENDED | REVOKED
  grantedAt   DateTime
  grantedById String?
  revokedAt   DateTime?
  revokedById String?
  reason      String?
  ...
  @@unique([userId, role])
}
```

- One row per `(userId, role)` pair — a user can hold at most one `ACTIVE`
  grant per platform role, enforced structurally by the unique constraint,
  not just in application code.
- Revocation and suspension **flip `status`**, they never delete the row —
  grant history is preserved for audit rather than erased.
- `src/lib/platform-access.ts`'s `getPlatformAccessForUser(userId)` is the
  only reader: it filters `status: "ACTIVE"` and selects only `role` — a
  suspended/revoked grant is invisible, and no other field (id, reason,
  grantedBy, timestamps) is ever exposed to the session or client.
- Provisioned exclusively through the internal CLI
  (`npm run platform-admin:grant|revoke|suspend`, backed by
  `src/lib/platform-admin-cli.ts`) — no public API route, no client import,
  requires direct server/filesystem access. The Users & Roles UI cannot
  grant it; `SUPER_ADMIN` has never been in its assignable-role list.

## OrganizationMembership

```prisma
model OrganizationMembership {
  id             String
  organizationId String
  userId         String
  role           OrgRole // ORG_OWNER | ORG_ADMIN | FINANCE | STAFF | READ_ONLY | MEMBER | SUPER_ADMIN (legacy, see below)
  status         OrganizationMembershipStatus
  @@unique([organizationId, userId])
}
```

`OrganizationMembership` carries **only** tenant-scoped permissions —
what a user can read/write within one specific organization. It has no
bearing on platform authorization, full stop. See *Organization
authorization flow* below for exactly how a role becomes a permission set.

`OrgRole.SUPER_ADMIN` is a **retired, legacy value**. It still exists in the
enum (see *Why `SUPER_ADMIN` wasn't dropped from `OrgRole`* below) but:

- No membership should ever be assigned it going forward — the Users &
  Roles UI's assignable-role list excludes it entirely.
- Application code treats it as exactly equivalent to `ORG_OWNER` — same
  permission set, same rank, same nothing-extra. See `src/lib/rbac.ts`.
- It confers **zero** platform-wide reach. A user cannot become a platform
  administrator by any `OrganizationMembership` row, no matter the role.

## Tenant boundaries

Every organization-scoped table carries `organizationId` (or reaches it
transitively via a scoped foreign key). `requireOrganization()` /
`requireRole()` / `requirePermission()` (`src/lib/auth-guards.ts`) derive
`organizationId` exclusively from the server session's resolved active
organization — never from client input — and every query in an org-scoped
route filters by it. This is unchanged by anything in this document: platform
identity does not create a backdoor across tenant boundaries. A platform
administrator with no real membership in Organization B is redirected to
`/onboarding/organization` when they try to use a tenant-scoped page for B,
exactly like anyone else with no membership there (see
`platform-tenant-isolation.test.ts`).

**APH Technologies, LLC** — the organization used to bootstrap the first
platform administrator — is not special at the data layer. It is a normal
`Organization` row like any customer org. Its owner's elevated reach comes
entirely from a separate `PlatformAccess` grant, not from anything about
that organization or their `ORG_OWNER` membership in it.

## Platform authorization flow

```
Request → requireSuperAdmin()/requirePlatformRole(role)
            → getServerSession()               (must be authenticated)
            → getPlatformAccessForUser(userId)  (fresh DB read, status: ACTIVE only)
            → hasPlatformRole(access, role)     (in-memory check)
          → { userId, userEmail } or 403/redirect
```

Defined in `src/lib/auth-guards.ts`. Deliberately **not** built on
`requireRole()`/`requireOrganization()` — those require an active
organization membership, which platform access must never depend on. Every
route under `/admin/platform*` and `/api/admin/sms/*` calls
`requireSuperAdmin()` and nothing else.

## Organization authorization flow

```
Request → requireOrganization()/requireRole()/requirePermission()
            → getServerSession()                          (must be authenticated)
            → session.organizationId / session.role        (from the resolved active org)
            → getEffectivePermissions(organizationId, role) (org override, or rbac.ts default)
          → { session, organizationId, role, can } or /onboarding/organization, 403/redirect
```

Defined in the same file, entirely separate code path. `can(permission)` is
a plain membership check against the effective permission set — there is no
role-based bypass anywhere in this path (there used to be one for the legacy
`SUPER_ADMIN` org role; it was removed as part of the Global Platform Access
migration once platform authorization no longer needed org membership as a
carrier).

## Bootstrap process for new platform administrators

There is no UI for this by design. To grant platform access to a new
administrator:

```
npm run platform-admin:grant -- <email> --reason "..." [--granted-by <email>] [--yes]
```

Requires direct server/filesystem access (CI/deploy environment or a
maintainer's machine with production `DATABASE_URL`). The command:

1. Resolves the target user by exact email — refuses if not found.
2. Refuses a duplicate `ACTIVE` grant for the same role (no silent no-op,
   no accidental double-grant).
3. Re-activates a previously `REVOKED`/`SUSPENDED` grant rather than
   creating a duplicate row.
4. Requires `--reason` (a short justification) and either `--yes` or an
   interactive confirmation before writing anything.
5. Records a `platform_access.granted` `AuditEvent` (`organizationId: null`)
   on every successful grant.

`revoke`/`suspend` follow the identical shape. `--dry-run` performs zero
writes for any of the three commands.

The very first platform administrator (this deployment: `abramph1@me.com`)
was bootstrapped by the `20260717013000_add_platform_access` migration's
guarded backfill, which copied the one pre-existing `SUPER_ADMIN`
`OrganizationMembership` into a `PlatformAccess` row exactly once. That
migration has already run in production and will not run again — any
*subsequent* platform administrator is provisioned exclusively via the CLI
above.

## Why `SUPER_ADMIN` wasn't dropped from `OrgRole`

Evaluated and deliberately deferred, not forgotten. Postgres has no native
`DROP VALUE` for enums — removing one requires recreating the entire type
(new type without the value, `ALTER COLUMN ... USING`, drop old type,
rename) across every column that uses it (`OrganizationMembership.role` and
`OrgRolePermissionSet.role`). That's a materially riskier migration than
anything else described in this document, for a value that — once no
membership carries it and no code path treats it as elevated (both true as
of the Global Platform Access migration) — has zero functional or security
effect on its own. Revisit only as part of a dedicated, low-traffic
schema-cleanup release, not bundled with unrelated work. See the comment
directly above `enum OrgRole` in `prisma/schema.prisma`.

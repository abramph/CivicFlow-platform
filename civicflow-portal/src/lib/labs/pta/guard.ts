import { requireOrganization, requirePermission } from "@/lib/auth-guards";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import { prisma } from "@/lib/prisma";
import type { Permission, Role } from "@/lib/rbac";
import { PtaError } from "./errors";

/**
 * PTA/PTO is a first-class vertical (PR #40) — the sole authoritative gate
 * for core PTA functionality is `Organization.primaryVertical === "PTA"`
 * plus the organization being active. The old `ptaVertical` Labs enrollment
 * is retired and no longer consulted for access (see
 * docs/pta-access-architecture.md and docs/labs-feature-lifecycle.md).
 * Throws a precise, distinguishable error rather than one generic denial —
 * a real requirement surfaced by this graduation work (Phase 17): callers
 * (and the humans reading error messages) need to tell "this org was never
 * PTA" apart from "this org is PTA but currently suspended."
 */
export async function requirePtaVertical(organizationId: string): Promise<{ primaryVertical: string; status: string }> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true, status: true },
  });
  if (!organization || organization.primaryVertical !== "PTA") {
    throw new PtaError("PTA_ORGANIZATION_NOT_PTA_VERTICAL", "This organization is not a PTA/PTO organization.");
  }
  if (organization.status !== "active") {
    throw new PtaError("PTA_ORGANIZATION_INACTIVE", "This organization is not currently active.");
  }
  return organization;
}

/** Non-throwing form of requirePtaVertical, for call sites that render their
 * own "not available" messaging rather than letting an error propagate
 * (mirrors the old getOrganizationLabAccess(...).available check pattern
 * these replace). */
export async function checkPtaVerticalAvailable(organizationId: string): Promise<{ available: boolean }> {
  try {
    await requirePtaVertical(organizationId);
    return { available: true };
  } catch {
    return { available: false };
  }
}

/**
 * The composed guard every officer-facing PTA route/page must call first:
 * tenant RBAC permission (organization-scoped, session-resolved) AND the
 * PTA vertical check above. Mirrors meeting-intelligence/guard.ts's
 * requireMeetingIntelligenceAccess() in shape, but Meeting Intelligence
 * remains a genuine Labs feature — this no longer touches Labs at all.
 */
export async function requirePtaAccess(permission: Permission) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  await requirePtaVertical(organizationId);
  return { organizationId, session, role };
}

/**
 * PTA Vertical 2.0, PR PTA-E — the concerns guard. Entry requires
 * pta:concerns:view (nothing below ORG_ADMIN holds it by default), and the
 * returned viewer carries every concern capability the concerns lib needs to
 * make its per-case decisions — including the restricted-case assignment
 * check, which NO permission can bypass (see labs/pta/concerns.ts).
 */
export async function requireConcernAccess() {
  const { organizationId, session, can } = await requirePermission("pta:concerns:view", "throw");
  await requirePtaVertical(organizationId);
  return {
    organizationId,
    session,
    viewer: {
      userId: session.userId,
      userEmail: session.userEmail,
      canView: true,
      canManage: can("pta:concerns:manage"),
      canAssign: can("pta:concerns:assign"),
      canResolve: can("pta:concerns:resolve"),
    },
  };
}

/** Page-component variant (redirect mode) — pages should render their own
 * "not available" messaging on denial, not throw an unhandled error. */
export async function getPtaPageGate(permission: Permission) {
  const { organizationId, session, role, can } = await requirePermission(permission);
  let available = true;
  try {
    await requirePtaVertical(organizationId);
  } catch {
    available = false;
  }
  return { organizationId, session, role, can, access: { available } };
}

/**
 * Parent/household-adult self-service guard — deliberately NOT built on
 * requirePermission()/canDo() (a MEMBER-role user always holds zero
 * permissions — see rbac.ts). Authorization here comes from the caller
 * actually being a linked PtaHouseholdAdult in the active organization, not
 * from any role/permission grant.
 *
 * Requires the linked household's status to be ACTIVE, and (as of PR #40)
 * the organization's primaryVertical to be PTA — previously this required a
 * separate, independent Labs enrollment, which meant disabling/never-setting
 * that Labs row could silently strand a real PTA parent even though their
 * organization's primary vertical was correctly PTA.
 */
export async function requirePtaHouseholdSelfAccess() {
  const { organizationId, session } = await requireOrganization();
  await requirePtaVertical(organizationId);

  const adult = await prisma.ptaHouseholdAdult.findFirst({
    where: { organizationId, userId: session.userId },
    include: { household: { select: { id: true, status: true } } },
  });
  if (!adult) {
    throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Your account is not linked to a PTA household in this organization.");
  }
  if (adult.household.status !== "ACTIVE") {
    throw new PtaError("PTA_HOUSEHOLD_INACTIVE", "Your household's PTA membership is not currently active.");
  }

  return { organizationId, session, adult };
}

/**
 * PTA Vertical 2.0, PR PTA-B — committee-scoped chair authorization.
 * A committee chair/co-chair gets management access to THEIR OWN committee
 * without holding pta:committees:manage (and typically without any staff
 * role at all) — linkage-based like requirePtaHouseholdSelfAccess above,
 * never a Permission grant, so it can't leak into any other surface.
 *
 * Resolution order: real permission first (officers keep full authority over
 * every committee), then chair/co-chair linkage pinned to this one
 * committeeId. `isChairOnly` tells the route to hold the caller to the
 * chair-scoped field whitelist (updatePtaCommitteeAsChair) rather than the
 * full update surface.
 */
export async function requireCommitteeManageOrChair(committeeId: string) {
  const { organizationId, session, can } = await requireOrganization();
  await requirePtaVertical(organizationId);

  if (can("pta:committees:manage")) {
    const committee = await prisma.ptaCommittee.findFirst({ where: { id: committeeId, organizationId }, select: { id: true } });
    if (!committee) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");
    return { organizationId, session, isChairOnly: false as const };
  }

  const chairedCommittee = await prisma.ptaCommittee.findFirst({
    where: {
      id: committeeId,
      organizationId,
      OR: [{ chair: { userId: session.userId } }, { coChair: { userId: session.userId } }],
    },
    select: { id: true },
  });
  if (!chairedCommittee) {
    throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Only this committee's chair or co-chair (or an officer) can manage it.");
  }
  return { organizationId, session, isChairOnly: true as const };
}

/** Non-throwing chair check for page rendering — is this signed-in user the
 * chair or co-chair of this committee? */
export async function isCommitteeChair(organizationId: string, userId: string, committeeId: string): Promise<boolean> {
  const committee = await prisma.ptaCommittee.findFirst({
    where: { id: committeeId, organizationId, OR: [{ chair: { userId } }, { coChair: { userId } }] },
    select: { id: true },
  });
  return Boolean(committee);
}

export interface PtaOrganizationAccessContext {
  organizationId: string;
  /** The raw stored Organization.primaryVertical — not reconciled against
   * anything, since PR #40 removed the need for reconciliation entirely. */
  primaryVertical: string;
  organizationStatus: string;
  /** Whether the caller resolves as an officer (has a real
   * OrganizationMembership), a household parent (PtaHouseholdAdult link),
   * both, or neither. */
  identity: {
    isOfficer: boolean;
    officerRole: Role | null;
    officerPermissions: Permission[];
    isHouseholdAdult: boolean;
    householdId: string | null;
    householdStatus: string | null;
  };
  /** True only when primaryVertical === "PTA" and the organization is
   * active — the single authoritative answer this whole context exists to
   * compute once, so no route has to recreate the logic itself. */
  effectivePtaAccess: boolean;
  /** Any Labs features (genuinely experimental ones, e.g. Meeting
   * Intelligence) enabled for this organization — informational only, never
   * a gate for core PTA functionality. */
  enabledLabFeatures: string[];
}

/**
 * The one server-side PTA access resolver (Phase 5) — computes every fact a
 * PTA-aware surface might need about the caller's relationship to an
 * organization, in one place, so routes never independently recreate PTA
 * eligibility logic. Read-only; never throws — callers that need a hard
 * gate should use requirePtaAccess/getPtaPageGate/requirePtaHouseholdSelfAccess
 * above, which are unaffected by this function's existence.
 */
export async function getPtaOrganizationAccessContext(
  organizationId: string,
  userId: string
): Promise<PtaOrganizationAccessContext> {
  const [organization, membership, adult, labFeatures] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { primaryVertical: true, status: true } }),
    prisma.organizationMembership.findFirst({
      where: { organizationId, userId, status: "active", role: { not: "MEMBER" } },
    }),
    prisma.ptaHouseholdAdult.findFirst({
      where: { organizationId, userId },
      include: { household: { select: { id: true, status: true } } },
    }),
    prisma.organizationLabFeature.findMany({ where: { organizationId, status: "ENABLED" }, select: { featureKey: true } }),
  ]);

  const primaryVertical = organization?.primaryVertical ?? "COMMUNITY";
  const organizationStatus = organization?.status ?? "active";
  const effectivePtaAccess = primaryVertical === "PTA" && organizationStatus === "active";

  let officerPermissions: Permission[] = [];
  if (membership) {
    const { getEffectivePermissions } = await import("@/lib/role-permissions");
    officerPermissions = await getEffectivePermissions(organizationId, membership.role as Role);
  }

  return {
    organizationId,
    primaryVertical,
    organizationStatus,
    identity: {
      isOfficer: Boolean(membership),
      officerRole: (membership?.role as Role) ?? null,
      officerPermissions,
      isHouseholdAdult: Boolean(adult),
      householdId: adult?.household.id ?? null,
      householdStatus: adult?.household.status ?? null,
    },
    effectivePtaAccess,
    // Retired ptaVertical rows are excluded from this list at the registry
    // level (see labs/registry.ts) — anything remaining here is a genuine
    // experimental Labs feature (Meeting Intelligence, etc.), never PTA
    // itself.
    enabledLabFeatures: labFeatures.map((f) => f.featureKey),
  };
}

/** Historical/diagnostic only — never used as a gate. Lets Platform Admin or
 * support tooling see whether a legacy `ptaVertical` Labs enrollment row
 * still exists for an organization, without that row having any bearing on
 * actual access. */
export async function getLegacyPtaLabsEnrollmentStatus(organizationId: string) {
  return getOrganizationLabAccess(organizationId, "ptaVertical");
}

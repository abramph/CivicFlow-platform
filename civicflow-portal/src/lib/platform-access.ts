import type { PlatformRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface PlatformAccessSummary {
  hasPlatformAccess: boolean;
  platformRoles: PlatformRole[];
}

/**
 * Resolves a user's ACTIVE global platform roles, independent of any
 * organization membership or the active-organization session context.
 * Always re-reads the database — never trust a cached/JWT-stored copy of
 * this for authorization decisions, since a revocation must take effect
 * immediately rather than waiting for a token to rotate.
 */
export async function getPlatformAccessForUser(userId: string): Promise<PlatformAccessSummary> {
  const grants = await prisma.platformAccess.findMany({
    where: { userId, status: "ACTIVE" },
    select: { role: true },
  });

  return {
    hasPlatformAccess: grants.length > 0,
    platformRoles: grants.map((g) => g.role),
  };
}

/** Synchronous check against an already-resolved PlatformAccessSummary. */
export function hasPlatformRole(access: PlatformAccessSummary, role: PlatformRole): boolean {
  return access.platformRoles.includes(role);
}

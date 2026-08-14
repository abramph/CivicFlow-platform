import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";

/**
 * CORE-GIVE-A — the Contributions & Giving module gate + terminology
 * (docs/core-contributions-giving.md). MEMBER MONEY only: nothing in
 * src/lib/giving/* ever touches Subscription/SaaS billing.
 */

export const DEFAULT_TERMINOLOGY = "Contributions";

export async function getGivingSettings(organizationId: string) {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { contributionsEnabled: true, contributionTerminology: true },
  });
  return {
    contributionsEnabled: settings?.contributionsEnabled ?? false,
    terminology: settings?.contributionTerminology?.trim() || DEFAULT_TERMINOLOGY,
  };
}

/** Hard gate for every giving route. Default OFF — an organization opts in
 * deliberately (§84). */
export async function ensureContributionsEnabled(organizationId: string) {
  const { contributionsEnabled } = await getGivingSettings(organizationId);
  if (!contributionsEnabled) {
    throw new FinanceError("Contributions & Giving is not enabled for this organization.", 403);
  }
}

export async function setGivingSettings(input: {
  organizationId: string;
  contributionsEnabled?: boolean;
  contributionTerminology?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const settings = await prisma.orgSettings.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      ...(input.contributionsEnabled !== undefined ? { contributionsEnabled: input.contributionsEnabled } : {}),
      ...(input.contributionTerminology !== undefined
        ? { contributionTerminology: input.contributionTerminology?.trim() || null }
        : {}),
    },
    update: {
      ...(input.contributionsEnabled !== undefined ? { contributionsEnabled: input.contributionsEnabled } : {}),
      ...(input.contributionTerminology !== undefined
        ? { contributionTerminology: input.contributionTerminology?.trim() || null }
        : {}),
    },
  });

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action:
      input.contributionsEnabled === undefined
        ? "giving.settings_updated"
        : input.contributionsEnabled
          ? "giving.module_enabled"
          : "giving.module_disabled",
    entityType: "org_settings",
    entityId: settings.id,
    metadata: { contributionsEnabled: settings.contributionsEnabled },
  });
  return settings;
}

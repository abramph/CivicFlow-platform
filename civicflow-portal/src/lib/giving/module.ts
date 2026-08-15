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
    select: {
      contributionsEnabled: true,
      contributionTerminology: true,
      householdGivingEnabled: true,
      householdGivingPrivacyMode: true,
      publicGivingEnabled: true,
      publicGivingMessage: true,
      processingCostCoverageMode: true,
      processingCostCoveragePercentBps: true,
      processingCostCoverageFixedCents: true,
    },
  });
  return {
    contributionsEnabled: settings?.contributionsEnabled ?? false,
    terminology: settings?.contributionTerminology?.trim() || DEFAULT_TERMINOLOGY,
    householdGivingEnabled: settings?.householdGivingEnabled ?? false,
    householdGivingPrivacyMode: settings?.householdGivingPrivacyMode ?? "INDIVIDUAL_PRIVATE",
    publicGivingEnabled: settings?.publicGivingEnabled ?? false,
    publicGivingMessage: settings?.publicGivingMessage ?? null,
    // CONNECT-F: giving only (one-time/public/recurring) — see §5/§13.
    processingCostCoverageMode: settings?.processingCostCoverageMode ?? "OFF",
    processingCostCoveragePercentBps: settings?.processingCostCoveragePercentBps ?? 0,
    processingCostCoverageFixedCents: settings?.processingCostCoverageFixedCents ?? 0,
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
  householdGivingEnabled?: boolean;
  householdGivingPrivacyMode?: "INDIVIDUAL_PRIVATE" | "HOUSEHOLD_STATEMENT_ONLY" | "HOUSEHOLD_SHARED";
  publicGivingEnabled?: boolean;
  publicGivingMessage?: string | null;
  processingCostCoverageMode?: "OFF" | "OPTIONAL_CONTRIBUTOR_COVERAGE" | "STRIPE_SURCHARGE";
  processingCostCoveragePercentBps?: number;
  processingCostCoverageFixedCents?: number;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  if (input.processingCostCoverageMode === "STRIPE_SURCHARGE") {
    throw new FinanceError("Surcharge mode is reserved for a future release and is not available yet.", 409);
  }
  if (input.processingCostCoveragePercentBps !== undefined) {
    const { MAX_COVERAGE_PERCENT_BPS } = await import("./processing-cost-coverage");
    if (
      !Number.isInteger(input.processingCostCoveragePercentBps) ||
      input.processingCostCoveragePercentBps < 0 ||
      input.processingCostCoveragePercentBps > MAX_COVERAGE_PERCENT_BPS
    ) {
      throw new FinanceError(`The coverage percentage must be between 0 and ${MAX_COVERAGE_PERCENT_BPS / 100}%.`);
    }
  }
  if (input.processingCostCoverageFixedCents !== undefined) {
    const { MAX_COVERAGE_FIXED_CENTS } = await import("./processing-cost-coverage");
    if (
      !Number.isInteger(input.processingCostCoverageFixedCents) ||
      input.processingCostCoverageFixedCents < 0 ||
      input.processingCostCoverageFixedCents > MAX_COVERAGE_FIXED_CENTS
    ) {
      throw new FinanceError(`The fixed coverage amount must be between $0 and $${(MAX_COVERAGE_FIXED_CENTS / 100).toFixed(2)}.`);
    }
  }

  const fields = {
    ...(input.publicGivingEnabled !== undefined ? { publicGivingEnabled: input.publicGivingEnabled } : {}),
    ...(input.publicGivingMessage !== undefined
      ? { publicGivingMessage: input.publicGivingMessage?.trim() || null }
      : {}),
    ...(input.contributionsEnabled !== undefined ? { contributionsEnabled: input.contributionsEnabled } : {}),
    ...(input.contributionTerminology !== undefined
      ? { contributionTerminology: input.contributionTerminology?.trim() || null }
      : {}),
    ...(input.householdGivingEnabled !== undefined ? { householdGivingEnabled: input.householdGivingEnabled } : {}),
    ...(input.householdGivingPrivacyMode !== undefined
      ? { householdGivingPrivacyMode: input.householdGivingPrivacyMode }
      : {}),
    ...(input.processingCostCoverageMode !== undefined ? { processingCostCoverageMode: input.processingCostCoverageMode } : {}),
    ...(input.processingCostCoveragePercentBps !== undefined
      ? { processingCostCoveragePercentBps: input.processingCostCoveragePercentBps }
      : {}),
    ...(input.processingCostCoverageFixedCents !== undefined
      ? { processingCostCoverageFixedCents: input.processingCostCoverageFixedCents }
      : {}),
  };
  const settings = await prisma.orgSettings.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId, ...fields },
    update: fields,
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
    metadata: {
      contributionsEnabled: settings.contributionsEnabled,
      householdGivingEnabled: settings.householdGivingEnabled,
      householdGivingPrivacyMode: settings.householdGivingPrivacyMode,
    },
  });
  return settings;
}

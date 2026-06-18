import { prisma } from "@/lib/prisma";
import { getPlan, type PlanId } from "@/lib/plans";

export interface TrialStatus {
  isInTrial: boolean;
  trialEndsAt: Date | null;
  daysRemaining: number;
}

export async function getOrgPlan(organizationId: string): Promise<PlanId> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true },
  });
  const plan = (org?.plan ?? "free") as PlanId;
  // During active trial, org gets Essential-tier access at no charge.
  if (plan === "free" && org?.trialEndsAt && org.trialEndsAt > new Date()) {
    return "essential";
  }
  return plan;
}

export async function getTrialStatus(organizationId: string): Promise<TrialStatus> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true },
  });

  const now = new Date();
  const trialEndsAt = org?.trialEndsAt ?? null;
  const isInTrial =
    org?.plan === "free" && trialEndsAt !== null && trialEndsAt > now;
  const daysRemaining = isInTrial
    ? Math.ceil((trialEndsAt!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return { isInTrial, trialEndsAt, daysRemaining };
}

export async function checkMemberLimit(
  organizationId: string,
  plan?: PlanId
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const resolvedPlan = plan ?? (await getOrgPlan(organizationId));
  const { limits } = getPlan(resolvedPlan);

  if (limits.members === Infinity) {
    const current = await prisma.orgMember.count({ where: { organizationId } });
    return { allowed: true, current, limit: Infinity };
  }

  const current = await prisma.orgMember.count({ where: { organizationId } });
  return { allowed: current < limits.members, current, limit: limits.members };
}

export async function requireMemberSlot(organizationId: string): Promise<void> {
  const { allowed, current, limit } = await checkMemberLimit(organizationId);
  if (!allowed) {
    throw new PlanLimitError(
      `Your plan allows up to ${limit} members (you have ${current}). Upgrade to add more.`
    );
  }
}

export async function checkSeatLimit(
  organizationId: string
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true, seatLimit: true },
  });

  const planId = await getOrgPlan(organizationId);
  const planConfig = getPlan(planId);
  const limit = org?.seatLimit ?? planConfig.includedSeats;
  const current = await prisma.organizationMembership.count({ where: { organizationId } });

  return { allowed: current < limit, current, limit };
}

export async function requireSeatSlot(organizationId: string): Promise<void> {
  const { allowed, current, limit } = await checkSeatLimit(organizationId);
  if (!allowed) {
    throw new PlanLimitError(
      `Your plan allows up to ${limit} portal user seat${limit === 1 ? "" : "s"} (you have ${current}). Purchase additional seats in Billing to add more users.`
    );
  }
}

export async function requirePlanFeature(
  organizationId: string,
  feature: "emailCampaigns" | "pdfExport" | "advancedReports" | "apiAccess"
): Promise<void> {
  const planId = await getOrgPlan(organizationId);
  const config = getPlan(planId);
  if (!config.limits[feature]) {
    throw new PlanLimitError(
      `Your ${config.name} plan does not include ${feature}. Upgrade to access this feature.`
    );
  }
}

export class PlanLimitError extends Error {
  readonly status = 403;
  readonly code = "PLAN_LIMIT";
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

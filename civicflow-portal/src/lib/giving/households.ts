import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-H — household giving & privacy (docs/core-contributions-giving.md
 * §8, the dedicated privacy review). THE RULES:
 *  - the §29 mode gate lives HERE, in one function, and every household
 *    surface goes through it;
 *  - a member's household is derived from THEIR OWN OrgMember row — a
 *    household id is never accepted from a member-facing client;
 *  - INDIVIDUAL_PRIVATE means the household changes NOTHING about giving
 *    visibility — sharing an address is not consent to share money.
 */

export async function getHouseholdGivingSettings(organizationId: string) {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { householdGivingEnabled: true, householdGivingPrivacyMode: true },
  });
  return {
    enabled: settings?.householdGivingEnabled ?? false,
    mode: settings?.householdGivingPrivacyMode ?? "INDIVIDUAL_PRIVATE",
  };
}

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

export async function createHousehold(input: ActorInput & {
  organizationId: string;
  name: string;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}) {
  await ensureContributionsEnabled(input.organizationId);
  const name = input.name.trim();
  if (!name) throw new FinanceError("Household name is required.");
  try {
    const household = await prisma.household.create({
      data: {
        organizationId: input.organizationId,
        name,
        addressLine1: input.addressLine1?.trim() || null,
        city: input.city?.trim() || null,
        state: input.state?.trim() || null,
        zipCode: input.zipCode?.trim() || null,
      },
    });
    const { createAuditEvent } = await import("@/lib/audit");
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "giving.household_created",
      entityType: "household",
      entityId: household.id,
      metadata: { name },
    });
    return household;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new FinanceError(`A household named "${name}" already exists.`, 409);
    }
    throw error;
  }
}

export async function setHouseholdMembership(input: ActorInput & {
  organizationId: string;
  householdId: string;
  memberId: string;
  action: "add" | "remove";
}) {
  await ensureContributionsEnabled(input.organizationId);
  const household = await prisma.household.findFirst({ where: { id: input.householdId, organizationId: input.organizationId } });
  if (!household) throw new FinanceError("Household not found.", 404);
  const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId: input.organizationId } });
  if (!member) throw new FinanceError("Member not found.", 404);

  await prisma.orgMember.update({
    where: { id: member.id },
    data: { householdId: input.action === "add" ? household.id : null },
  });
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: input.action === "add" ? "giving.household_member_added" : "giving.household_member_removed",
    entityType: "household",
    entityId: household.id,
    metadata: { memberId: member.id },
  });
}

export type HouseholdGivingView =
  | { visibility: "NONE" }
  | {
      visibility: "TOTALS";
      householdName: string;
      year: number;
      memberSubtotals: { name: string; total: number; isSelf: boolean }[];
      householdTotal: number;
    }
  | {
      visibility: "SHARED";
      householdName: string;
      year: number;
      memberSubtotals: { name: string; total: number; isSelf: boolean }[];
      householdTotal: number;
      contributions: { date: Date; memberName: string; designation: string; amount: number }[];
    };

/** THE §29 gate. The caller's household is derived from THEIR member row. */
export async function getMyHouseholdGiving(
  organizationId: string,
  callerMemberId: string,
  year: number = new Date().getFullYear()
): Promise<HouseholdGivingView> {
  const { enabled, mode } = await getHouseholdGivingSettings(organizationId);
  if (!enabled || mode === "INDIVIDUAL_PRIVATE") return { visibility: "NONE" };

  const caller = await prisma.orgMember.findFirst({
    where: { id: callerMemberId, organizationId },
    select: { householdId: true },
  });
  if (!caller?.householdId) return { visibility: "NONE" };

  const household = await prisma.household.findFirst({
    where: { id: caller.householdId, organizationId },
    include: { members: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!household) return { visibility: "NONE" };

  const periodStart = new Date(Date.UTC(year, 0, 1));
  const periodEnd = new Date(Date.UTC(year + 1, 0, 1));
  const memberIds = household.members.map((member) => member.id);

  const rows = await prisma.contribution.findMany({
    where: {
      organizationId,
      memberId: { in: memberIds },
      voidedAt: null,
      statementEligible: true,
      contributionDate: { gte: periodStart, lt: periodEnd },
    },
    select: {
      memberId: true,
      amount: true,
      contributionDate: true,
      fund: { select: { name: true } },
      campaign: { select: { name: true } },
    },
    orderBy: { contributionDate: "desc" },
  });

  const nameFor = new Map(household.members.map((member) => [member.id, `${member.firstName} ${member.lastName}`.trim()]));
  const subtotals = new Map<string, number>();
  for (const row of rows) {
    if (!row.memberId) continue;
    subtotals.set(row.memberId, (subtotals.get(row.memberId) ?? 0) + Number(row.amount));
  }
  const memberSubtotals = household.members.map((member) => ({
    name: nameFor.get(member.id) ?? "Member",
    total: subtotals.get(member.id) ?? 0,
    isSelf: member.id === callerMemberId,
  }));
  const householdTotal = memberSubtotals.reduce((sum, row) => sum + row.total, 0);

  if (mode === "HOUSEHOLD_STATEMENT_ONLY") {
    return { visibility: "TOTALS", householdName: household.name, year, memberSubtotals, householdTotal };
  }
  return {
    visibility: "SHARED",
    householdName: household.name,
    year,
    memberSubtotals,
    householdTotal,
    contributions: rows.slice(0, 100).map((row) => ({
      date: row.contributionDate,
      memberName: row.memberId ? (nameFor.get(row.memberId) ?? "Member") : "Member",
      designation: row.fund?.name ?? row.campaign?.name ?? "General",
      amount: Number(row.amount),
    })),
  };
}

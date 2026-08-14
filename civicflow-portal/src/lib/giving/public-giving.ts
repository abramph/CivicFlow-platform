import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { validateGivingRequest } from "./checkout";
import { logGivingEvent } from "./telemetry";

/**
 * CORE-GIVE-J — the public giving page (docs/core-contributions-giving.md
 * §10 + its security review). RULES:
 *  - ONE gate function decides whether a slug has a public page; every
 *    failure mode (unknown slug, module off, page off) returns the same
 *    null → identical 404, no tenant enumeration;
 *  - the page exposes ONLY published fields: name, logo, message, isPublic
 *    funds, showPublicProgress campaigns (goal + raised total, never donor
 *    rows);
 *  - guest email matching only ever SUGGESTS (§57) — memberId is set solely
 *    by resolveGuestContribution under staff authority, audited.
 */

export async function getPublicGivingPage(slug: string) {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, logoUrl: true },
  });
  if (!organization) return null;
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId: organization.id },
    select: { contributionsEnabled: true, publicGivingEnabled: true, publicGivingMessage: true, contributionTerminology: true },
  });
  if (!settings?.contributionsEnabled || !settings.publicGivingEnabled) return null;

  const [funds, campaigns] = await Promise.all([
    prisma.fund.findMany({
      where: { organizationId: organization.id, isPublic: true, status: "ACTIVE", allowOneTime: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        suggestedAmounts: true,
        minimumAmount: true,
        maximumAmount: true,
      },
    }),
    prisma.campaign.findMany({
      where: { organizationId: organization.id, status: "active", showPublicProgress: true },
      select: { id: true, name: true, description: true, goal: true, endDate: true },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  const campaignProgress = await Promise.all(
    campaigns.map(async (campaign) => {
      const raised = await prisma.contribution.aggregate({
        where: { organizationId: organization.id, campaignId: campaign.id, voidedAt: null },
        _sum: { amount: true },
      });
      return {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        goal: campaign.goal !== null ? Number(campaign.goal) : null,
        raised: Number(raised._sum.amount ?? 0),
        endDate: campaign.endDate,
      };
    })
  );

  return {
    organization,
    terminology: settings.contributionTerminology?.trim() || "Contributions",
    message: settings.publicGivingMessage,
    funds: funds.map((fund) => ({
      id: fund.id,
      name: fund.name,
      description: fund.description,
      suggestedAmounts: fund.suggestedAmounts.map((value) => Number(value)),
      minimumAmount: fund.minimumAmount !== null ? Number(fund.minimumAmount) : null,
      maximumAmount: fund.maximumAmount !== null ? Number(fund.maximumAmount) : null,
    })),
    campaigns: campaignProgress,
  };
}

/** Checkout-side validation for a guest gift. Same gates as the page (404
 * on any), then the shared giving validation PLUS fund.isPublic — a
 * non-public fund 404s without confirming it exists. */
export async function validatePublicGivingRequest(input: { slug: string; fundId: string; amount: number }) {
  const organization = await prisma.organization.findUnique({ where: { slug: input.slug }, select: { id: true } });
  if (!organization) throw new FinanceError("Page not found.", 404);
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId: organization.id },
    select: { contributionsEnabled: true, publicGivingEnabled: true },
  });
  if (!settings?.contributionsEnabled || !settings.publicGivingEnabled) throw new FinanceError("Page not found.", 404);

  const { amount, fund } = await validateGivingRequest({
    organizationId: organization.id,
    fundId: input.fundId,
    amount: input.amount,
  });
  if (!fund.isPublic) throw new FinanceError("Fund not found.", 404);
  return { organizationId: organization.id, amount, fund };
}

export interface RecordPublicGivingInput {
  /** From Stripe session METADATA (server-stamped at checkout). */
  organizationId: string;
  fundId: string;
  guestName?: string | null;
  guestEmail?: string | null;
  anonymityMode?: string | null;
  /** From the Stripe session OBJECT (provider truth). */
  amountTotalCents: number;
  currency: string;
  providerPaymentIntentId: string | null;
  providerSessionId: string;
}

export type RecordPublicGivingResult =
  | { outcome: "RECORDED"; contributionId: string; contributionNumber: string | null; matchStatus: string }
  | { outcome: "DUPLICATE"; contributionId: string }
  | { outcome: "REJECTED"; reason: string };

/** Webhook-side recorder for public-page gifts. §50 cross-checks mirror the
 * member recorder; matching only ever SUGGESTS. Never returns member data. */
export async function recordPublicGivingContribution(input: RecordPublicGivingInput): Promise<RecordPublicGivingResult> {
  const fund = await prisma.fund.findFirst({ where: { id: input.fundId, organizationId: input.organizationId } });
  if (!fund) return { outcome: "REJECTED", reason: "fund_org_mismatch" };
  if (fund.status === "ARCHIVED" || fund.status === "CLOSED") return { outcome: "REJECTED", reason: "fund_not_open" };
  if (!Number.isInteger(input.amountTotalCents) || input.amountTotalCents <= 0) {
    return { outcome: "REJECTED", reason: "invalid_amount" };
  }

  const reference = input.providerPaymentIntentId ?? input.providerSessionId;
  const existing = await prisma.contribution.findFirst({
    where: { organizationId: input.organizationId, providerPaymentIntentId: reference },
    select: { id: true },
  });
  if (existing) {
    logGivingEvent("GIVING_PAYMENT_DUPLICATE_IGNORED", { organizationId: input.organizationId, contributionId: existing.id });
    return { outcome: "DUPLICATE", contributionId: existing.id };
  }

  // §57 matching: an email that matches the roster SUGGESTS a link and
  // nothing more. memberId stays null here, always.
  const guestEmail = input.guestEmail?.trim().toLowerCase() || null;
  let matchStatus: "UNLINKED" | "MATCH_SUGGESTED" = "UNLINKED";
  if (guestEmail) {
    const match = await prisma.orgMember.findFirst({
      where: { organizationId: input.organizationId, email: { equals: guestEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (match) matchStatus = "MATCH_SUGGESTED";
  }
  const anonymityMode = input.anonymityMode === "PUBLICLY_ANONYMOUS" ? "PUBLICLY_ANONYMOUS" : "NONE";

  const { withContributionNumber } = await import("./contribution-numbers");
  const contribution = await withContributionNumber(input.organizationId, (contributionNumber) =>
    prisma.contribution.create({
      data: {
        organizationId: input.organizationId,
        contributionNumber,
        fundId: input.fundId,
        amount: input.amountTotalCents / 100,
        currency: input.currency.toUpperCase(),
        contributionDate: new Date(),
        paymentMethod: "STRIPE",
        source: "PUBLIC_PAGE",
        providerPaymentIntentId: reference,
        contributorName: input.guestName?.trim().slice(0, 120) || null,
        guestEmail,
        guestMatchStatus: matchStatus,
        anonymityMode,
        statementEligible: true,
        receiptRequested: Boolean(guestEmail),
      },
    })
  );

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: null,
    action: "giving.public_contribution_recorded",
    entityType: "contribution",
    entityId: contribution.id,
    metadata: { contributionNumber: contribution.contributionNumber, fundId: input.fundId, amountCents: input.amountTotalCents, matchStatus },
  });
  logGivingEvent("GIVING_PAYMENT_RECORDED", {
    organizationId: input.organizationId,
    contributionId: contribution.id,
    fundId: input.fundId,
    amountCents: input.amountTotalCents,
    matchStatus,
  });
  return { outcome: "RECORDED", contributionId: contribution.id, contributionNumber: contribution.contributionNumber, matchStatus };
}

/** Officer list: guest rows with any roster suggestion resolved for
 * display. contributions:individual:view territory. */
export async function listGuestContributions(organizationId: string) {
  const rows = await prisma.contribution.findMany({
    where: { organizationId, source: "PUBLIC_PAGE", voidedAt: null },
    orderBy: { contributionDate: "desc" },
    select: {
      id: true,
      contributionNumber: true,
      amount: true,
      contributionDate: true,
      contributorName: true,
      guestEmail: true,
      guestMatchStatus: true,
      memberId: true,
      fund: { select: { name: true } },
    },
    take: 200,
  });
  const suggestions = new Map<string, { memberId: string; memberName: string }>();
  const emails = [...new Set(rows.filter((row) => row.guestMatchStatus === "MATCH_SUGGESTED" && row.guestEmail).map((row) => row.guestEmail as string))];
  if (emails.length) {
    const members = await prisma.orgMember.findMany({
      where: { organizationId, email: { in: emails, mode: "insensitive" } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    for (const member of members) {
      if (member.email) {
        suggestions.set(member.email.toLowerCase(), {
          memberId: member.id,
          memberName: `${member.firstName} ${member.lastName}`.trim(),
        });
      }
    }
  }
  return rows.map((row) => ({
    id: row.id,
    contributionNumber: row.contributionNumber,
    amount: Number(row.amount),
    date: row.contributionDate,
    guestName: row.contributorName,
    guestEmail: row.guestEmail,
    matchStatus: row.memberId ? "LINKED" : (row.guestMatchStatus ?? "UNLINKED"),
    fundName: row.fund?.name ?? "—",
    suggestedMember: row.guestEmail ? (suggestions.get(row.guestEmail.toLowerCase()) ?? null) : null,
  }));
}

/** §57 resolution — the ONLY path that sets memberId on a guest row. */
export async function resolveGuestContribution(input: {
  organizationId: string;
  contributionId: string;
  action: "link" | "dismiss";
  memberId?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const contribution = await prisma.contribution.findFirst({
    where: { id: input.contributionId, organizationId: input.organizationId, source: "PUBLIC_PAGE" },
  });
  if (!contribution) throw new FinanceError("Contribution not found.", 404);

  if (input.action === "link") {
    if (contribution.memberId) throw new FinanceError("This contribution is already linked to a member.", 409);
    if (!input.memberId) throw new FinanceError("A member is required to link.");
    const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId: input.organizationId } });
    if (!member) throw new FinanceError("Member not found.", 404);
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { memberId: member.id, contributorUserId: member.userId ?? null, guestMatchStatus: "LINKED" },
    });
  } else {
    if (contribution.memberId) throw new FinanceError("This contribution is already linked to a member.", 409);
    await prisma.contribution.update({ where: { id: contribution.id }, data: { guestMatchStatus: "UNLINKED" } });
  }

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: input.action === "link" ? "giving.guest_contribution_linked" : "giving.guest_match_dismissed",
    entityType: "contribution",
    entityId: contribution.id,
    metadata: { memberId: input.action === "link" ? (input.memberId ?? null) : null },
  });
}

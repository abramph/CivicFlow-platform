import "server-only";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { OperationalRisk } from "./types";

/**
 * Read-only production data-consistency diagnostics for Platform Admins —
 * deliberately separate from risks.ts (billing/ops risk, already rendered
 * on the Overview page): these are cross-tenant data-integrity findings,
 * not operational risk signals, and are meant to be exported for follow-up
 * rather than glanced at on a dashboard. Reuses risks.ts's exact
 * OperationalRisk shape (same severity/affectedEntity/source contract)
 * rather than inventing a parallel type for what is structurally the same
 * kind of finding.
 *
 * Every check here is a plain read — no repair action exists anywhere in
 * this module, by design (see the Launch Readiness Sprint's own rule: this
 * tool detects, it never auto-fixes). Where a real fix path already exists
 * elsewhere in the product (e.g. "Make primary contact" on the household
 * detail page — see households.ts's setPtaHouseholdPrimaryContact()), the
 * finding's href points there.
 */

function shortHash(value: string): string {
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 12);
}

async function householdsMissingPrimaryContactFindings(): Promise<OperationalRisk[]> {
  const households = await prisma.ptaHousehold.findMany({
    where: { status: "ACTIVE", primaryContactAdultId: null },
    select: { id: true, displayName: true, organizationId: true, organization: { select: { name: true } } },
    take: 500,
  });
  return households.map((h) => ({
    id: `household-no-primary-contact:${h.id}`,
    severity: "warning" as const,
    title: "Household has no primary contact",
    explanation: `Organization ${h.organization.name} has an active household without primaryContactAdultId; its billing identity may not receive email communications until a primary contact is set.`,
    affectedEntity: { type: "pta_household", id: h.id, label: h.id },
    firstDetectedAt: null,
    href: `/labs/pta/households/${h.id}`,
    source: "database" as const,
  }));
}

async function householdsMissingBillingContactFindings(): Promise<OperationalRisk[]> {
  const households = await prisma.ptaHousehold.findMany({
    where: { orgMemberId: null },
    select: { id: true, displayName: true, organization: { select: { name: true } } },
    take: 500,
  });
  return households.map((h) => ({
    id: `household-no-billing-contact:${h.id}`,
    severity: "critical" as const,
    title: "Household has no billing-identity OrgMember at all",
    explanation: `Organization ${h.organization.name} has a household with null orgMemberId; dues and household-level communications cannot resolve for it. This should not be reachable through the normal product and is likely a data-migration artifact.`,
    affectedEntity: { type: "pta_household", id: h.id, label: h.id },
    firstDetectedAt: null,
    href: `/labs/pta/households/${h.id}`,
    source: "database" as const,
  }));
}

async function householdBillingContactMissingEmailFindings(): Promise<OperationalRisk[]> {
  const members = await prisma.orgMember.findMany({
    where: { householdName: { not: null }, email: null },
    select: { id: true, householdName: true, organizationId: true, organization: { select: { name: true } } },
    take: 500,
  });
  return members.map((m) => ({
    id: `billing-identity-no-email:${m.id}`,
    severity: "warning" as const,
    title: "Household billing identity has no email",
    explanation: `Organization ${m.organization.name} has a household billing OrgMember with no email; EMAIL-channel campaigns skip this identity until the primary-contact workflow syncs it.`,
    affectedEntity: { type: "org_member", id: m.id, label: m.id },
    firstDetectedAt: null,
    href: `/members/${m.id}`,
    source: "database" as const,
  }));
}

async function duplicateCommunicationIdentityFindings(): Promise<OperationalRisk[]> {
  const grouped = await prisma.orgMember.groupBy({
    by: ["organizationId", "email"],
    where: { email: { not: null } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
    orderBy: { organizationId: "asc" },
    take: 200,
  });
  if (grouped.length === 0) return [];

  const orgIds = Array.from(new Set(grouped.map((g) => g.organizationId)));
  const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  return grouped.map((g) => ({
    id: `duplicate-identity:${g.organizationId}:${shortHash(g.email ?? "")}`,
    severity: "info" as const,
    title: "Multiple OrgMembers share the same email",
    explanation: `${g._count.id} OrgMembers in ${orgNameById.get(g.organizationId) ?? g.organizationId} share one email address. This may be legitimate, such as a shared family inbox, or a duplicate created by re-import.`,
    affectedEntity: { type: "organization", id: g.organizationId, label: orgNameById.get(g.organizationId) ?? g.organizationId },
    firstDetectedAt: null,
    href: `/admin/platform/organizations/${g.organizationId}`,
    source: "database" as const,
  }));
}

async function inactiveStudentActiveEnrollmentFindings(): Promise<OperationalRisk[]> {
  const enrollments = await prisma.ptaStudentEnrollment.findMany({
    where: { status: "ACTIVE", student: { status: { not: "ACTIVE" } } },
    select: {
      id: true,
      organizationId: true,
      organization: { select: { name: true } },
      classroom: { select: { name: true } },
      student: { select: { id: true, status: true } },
    },
    take: 500,
  });
  return enrollments.map((e) => ({
    id: `inactive-student-active-enrollment:${e.id}`,
    severity: "info" as const,
    title: "Deactivated student still actively enrolled",
    explanation: `Organization ${e.organization.name} has a ${e.student.status.toLowerCase()} student with an ACTIVE classroom enrollment.`,
    affectedEntity: { type: "pta_student", id: e.student.id, label: e.student.id },
    firstDetectedAt: null,
    href: `/labs/pta/academic`,
    source: "database" as const,
  }));
}

async function staleCommitteeMembershipFindings(): Promise<OperationalRisk[]> {
  const members = await prisma.ptaCommitteeMember.findMany({
    where: { householdAdult: { household: { status: { not: "ACTIVE" } } } },
    select: {
      id: true,
      organization: { select: { name: true } },
      committee: { select: { id: true, name: true } },
      householdAdult: { select: { household: { select: { id: true, displayName: true, status: true } } } },
    },
    take: 500,
  });
  return members.map((m) => ({
    id: `stale-committee-membership:${m.id}`,
    severity: "info" as const,
    title: "Committee membership for a non-active household",
    explanation: `Organization ${m.organization.name} has a committee membership attached to a ${m.householdAdult.household.status.toLowerCase()} household.`,
    affectedEntity: { type: "pta_committee", id: m.committee.id, label: m.committee.id },
    firstDetectedAt: null,
    href: `/labs/pta/committees/${m.committee.id}`,
    source: "database" as const,
  }));
}

async function volunteerSlotOverCapacityFindings(): Promise<OperationalRisk[]> {
  // Prisma's query API has no native "compare two columns of the same row"
  // filter, so this fetches every slot with at least one claim and filters
  // in application code — fine at this scale (an admin-only diagnostic
  // tool, not a hot request path), and avoids a raw SQL query for a single
  // check.
  const candidates = await prisma.ptaVolunteerSlot.findMany({
    where: { claimedCount: { gt: 0 } },
    select: {
      id: true,
      label: true,
      claimedCount: true,
      capacity: true,
      organization: { select: { name: true } },
      opportunity: { select: { id: true, title: true } },
    },
    take: 5000,
  });
  const slots = candidates.filter((s) => s.claimedCount > s.capacity);
  return slots.map((s) => ({
    id: `slot-over-capacity:${s.id}`,
    severity: "warning" as const,
    title: "Volunteer slot has more claims than capacity",
    explanation: `Organization ${s.organization.name} has a volunteer slot with ${s.claimedCount} claimed against a capacity of ${s.capacity}. Capacity overrides are audited and expected occasionally; this flags the slot for a spot-check, not as inherently wrong.`,
    affectedEntity: { type: "pta_volunteer_opportunity", id: s.opportunity.id, label: s.opportunity.id },
    firstDetectedAt: null,
    href: `/labs/pta/volunteers/manage/${s.opportunity.id}`,
    source: "database" as const,
  }));
}


// ── CORE-GIVE-K (§70): giving data-integrity checks. Aggregate/structural
// only — donor amounts never appear at platform level.

async function activeScheduleOnClosedFundFindings(): Promise<OperationalRisk[]> {
  const schedules = await prisma.recurringContributionSchedule.findMany({
    where: { status: "ACTIVE", fund: { status: { in: ["CLOSED", "ARCHIVED"] } } },
    select: { id: true, organizationId: true, organization: { select: { name: true } }, fund: { select: { name: true, status: true } } },
    take: 500,
  });
  return schedules.map((schedule) => ({
    id: `giving-schedule-closed-fund:${schedule.id}`,
    severity: "critical" as const,
    title: "Active recurring schedule designates a closed/archived fund",
    explanation: `Organization ${schedule.organization.name} has an ACTIVE recurring giving schedule pointed at fund "${schedule.fund.name}" (${schedule.fund.status}). Future invoices will still record; the organization should redesignate or cancel the schedule.`,
    affectedEntity: { type: "recurring_schedule", id: schedule.id, label: schedule.id },
    firstDetectedAt: null,
    href: `/admin/platform/organizations/${schedule.organizationId}`,
    source: "database" as const,
  }));
}

async function activeScheduleMissingProviderFindings(): Promise<OperationalRisk[]> {
  const schedules = await prisma.recurringContributionSchedule.findMany({
    where: { status: "ACTIVE", providerSubscriptionId: null },
    select: { id: true, organizationId: true, organization: { select: { name: true } } },
    take: 500,
  });
  return schedules.map((schedule) => ({
    id: `giving-schedule-no-provider:${schedule.id}`,
    severity: "critical" as const,
    title: "ACTIVE giving schedule has no provider subscription id",
    explanation: `Organization ${schedule.organization.name} has a schedule marked ACTIVE without a providerSubscriptionId — it can never receive invoices and its status misrepresents reality. Likely a webhook linkage failure.`,
    affectedEntity: { type: "recurring_schedule", id: schedule.id, label: schedule.id },
    firstDetectedAt: null,
    href: `/admin/platform/organizations/${schedule.organizationId}`,
    source: "database" as const,
  }));
}

async function duplicateProviderReferenceFindings(): Promise<OperationalRisk[]> {
  const dupes = await prisma.contribution.groupBy({
    by: ["organizationId", "providerPaymentIntentId"],
    where: { providerPaymentIntentId: { not: null }, voidedAt: null },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
    orderBy: { organizationId: "asc" },
    take: 200,
  });
  return dupes.map((dupe) => ({
    id: `giving-duplicate-provider-ref:${shortHash(`${dupe.organizationId}:${dupe.providerPaymentIntentId}`)}`,
    severity: "critical" as const,
    title: "Duplicate provider payment reference",
    explanation: `An organization has ${dupe._count.id} non-void contributions sharing one provider payment reference — the idempotency belt should make this impossible; investigate before statements are issued.`,
    affectedEntity: { type: "contribution", id: dupe.providerPaymentIntentId ?? "", label: "duplicate reference" },
    firstDetectedAt: null,
    href: `/admin/platform/organizations/${dupe.organizationId}`,
    source: "database" as const,
  }));
}

async function pledgeOvercreditFindings(): Promise<OperationalRisk[]> {
  const pledges = await prisma.pledge.findMany({
    where: { status: { in: ["ACTIVE", "FULFILLED"] } },
    select: { id: true, pledgedAmount: true, organizationId: true, organization: { select: { name: true } } },
    take: 2000,
  });
  const findings: OperationalRisk[] = [];
  for (const pledge of pledges) {
    const sum = await prisma.contribution.aggregate({
      where: { organizationId: pledge.organizationId, pledgeId: pledge.id, voidedAt: null },
      _sum: { amount: true },
    });
    const credited = Number(sum._sum.amount ?? 0);
    if (credited > Number(pledge.pledgedAmount) * 1.5) {
      findings.push({
        id: `giving-pledge-overcredit:${pledge.id}`,
        severity: "warning" as const,
        title: "Pledge credited far above pledged amount",
        explanation: `Organization ${pledge.organization.name} has a pledge credited at more than 150% of its stated amount. Overgiving is legal and welcome — this flags a possible mis-allocation for a spot check, not wrongdoing.`,
        affectedEntity: { type: "pledge", id: pledge.id, label: pledge.id },
        firstDetectedAt: null,
        href: `/admin/platform/organizations/${pledge.organizationId}`,
        source: "database" as const,
      });
    }
  }
  return findings;
}

export async function getDataHealthFindings(): Promise<OperationalRisk[]> {
  const groups = await Promise.all([
    householdsMissingPrimaryContactFindings(),
    householdsMissingBillingContactFindings(),
    householdBillingContactMissingEmailFindings(),
    duplicateCommunicationIdentityFindings(),
    inactiveStudentActiveEnrollmentFindings(),
    staleCommitteeMembershipFindings(),
    volunteerSlotOverCapacityFindings(),
    activeScheduleOnClosedFundFindings(),
    activeScheduleMissingProviderFindings(),
    duplicateProviderReferenceFindings(),
    pledgeOvercreditFindings(),
  ]);

  const severityRank: Record<OperationalRisk["severity"], number> = { critical: 0, warning: 1, info: 2 };
  return groups.flat().sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

import { prisma } from "@/lib/prisma";
import { formatOrgWallTime } from "../timezone";
import { getVolunteerRequirementPeriod } from "../periods";
import { resolveReportHouseholds, buildReportInfo, describeAppliedFilters, emptySummaryTotals } from "./shared";
import type { ReportColumn } from "./xlsx-builder";
import type { ReportData, VolunteerReportFilters } from "./types";

/** feature/pta-family-agreement-buyout follow-up (FA2 §2). Report H: Family
 * Agreement Status — the operational counterpart to the admin status-counts
 * widget already on the period settings page (agreements.ts's
 * getAgreementStatusCounts), now with real per-household rows and a real
 * .xlsx export via the same shared architecture Reports A-G use. Always
 * scoped to exactly one requirement period (the spec's PERIOD mode is the
 * only mode this report supports — "agreement" is a period-scoped concept,
 * unlike hours which can meaningfully be viewed ALL_TIME).
 *
 * Deliberately carries ZERO dollar amounts, payment amounts, outstanding
 * balances, or provider/payment identifiers — this is an operational report
 * available on the ordinary pta:volunteer-reports:view/:export permission
 * (see dispatch.ts's permissionForVolunteerReportType), not the stricter
 * financial-reports permission Report E requires. A caller who can see
 * Reports A/B/C/D/F/G can see this one too.
 */

export type AcceptanceStatus = "NOT_REQUIRED" | "NOT_YET_ACCEPTED" | "ACCEPTED";
export type ContractLinkedOfferStatus = "NOT_APPLICABLE" | "AWAITING_ACCEPTANCE" | "OPEN" | "EXPIRED";
export type FamilyElectionStatus = "NONE" | "VOLUNTEER" | "PARTIAL_BUYOUT" | "FULL_BUYOUT";

export interface FamilyAgreementStatusRow {
  householdId: string;
  householdDisplayName: string;
  agreementRequired: boolean;
  assignedAgreementTitle: string | null;
  assignedAgreementVersionNumber: number | null;
  acceptanceStatus: AcceptanceStatus;
  acceptedByName: string | null;
  /** Pre-formatted in the ORGANIZATION's own timezone (spec: "Accepted
   * date/time in organization time zone"), not the browser's/server's — a
   * plain text column, not a "datetime" xlsx column, specifically so no
   * spreadsheet application can reinterpret it through its own local zone
   * (mirrors formatContractLinkedOfferExpiration's exact reasoning). */
  acceptedAtOrgTime: string | null;
  contractLinkedOfferStatus: ContractLinkedOfferStatus;
  offerExpirationOrgTime: string | null;
  electionStatus: FamilyElectionStatus;
  /** Non-null only when the household has a real, recorded acceptance for
   * THIS period under a version OTHER than the one currently assigned —
   * e.g. they accepted v1, an admin later reassigned the period to v2, and
   * the household has not yet accepted v2. Never inferred merely from a
   * version being superseded; a household with no historical acceptance at
   * all is simply NOT_YET_ACCEPTED, not a "mismatch." */
  versionMismatchNote: string | null;
  /** Most recent PtaVolunteerHourDispute for this household+period, if any
   * — the lightweight household-submitted "report missing or incorrect
   * volunteer record" flag (spec §8), shown here as the operational
   * exception/review signal this report's spec column asks for. Never a
   * financial figure. */
  operationalExceptionStatus: string | null;
}

export async function buildFamilyAgreementStatusReportData(
  organizationId: string,
  filters: VolunteerReportFilters,
  generatedByName: string
): Promise<ReportData<FamilyAgreementStatusRow>> {
  const period = await getVolunteerRequirementPeriod(organizationId, filters.requirementPeriodId);
  const households = await resolveReportHouseholds(organizationId, filters);
  const householdIds = households.map((h) => h.id);

  const assignedVersionPromise = period.agreementVersionId
    ? prisma.ptaVolunteerAgreementVersion.findFirst({
        where: { id: period.agreementVersionId, organizationId },
        select: { id: true, title: true, versionNumber: true },
      })
    : Promise.resolve(null);

  // No households in scope (empty org, or filters matched nobody) -> every
  // household-scoped query below would be pure waste (and, worse, an
  // unfiltered org-wide fetch if not guarded), since the per-household loop
  // further down never runs when `households` is empty anyway.
  const [assignedVersion, elections, periodAcceptances, disputes] = householdIds.length
    ? await Promise.all([
        assignedVersionPromise,
        prisma.ptaVolunteerBuyoutElection.findMany({
          where: { organizationId, requirementPeriodId: filters.requirementPeriodId, householdId: { in: householdIds } },
          orderBy: { createdAt: "desc" },
          select: { householdId: true, electionType: true },
        }),
        // ALL acceptances for this period, across every version ever assigned
        // to it — not just the currently-assigned one — so a household that
        // accepted a now-superseded version can be flagged as needing
        // reacceptance rather than silently showing as "not yet accepted."
        prisma.ptaVolunteerAgreementAcceptance.findMany({
          where: { organizationId, requirementPeriodId: filters.requirementPeriodId, householdId: { in: householdIds } },
          orderBy: { acceptedAt: "desc" },
          // FA3 §1/§4: signerDisplayNameAtAcceptance is the permanent,
          // always-populated snapshot -- never a live join to
          // acceptedByAdult, which can go null if the adult's household
          // membership is later removed. acceptedByAdult/typedName are
          // still selected only as a legacy fallback for any acceptance
          // row written before this snapshot column existed.
          select: {
            householdId: true,
            agreementVersionId: true,
            acceptedAt: true,
            signerDisplayNameAtAcceptance: true,
            acceptedByAdult: { select: { name: true } },
            typedName: true,
          },
        }),
        prisma.ptaVolunteerHourDispute.findMany({
          where: { organizationId, requirementPeriodId: filters.requirementPeriodId, householdId: { in: householdIds } },
          orderBy: { createdAt: "desc" },
          select: { householdId: true, status: true },
        }),
      ])
    : [await assignedVersionPromise, [], [], []];

  const latestElectionByHousehold = new Map<string, (typeof elections)[number]>();
  for (const e of elections) if (!latestElectionByHousehold.has(e.householdId)) latestElectionByHousehold.set(e.householdId, e);

  const latestDisputeByHousehold = new Map<string, (typeof disputes)[number]>();
  for (const d of disputes) if (!latestDisputeByHousehold.has(d.householdId)) latestDisputeByHousehold.set(d.householdId, d);

  // Per household: the acceptance matching the CURRENTLY assigned version
  // (if any), plus the most recent acceptance regardless of version (used
  // only to detect a mismatch — never used as "the" acceptance for
  // eligibility, matching resolveHouseholdAgreementStatus's own contract).
  const currentAcceptanceByHousehold = new Map<string, (typeof periodAcceptances)[number]>();
  const anyAcceptanceByHousehold = new Map<string, (typeof periodAcceptances)[number]>();
  for (const a of periodAcceptances) {
    if (!anyAcceptanceByHousehold.has(a.householdId)) anyAcceptanceByHousehold.set(a.householdId, a);
    if (period.agreementVersionId && a.agreementVersionId === period.agreementVersionId && !currentAcceptanceByHousehold.has(a.householdId)) {
      currentAcceptanceByHousehold.set(a.householdId, a);
    }
  }

  const now = Date.now();
  const rows: FamilyAgreementStatusRow[] = [];
  for (const household of households) {
    const currentAcceptance = currentAcceptanceByHousehold.get(household.id) ?? null;
    const anyAcceptance = anyAcceptanceByHousehold.get(household.id) ?? null;

    const acceptanceStatus: AcceptanceStatus = !period.agreementRequired && !assignedVersion ? "NOT_REQUIRED" : currentAcceptance ? "ACCEPTED" : "NOT_YET_ACCEPTED";

    let contractLinkedOfferStatus: ContractLinkedOfferStatus = "NOT_APPLICABLE";
    let offerExpirationOrgTime: string | null = null;
    if (period.contractLinkedBuyoutEnabled && period.contractLinkedEligibilityDays) {
      if (!currentAcceptance) {
        contractLinkedOfferStatus = "AWAITING_ACCEPTANCE";
      } else {
        const eligibleUntil = new Date(currentAcceptance.acceptedAt.getTime() + period.contractLinkedEligibilityDays * 24 * 60 * 60 * 1000);
        contractLinkedOfferStatus = now < eligibleUntil.getTime() ? "OPEN" : "EXPIRED";
        offerExpirationOrgTime = formatOrgWallTime(eligibleUntil.toISOString(), period.timezone, true);
      }
    }

    const latestElection = latestElectionByHousehold.get(household.id);
    const electionStatus: FamilyElectionStatus =
      latestElection?.electionType === "VOLUNTEER"
        ? "VOLUNTEER"
        : latestElection?.electionType === "PARTIAL_BUYOUT"
          ? "PARTIAL_BUYOUT"
          : latestElection?.electionType === "FULL_BUYOUT"
            ? "FULL_BUYOUT"
            : "NONE";

    let versionMismatchNote: string | null = null;
    if (assignedVersion && anyAcceptance && anyAcceptance.agreementVersionId !== assignedVersion.id) {
      versionMismatchNote = `Accepted a prior version — current required version is v${assignedVersion.versionNumber}`;
    }

    const dispute = latestDisputeByHousehold.get(household.id);

    rows.push({
      householdId: household.id,
      householdDisplayName: household.displayName,
      agreementRequired: period.agreementRequired,
      assignedAgreementTitle: assignedVersion?.title ?? null,
      assignedAgreementVersionNumber: assignedVersion?.versionNumber ?? null,
      acceptanceStatus,
      acceptedByName: currentAcceptance
        ? currentAcceptance.signerDisplayNameAtAcceptance || currentAcceptance.acceptedByAdult?.name || currentAcceptance.typedName || null
        : null,
      acceptedAtOrgTime: currentAcceptance ? formatOrgWallTime(currentAcceptance.acceptedAt.toISOString(), period.timezone, true) : null,
      contractLinkedOfferStatus,
      offerExpirationOrgTime,
      electionStatus,
      versionMismatchNote,
      operationalExceptionStatus: dispute ? dispute.status : null,
    });
  }

  const summary = emptySummaryTotals();
  summary.totalFamilies = rows.length;
  summary.totalBuyoutRevenueCents = undefined;
  summary.totalAssessmentsCents = undefined;
  summary.outstandingBalanceCents = undefined;
  for (const row of rows) {
    if (row.acceptanceStatus === "ACCEPTED") summary.familiesMeetingRequirement += 1;
    else if (row.acceptanceStatus === "NOT_REQUIRED") summary.familiesExempt += 1;
    else summary.familiesNotMeetingRequirement += 1;
  }

  const info = await buildReportInfo(organizationId, filters, "Family Agreement Status Report", generatedByName, [
    "Acceptance status reflects only the CURRENTLY assigned agreement version for this period — a household that accepted a prior, superseded version shows a version-mismatch note instead of ACCEPTED.",
    "Contract-linked offer status is NOT_APPLICABLE unless this period has contract-linked buyout enabled with an eligibility window configured.",
    "This report contains no dollar amounts, payment amounts, outstanding balances, or payment-provider identifiers — see Report E for buyout/assessment financial figures.",
    "Operational exception/review status reflects the most recent household-submitted volunteer-record dispute for this period, if any — it is not a financial or legal determination.",
  ]);
  // buildReportInfo doesn't know about this report's own extra filter surface
  // beyond what VolunteerReportFilters already covers; nothing additional to
  // merge in today since this report adds no report-specific filter fields.
  info.appliedFilters = describeAppliedFilters(filters);

  return { info, summary, rows };
}

const ACCEPTANCE_STATUS_LABEL: Record<AcceptanceStatus, string> = {
  NOT_REQUIRED: "Not required",
  NOT_YET_ACCEPTED: "Not yet accepted",
  ACCEPTED: "Accepted",
};

const OFFER_STATUS_LABEL: Record<ContractLinkedOfferStatus, string> = {
  NOT_APPLICABLE: "Not applicable",
  AWAITING_ACCEPTANCE: "Awaiting acceptance",
  OPEN: "Open",
  EXPIRED: "Expired",
};

const ELECTION_STATUS_LABEL: Record<FamilyElectionStatus, string> = {
  NONE: "None",
  VOLUNTEER: "Volunteer",
  PARTIAL_BUYOUT: "Partial buyout",
  FULL_BUYOUT: "Full buyout",
};

export const FAMILY_AGREEMENT_STATUS_COLUMNS: ReportColumn<FamilyAgreementStatusRow>[] = [
  { header: "Family", format: "text", width: 24, getValue: (r) => r.householdDisplayName },
  { header: "Agreement required", format: "text", width: 14, getValue: (r) => (r.agreementRequired ? "Yes" : "No") },
  { header: "Assigned agreement", format: "text", width: 26, getValue: (r) => (r.assignedAgreementTitle ? `${r.assignedAgreementTitle} (v${r.assignedAgreementVersionNumber})` : null) },
  { header: "Acceptance status", format: "text", width: 16, getValue: (r) => ACCEPTANCE_STATUS_LABEL[r.acceptanceStatus] },
  { header: "Accepted by", format: "text", width: 20, getValue: (r) => r.acceptedByName },
  { header: "Accepted (org time)", format: "text", width: 22, getValue: (r) => r.acceptedAtOrgTime },
  { header: "Contract-linked offer status", format: "text", width: 20, getValue: (r) => OFFER_STATUS_LABEL[r.contractLinkedOfferStatus] },
  { header: "Offer expiration (org time)", format: "text", width: 22, getValue: (r) => r.offerExpirationOrgTime },
  { header: "Election", format: "text", width: 16, getValue: (r) => ELECTION_STATUS_LABEL[r.electionStatus] },
  { header: "Version mismatch / reacceptance", format: "text", width: 34, getValue: (r) => r.versionMismatchNote },
  { header: "Operational exception/review", format: "text", width: 20, getValue: (r) => r.operationalExceptionStatus },
];

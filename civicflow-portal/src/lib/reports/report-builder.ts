import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildMemberWhere, calculateAge, calculateMemberOutstandingDues, memberExportInclude, parseMemberFilters } from "@/lib/member-filters";
import { formatCurrency, formatDate, formatDateTime, formatEnumLabel, formatPersonName } from "@/lib/formatting";
import { getVerticalTerminology } from "@/lib/vertical-terminology";

export const reportTypeOptions = [
  { value: "GENERAL_FINANCIAL", label: "General financial report" },
  { value: "CONTRIBUTIONS", label: "Contributions report" },
  { value: "CAMPAIGNS", label: "Campaign report" },
  { value: "EVENTS", label: "Event report" },
  { value: "MONTHLY_DUES_COLLECTION", label: "Monthly dues collection" },
  { value: "DUES_PAYMENT_DETAIL", label: "Dues payment detail" },
  { value: "OUTSTANDING_DUES", label: "Outstanding dues" },
  { value: "DUES_CURRENT_MEMBERS", label: "Members current on dues" },
  { value: "FULL_YEAR_DUES_PAID", label: "Members with full year dues paid" },
  { value: "DELINQUENT_MEMBERS", label: "Delinquent members" },
  { value: "CAMPAIGN_PAYERS", label: "Campaign / event payer report" },
  { value: "EXPENDITURES", label: "Expenditures" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "MEETING_ATTENDANCE", label: "Meeting attendance" },
  { value: "COMMUNICATIONS", label: "Communications" },
  { value: "PAYMENT_RECONCILIATION", label: "Payment reconciliation" },
  { value: "MEMBER_LOCATION", label: "Member demographic/location reports" },
  { value: "MEMBER_DEMOGRAPHICS", label: "Member demographics" },
  { value: "ACTIVE_MEMBER_ROSTER", label: "Active member roster" },
  { value: "DELINQUENT_MEMBER_ROSTER", label: "Delinquent member roster" },
  { value: "INACTIVE_MEMBER_ROSTER", label: "Inactive member roster" },
  { value: "TERMINATED_MEMBER_ROSTER", label: "Terminated member roster" },
] as const;

/** Which `OrgMember.membershipStatus` values fall under each roster bucket.
 * "Delinquent" isn't a membershipStatus value -- it's active + isDelinquent.
 * "Inactive" intentionally groups every status that isn't active, delinquent,
 * or terminated (see docs/member-lifecycle-termination.md's roster-bucket
 * table) -- a roster consumer cares about that three-way split more than the
 * five-way one, which stays visible per-row via the Status column. */
type RosterReportType = "ACTIVE_MEMBER_ROSTER" | "DELINQUENT_MEMBER_ROSTER" | "INACTIVE_MEMBER_ROSTER" | "TERMINATED_MEMBER_ROSTER";
const ROSTER_LABELS: Record<RosterReportType, string> = {
  ACTIVE_MEMBER_ROSTER: "Active",
  DELINQUENT_MEMBER_ROSTER: "Delinquent",
  INACTIVE_MEMBER_ROSTER: "Inactive",
  TERMINATED_MEMBER_ROSTER: "Terminated",
};

export type ReportType = (typeof reportTypeOptions)[number]["value"];
export type ReportCell = string | number | boolean | null;
export type ReportRow = Record<string, ReportCell>;
export type ReportSummaryItem = { label: string; value: string | number };

export type ReportChartItem = { label: string; amount: number };

export type ReportData = {
  title: string;
  columns: string[];
  /** Narrower column set for the PDF export only (CSV/XLSX always use `columns`). */
  pdfColumns?: string[];
  rows: ReportRow[];
  summary: ReportSummaryItem[];
  /** Simple magnitude-comparison data drawn as a bar chart in the PDF export, when present. */
  chartData?: ReportChartItem[];
  metadata: {
    reportType: ReportType;
    generatedAt: string;
    startDate: string | null;
    endDate: string | null;
    filters: Record<string, unknown>;
  };
};

export type BuildReportInput = {
  organizationId: string;
  reportType: ReportType;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  filters?: Record<string, unknown>;
  limit?: number;
};

export const MAX_REPORT_ROWS = 5000;

export function isReportType(value: string | null | undefined): value is ReportType {
  return reportTypeOptions.some((option) => option.value === value);
}

export function reportTitle(reportType: ReportType) {
  return reportTypeOptions.find((option) => option.value === reportType)?.label ?? formatEnumLabel(reportType);
}

export function parseReportDate(value: string | Date | null | undefined, endOfDay = false) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value.includes("T") ? value : `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateReportDateRange(startDate?: string | Date | null, endDate?: string | Date | null) {
  const start = parseReportDate(startDate);
  const end = parseReportDate(endDate, true);
  if (start && end && start > end) return { error: "Start date must be before end date." };
  return { start, end };
}

function dateWhere(start: Date | null, end: Date | null): Prisma.DateTimeFilter | undefined {
  if (!start && !end) return undefined;
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

function rowLimit(limit?: number) {
  return Math.max(1, Math.min(Number(limit ?? MAX_REPORT_ROWS), MAX_REPORT_ROWS));
}

function money(value: unknown) {
  return formatCurrency(Number(value ?? 0));
}

function total(rows: Array<{ amount?: unknown }>) {
  return rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
}

function filterValue(filters: Record<string, unknown> | undefined, key: string) {
  const value = filters?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function fullName(member: { firstName: string; lastName: string; preferredName?: string | null } | null | undefined) {
  return member ? formatPersonName(member) : "";
}

function baseReport(
  input: BuildReportInput,
  columns: string[],
  rows: ReportRow[],
  summary: ReportSummaryItem[],
  extra?: { pdfColumns?: string[]; chartData?: ReportChartItem[]; title?: string }
): ReportData {
  return {
    title: extra?.title ?? reportTitle(input.reportType),
    columns,
    ...(extra?.pdfColumns ? { pdfColumns: extra.pdfColumns } : {}),
    rows,
    summary,
    ...(extra?.chartData ? { chartData: extra.chartData } : {}),
    metadata: {
      reportType: input.reportType,
      generatedAt: new Date().toISOString(),
      startDate: parseReportDate(input.startDate)?.toISOString() ?? null,
      endDate: parseReportDate(input.endDate, true)?.toISOString() ?? null,
      filters: input.filters ?? {},
    },
  };
}

export async function buildReport(input: BuildReportInput): Promise<ReportData> {
  const dateValidation = validateReportDateRange(input.startDate, input.endDate);
  if (dateValidation.error) throw new Error(dateValidation.error);
  const start = dateValidation.start ?? null;
  const end = dateValidation.end ?? null;
  const organizationId = input.organizationId;
  const take = rowLimit(input.limit);
  const range = dateWhere(start, end);
  const memberId = filterValue(input.filters, "memberId");
  const categoryId = filterValue(input.filters, "categoryId");
  const campaignId = filterValue(input.filters, "campaignId");
  const eventId = filterValue(input.filters, "eventId");
  const meetingId = filterValue(input.filters, "meetingId");
  const status = filterValue(input.filters, "status");

  switch (input.reportType) {
    case "GENERAL_FINANCIAL": {
      const [contributions, duesPayments, expenditures, outstandingCharges, eventsInPeriod, activeCampaigns] = await Promise.all([
        prisma.contribution.findMany({ where: { organizationId, ...(range ? { contributionDate: range } : {}), ...(campaignId ? { campaignId } : {}), ...(eventId ? { eventId } : {}) }, select: { amount: true, campaignId: true, eventId: true } }),
        prisma.duesPayment.findMany({ where: { organizationId, ...(range ? { paymentDate: range } : {}), ...(memberId ? { memberId } : {}) }, select: { amount: true } }),
        prisma.expenditure.findMany({ where: { organizationId, ...(range ? { date: range } : {}), ...(campaignId ? { campaignId } : {}), ...(eventId ? { eventId } : {}) }, select: { amount: true } }),
        prisma.duesCharge.findMany({ where: { organizationId, status: { in: ["PENDING", "PARTIAL"] } }, include: { adjustments: { select: { amount: true } } } }),
        prisma.event.count({ where: { organizationId, ...(range ? { startAt: range } : {}) } }),
        prisma.campaign.count({
          where: {
            organizationId,
            // Campaigns overlapping the period (open-ended start/end treated as unbounded),
            // same semantics as the desktop app's "active campaigns" report section.
            ...(start || end
              ? {
                  AND: [
                    { OR: [{ startDate: null }, ...(end ? [{ startDate: { lte: end } }] : [])] },
                    { OR: [{ endDate: null }, ...(start ? [{ endDate: { gte: start } }] : [])] },
                  ],
                }
              : { status: "active" }),
          },
        }),
      ]);
      // `Contribution.source` is a channel (member profile / campaign page / etc.),
      // not an income category — bucket by which relation is set instead, same
      // split desktop's org financial report uses (dues / donations / campaign / event).
      const campaignContributions = contributions.filter((row) => row.campaignId);
      const eventContributions = contributions.filter((row) => !row.campaignId && row.eventId);
      const generalDonations = contributions.filter((row) => !row.campaignId && !row.eventId);
      const contributionTotal = total(contributions);
      const campaignContributionTotal = total(campaignContributions);
      const eventContributionTotal = total(eventContributions);
      const donationTotal = total(generalDonations);
      const duesTotal = total(duesPayments);
      const expenditureTotal = total(expenditures);
      const outstandingTotal = outstandingCharges.reduce((sum, charge) => {
        const adjustments = charge.adjustments.reduce((adjustmentSum, adjustment) => adjustmentSum + Number(adjustment.amount), 0);
        return sum + Math.max(0, Number(charge.amountDue) - Number(charge.amountPaid) - adjustments);
      }, 0);
      return baseReport(
        input,
        ["Metric", "Amount"],
        [
          { Metric: "Total income", Amount: money(contributionTotal + duesTotal) },
          { Metric: "Dues collected", Amount: money(duesTotal) },
          { Metric: "Donations", Amount: money(donationTotal) },
          { Metric: "Campaign contributions", Amount: money(campaignContributionTotal) },
          { Metric: "Event revenue", Amount: money(eventContributionTotal) },
          { Metric: "Expenditures", Amount: money(expenditureTotal) },
          { Metric: "Net cash activity", Amount: money(contributionTotal + duesTotal - expenditureTotal) },
          { Metric: "Outstanding dues (as of today)", Amount: money(outstandingTotal) },
          { Metric: "Events in period", Amount: eventsInPeriod },
          { Metric: "Active campaigns", Amount: activeCampaigns },
        ],
        [
          { label: "Total income", value: money(contributionTotal + duesTotal) },
          { label: "Dues collected", value: money(duesTotal) },
          { label: "Expenditures", value: money(expenditureTotal) },
          { label: "Outstanding dues", value: money(outstandingTotal) },
          { label: "Events in period", value: eventsInPeriod },
          { label: "Active campaigns", value: activeCampaigns },
        ],
        {
          chartData: [
            { label: "Dues", amount: duesTotal },
            { label: "Donations", amount: donationTotal },
            { label: "Campaign Contributions", amount: campaignContributionTotal },
            { label: "Event Revenue", amount: eventContributionTotal },
          ],
        }
      );
    }
    case "CONTRIBUTIONS": {
      const rows = await prisma.contribution.findMany({
        where: { organizationId, ...(range ? { contributionDate: range } : {}), ...(memberId ? { memberId } : {}), ...(campaignId ? { campaignId } : {}), ...(eventId ? { eventId } : {}) },
        include: { member: true, campaign: true, event: true },
        orderBy: { contributionDate: "desc" },
        take,
      });
      return baseReport(
        input,
        ["Date", "Member", "Amount", "Payment Method", "Campaign", "Event", "Source", "Receipt Requested"],
        rows.map((row) => ({
          Date: formatDate(row.contributionDate),
          Member: fullName(row.member),
          Amount: money(row.amount),
          "Payment Method": formatEnumLabel(row.paymentMethod),
          Campaign: row.campaign?.name ?? "",
          Event: row.event?.title ?? "",
          Source: formatEnumLabel(row.source),
          "Receipt Requested": row.receiptRequested ? "Yes" : "No",
        })),
        [{ label: "Total contributions", value: money(total(rows)) }, { label: "Rows", value: rows.length }]
      );
    }
    case "CAMPAIGNS": {
      const rows = await prisma.campaign.findMany({
        where: { organizationId, ...(campaignId ? { id: campaignId } : {}), ...(status ? { status } : {}), ...(range ? { OR: [{ startDate: range }, { endDate: range }, { createdAt: range }] } : {}) },
        include: { contributions: { select: { amount: true } } },
        orderBy: { createdAt: "desc" },
        take,
      });
      return baseReport(
        input,
        ["Campaign", "Status", "Goal", "Raised", "Start", "End", "Contribution Count"],
        rows.map((row) => ({ Campaign: row.name, Status: row.status, Goal: money(row.goal), Raised: money(total(row.contributions)), Start: formatDate(row.startDate), End: formatDate(row.endDate), "Contribution Count": row.contributions.length })),
        [{ label: "Campaigns", value: rows.length }, { label: "Raised", value: money(rows.reduce((sum, row) => sum + total(row.contributions), 0)) }]
      );
    }
    case "EVENTS": {
      const rows = await prisma.event.findMany({
        where: { organizationId, ...(eventId ? { id: eventId } : {}), ...(status ? { status } : {}), ...(range ? { OR: [{ startAt: range }, { createdAt: range }] } : {}) },
        include: { contributions: { select: { amount: true } }, attendanceRecords: { select: { id: true } } },
        orderBy: { startAt: "desc" },
        take,
      });
      return baseReport(
        input,
        ["Event", "Status", "Start", "Location", "Contributions", "Attendance Records"],
        rows.map((row) => ({ Event: row.title, Status: row.status, Start: formatDateTime(row.startAt), Location: row.location ?? "", Contributions: money(total(row.contributions)), "Attendance Records": row.attendanceRecords.length })),
        [{ label: "Events", value: rows.length }]
      );
    }
    case "MONTHLY_DUES_COLLECTION": {
      const rows = await prisma.duesPayment.findMany({
        where: { organizationId, ...(range ? { paymentDate: range } : {}), ...(memberId ? { memberId } : {}) },
        include: { member: true, duesCharge: true, duesAccount: true },
        orderBy: { paymentDate: "desc" },
        take,
      });
      return baseReport(
        input,
        ["Payment Date", "Member", "Amount", "Method", "Reference", "Charge Due Date", "Account"],
        rows.map((row) => ({ "Payment Date": formatDate(row.paymentDate), Member: fullName(row.member), Amount: money(row.amount), Method: formatEnumLabel(row.method), Reference: row.reference ?? "", "Charge Due Date": formatDate(row.duesCharge?.dueDate), Account: row.duesAccount?.name ?? "" })),
        [{ label: "Dues collected", value: money(total(rows)) }, { label: "Payments", value: rows.length }]
      );
    }
    case "OUTSTANDING_DUES": {
      const rows = await prisma.duesCharge.findMany({
        where: { organizationId, status: status ? (status as never) : { in: ["PENDING", "PARTIAL"] }, ...(range ? { dueDate: range } : {}), ...(memberId ? { memberId } : {}) },
        include: { member: true, duesAccount: true, adjustments: { select: { amount: true } } },
        orderBy: { dueDate: "asc" },
        take,
      });
      const mapped = rows.map((row) => {
        const adjustments = row.adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
        const outstanding = Math.max(0, Number(row.amountDue) - Number(row.amountPaid) - adjustments);
        return { "Due Date": formatDate(row.dueDate), Member: fullName(row.member), Account: row.duesAccount.name, Status: row.status, "Amount Due": money(row.amountDue), Paid: money(row.amountPaid), Adjustments: money(adjustments), Outstanding: money(outstanding) };
      });
      return baseReport(input, ["Due Date", "Member", "Account", "Status", "Amount Due", "Paid", "Adjustments", "Outstanding"], mapped, [{ label: "Outstanding total", value: money(rows.reduce((sum, row) => sum + Math.max(0, Number(row.amountDue) - Number(row.amountPaid) - row.adjustments.reduce((adjustmentSum, adjustment) => adjustmentSum + Number(adjustment.amount), 0)), 0)) }, { label: "Open charges", value: rows.length }]);
    }
    case "DELINQUENT_MEMBERS":
    case "MEMBER_LOCATION":
    case "MEMBER_DEMOGRAPHICS": {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(input.filters ?? {})) {
        if (typeof value === "string" && value) searchParams.set(key, value);
      }
      const where: Prisma.OrgMemberWhereInput = {
        ...buildMemberWhere(organizationId, parseMemberFilters(searchParams)),
        ...(input.reportType === "DELINQUENT_MEMBERS" ? { isDelinquent: true } : {}),
      };
      const rows = await prisma.orgMember.findMany({ where, include: memberExportInclude, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take });
      const columns = ["Name", "Status", "Category", "Age", "Gender", "Email", "Phone", "City", "State", "ZIP", "County", "Country", "Join Date", "Delinquent", "Outstanding Dues"];
      return baseReport(
        input,
        columns,
        rows.map((row) => ({ Name: fullName(row), Status: formatEnumLabel(row.membershipStatus), Category: row.membershipCategory?.name ?? "", Age: calculateAge(row.dateOfBirth), Gender: row.gender ?? "", Email: row.email ?? "", Phone: row.phone ?? "", City: row.city ?? "", State: row.state ?? "", ZIP: row.zipCode ?? "", County: row.county ?? "", Country: row.country ?? "", "Join Date": formatDate(row.joinDate), Delinquent: row.isDelinquent ? "Yes" : "No", "Outstanding Dues": money(calculateMemberOutstandingDues(row)) })),
        [{ label: "Members", value: rows.length }, { label: "Delinquent", value: rows.filter((row) => row.isDelinquent).length }],
        // Delinquent Members is a "who owes what" report — the PDF only needs
        // Name + Outstanding Dues; CSV/XLSX keep the full contact/demographic set.
        input.reportType === "DELINQUENT_MEMBERS" ? { pdfColumns: ["Name", "Outstanding Dues"] } : undefined
      );
    }
    case "ACTIVE_MEMBER_ROSTER":
    case "DELINQUENT_MEMBER_ROSTER":
    case "INACTIVE_MEMBER_ROSTER":
    case "TERMINATED_MEMBER_ROSTER": {
      const rosterType = input.reportType;
      const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { primaryVertical: true } });
      const terminology = getVerticalTerminology(organization.primaryVertical);
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(input.filters ?? {})) {
        if (typeof value === "string" && value) searchParams.set(key, value);
      }
      // The roster's own status bucket always wins over any caller-supplied
      // membershipStatus/delinquency filter -- spread after buildMemberWhere()
      // so e.g. a stray ?membershipStatus=terminated on the Active roster URL
      // can never leak terminated members under an "Active" title, and a
      // stray ?delinquency=... can't narrow Inactive/Terminated below what
      // their own roster count card shows (isDelinquent: undefined clears
      // whatever buildMemberWhere() may have set, same "assign undefined to
      // omit this filter" idiom used throughout this codebase's Prisma writes).
      const where: Prisma.OrgMemberWhereInput = {
        ...buildMemberWhere(organizationId, parseMemberFilters(searchParams)),
        ...(rosterType === "ACTIVE_MEMBER_ROSTER" ? { membershipStatus: "active", isDelinquent: false } : {}),
        ...(rosterType === "DELINQUENT_MEMBER_ROSTER" ? { membershipStatus: "active", isDelinquent: true } : {}),
        ...(rosterType === "INACTIVE_MEMBER_ROSTER" ? { membershipStatus: { in: ["inactive", "deactivated", "suspended", "pending", "retired"] }, isDelinquent: undefined } : {}),
        ...(rosterType === "TERMINATED_MEMBER_ROSTER" ? { membershipStatus: "terminated", isDelinquent: undefined } : {}),
      };
      const rows = await prisma.orgMember.findMany({ where, include: memberExportInclude, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take });
      // Reason/effective-date are only meaningful (and only populated) for
      // Inactive/Terminated -- statusChangeReason is the member-facing reason
      // text (never the staff-only internal note, which lives only in
      // MemberTimelineEvent and is never surfaced in any report).
      const includeStatusDetail = rosterType === "INACTIVE_MEMBER_ROSTER" || rosterType === "TERMINATED_MEMBER_ROSTER";
      const columns = [
        "Name",
        "Status",
        ...(includeStatusDetail ? ["Status Reason", "Status Changed"] : []),
        "Category",
        "Age",
        "Gender",
        "Email",
        "Phone",
        "City",
        "State",
        "ZIP",
        "County",
        "Country",
        "Join Date",
        ...(rosterType === "DELINQUENT_MEMBER_ROSTER" ? ["Outstanding Dues"] : []),
      ];
      return baseReport(
        input,
        columns,
        rows.map((row) => ({
          Name: fullName(row),
          Status: formatEnumLabel(row.membershipStatus),
          ...(includeStatusDetail ? { "Status Reason": row.statusChangeReason ?? "", "Status Changed": formatDate(row.statusChangedAt) } : {}),
          Category: row.membershipCategory?.name ?? "",
          Age: calculateAge(row.dateOfBirth),
          Gender: row.gender ?? "",
          Email: row.email ?? "",
          Phone: row.phone ?? "",
          City: row.city ?? "",
          State: row.state ?? "",
          ZIP: row.zipCode ?? "",
          County: row.county ?? "",
          Country: row.country ?? "",
          "Join Date": formatDate(row.joinDate),
          ...(rosterType === "DELINQUENT_MEMBER_ROSTER" ? { "Outstanding Dues": money(calculateMemberOutstandingDues(row)) } : {}),
        })),
        [{ label: terminology.memberPlural, value: rows.length }],
        { title: `${ROSTER_LABELS[rosterType]} ${terminology.memberPlural} Roster` }
      );
    }
    case "EXPENDITURES": {
      const rows = await prisma.expenditure.findMany({ where: { organizationId, ...(range ? { date: range } : {}), ...(campaignId ? { campaignId } : {}), ...(eventId ? { eventId } : {}) }, include: { categoryRef: true, paymentMethodConfig: true, campaign: true, event: true }, orderBy: { date: "desc" }, take });
      return baseReport(input, ["Date", "Vendor/Payee", "Amount", "Category", "Payment Method", "Campaign", "Event", "Reference", "Description"], rows.map((row) => ({ Date: formatDate(row.date), "Vendor/Payee": row.vendor ?? "", Amount: money(row.amount), Category: row.categoryRef?.name ?? row.category ?? "", "Payment Method": row.paymentMethodConfig?.label ?? row.paymentMethod ?? "", Campaign: row.campaign?.name ?? "", Event: row.event?.title ?? "", Reference: row.reference ?? "", Description: row.description })), [{ label: "Expenditure total", value: money(total(rows)) }, { label: "Rows", value: rows.length }]);
    }
    case "ATTENDANCE":
    case "MEETING_ATTENDANCE": {
      const rows = await prisma.attendanceRecord.findMany({ where: { organizationId, ...(input.reportType === "MEETING_ATTENDANCE" ? { meetingId: meetingId || { not: null } } : meetingId ? { meetingId } : {}), ...(eventId ? { eventId } : {}), ...(memberId ? { memberId } : {}), ...(status ? { attendanceStatus: status as never } : {}), ...(range ? { meetingDate: range } : {}) }, include: { member: true, event: true, meeting: true }, orderBy: { meetingDate: "desc" }, take });
      return baseReport(input, ["Date", "Member", "Status", "Meeting", "Event", "Check In", "Check Out", "Notes"], rows.map((row) => ({ Date: formatDate(row.meetingDate), Member: fullName(row.member), Status: formatEnumLabel(row.attendanceStatus), Meeting: row.meeting?.title ?? row.meetingTitle ?? "", Event: row.event?.title ?? "", "Check In": formatDateTime(row.checkInTime, ""), "Check Out": formatDateTime(row.checkOutTime, ""), Notes: row.notes ?? "" })), [{ label: "Attendance records", value: rows.length }, { label: "Present or virtual", value: rows.filter((row) => ["PRESENT", "VIRTUAL"].includes(row.attendanceStatus)).length }]);
    }
    case "COMMUNICATIONS": {
      const rows = await prisma.communicationLog.findMany({ where: { organizationId, ...(range ? { communicationDate: range } : {}), ...(memberId ? { memberId } : {}), ...(campaignId ? { campaignId } : {}), ...(eventId ? { eventId } : {}), ...(status ? { communicationType: status as never } : {}) }, include: { member: true, campaign: true, event: true }, orderBy: { communicationDate: "desc" }, take });
      return baseReport(input, ["Date", "Member", "Type", "Direction", "Subject", "Outcome", "Follow Up", "Campaign", "Event"], rows.map((row) => ({ Date: formatDateTime(row.communicationDate), Member: fullName(row.member), Type: formatEnumLabel(row.communicationType), Direction: formatEnumLabel(row.direction), Subject: row.subject ?? "", Outcome: row.outcome ?? "", "Follow Up": row.followUpRequired ? formatDate(row.followUpDate) : "No", Campaign: row.campaign?.name ?? "", Event: row.event?.title ?? "" })), [{ label: "Communication logs", value: rows.length }, { label: "Follow-ups", value: rows.filter((row) => row.followUpRequired).length }]);
    }
    case "PAYMENT_RECONCILIATION": {
      const rows = await prisma.paymentImportItem.findMany({ where: { organizationId, ...(range ? { transactionDate: range } : {}), ...(memberId ? { matchedMemberId: memberId } : {}), ...(campaignId ? { matchedCampaignId: campaignId } : {}), ...(eventId ? { matchedEventId: eventId } : {}), ...(status ? { verificationStatus: status as never } : {}) }, include: { matchedMember: true, matchedCampaign: true, matchedEvent: true, batch: true }, orderBy: { transactionDate: "desc" }, take });
      return baseReport(input, ["Date", "Source", "Payer", "Member", "Amount", "Verification", "Posted As", "Transaction ID", "Memo"], rows.map((row) => ({ Date: formatDate(row.transactionDate), Source: formatEnumLabel(row.sourceType), Payer: row.payerName ?? row.payerEmail ?? row.payerPhone ?? "", Member: fullName(row.matchedMember), Amount: money(row.amount), Verification: formatEnumLabel(row.verificationStatus), "Posted As": formatEnumLabel(row.postedAs, ""), "Transaction ID": row.externalTransactionId ?? "", Memo: row.memo ?? "" })), [{ label: "Imported payments", value: rows.length }, { label: "Total imported amount", value: money(total(rows)) }]);
    }
    case "DUES_CURRENT_MEMBERS": {
      const rows = await prisma.orgMember.findMany({
        where: {
          organizationId,
          membershipStatus: "active",
          isDelinquent: false,
          ...(categoryId ? { membershipCategoryId: categoryId } : {}),
        },
        include: {
          membershipCategory: { select: { name: true } },
          duesPayments: {
            orderBy: { paymentDate: "desc" },
            select: { paymentDate: true, amount: true, method: true },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take,
      });
      return baseReport(
        input,
        ["Name", "Email", "Phone", "Category", "Join Date", "Total Paid", "Last Payment Date", "Last Payment Amount", "Last Payment Method"],
        rows.map((row) => ({
          Name: fullName(row),
          Email: row.email ?? "",
          Phone: row.phone ?? "",
          Category: row.membershipCategory?.name ?? "",
          "Join Date": formatDate(row.joinDate),
          "Total Paid": money(total(row.duesPayments)),
          "Last Payment Date": row.duesPayments[0] ? formatDate(row.duesPayments[0].paymentDate) : "",
          "Last Payment Amount": row.duesPayments[0] ? money(row.duesPayments[0].amount) : "",
          "Last Payment Method": row.duesPayments[0] ? formatEnumLabel(row.duesPayments[0].method) : "",
        })),
        [{ label: "Members current on dues", value: rows.length }],
        // Mirror the desktop "Dues Current" report: PDF just needs Name + how
        // much they've paid in total; CSV/XLSX keep full contact/payment detail.
        { pdfColumns: ["Name", "Total Paid"] }
      );
    }
    case "FULL_YEAR_DUES_PAID": {
      // Analogous to the desktop app's "Members with Full Year Dues Paid"
      // report, but not numerically identical: desktop compares total dues
      // payments in the calendar year against a flat (current monthly rate
      // × 12) target, with no per-period charge ledger and no brought-forward
      // check. This version uses the actual DuesCharge ledger for the period
      // (correctly reflecting rate changes and partial-year membership) and
      // additionally excludes anyone who still owes money from before the
      // period — a member isn't "fully paid" if they're carrying a prior
      // unpaid balance, even if this period's charges are covered.
      // Defaults to the current calendar year when no date range is given,
      // like desktop's year picker; the portal's generic start/end pickers
      // let an org run it for any period, not just a full calendar year.
      const now = new Date();
      const periodStart = start ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const periodEnd = end ?? new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));

      const charges = await prisma.duesCharge.findMany({
        where: {
          organizationId,
          dueDate: { gte: periodStart, lte: periodEnd },
          status: { not: "VOID" },
          ...(categoryId ? { member: { membershipCategoryId: categoryId } } : {}),
        },
        include: {
          member: { select: { id: true, firstName: true, lastName: true, preferredName: true, email: true, phone: true, joinDate: true, membershipCategory: { select: { name: true } } } },
          adjustments: { select: { amount: true } },
        },
      });

      const byMember = new Map<
        string,
        { member: (typeof charges)[number]["member"]; totalDue: number; totalPaid: number; totalAdjustments: number }
      >();
      for (const charge of charges) {
        const existing = byMember.get(charge.memberId) ?? { member: charge.member, totalDue: 0, totalPaid: 0, totalAdjustments: 0 };
        existing.totalDue += Number(charge.amountDue);
        existing.totalPaid += Number(charge.amountPaid);
        existing.totalAdjustments += charge.adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
        byMember.set(charge.memberId, existing);
      }

      const inPeriodCandidates = [...byMember.entries()].filter(
        ([, entry]) => entry.totalDue > 0 && entry.totalPaid + entry.totalAdjustments >= entry.totalDue
      );

      // A member isn't truly "fully paid" if they still owe money from before
      // this period — check for any unpaid balance carried forward, even
      // though their in-period charges are covered.
      const priorCharges =
        inPeriodCandidates.length === 0
          ? []
          : await prisma.duesCharge.findMany({
              where: {
                organizationId,
                dueDate: { lt: periodStart },
                status: { not: "VOID" },
                memberId: { in: inPeriodCandidates.map(([memberId]) => memberId) },
              },
              select: { memberId: true, amountDue: true, amountPaid: true, adjustments: { select: { amount: true } } },
            });
      const priorBalanceByMember = new Map<string, number>();
      for (const charge of priorCharges) {
        const adjustments = charge.adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
        const outstanding = Math.max(0, Number(charge.amountDue) - Number(charge.amountPaid) - adjustments);
        priorBalanceByMember.set(charge.memberId, (priorBalanceByMember.get(charge.memberId) ?? 0) + outstanding);
      }

      const fullyPaid = inPeriodCandidates
        .filter(([memberId]) => (priorBalanceByMember.get(memberId) ?? 0) <= 0)
        .map(([, entry]) => entry)
        .sort((a, b) => (a.member.lastName + a.member.firstName).localeCompare(b.member.lastName + b.member.firstName))
        .slice(0, take);

      return baseReport(
        input,
        ["Name", "Email", "Phone", "Category", "Join Date", "Total Due", "Paid in Year", "Adjustments"],
        fullyPaid.map((entry) => ({
          Name: fullName(entry.member),
          Email: entry.member.email ?? "",
          Phone: entry.member.phone ?? "",
          Category: entry.member.membershipCategory?.name ?? "",
          "Join Date": formatDate(entry.member.joinDate),
          "Total Due": money(entry.totalDue),
          "Paid in Year": money(entry.totalPaid),
          Adjustments: money(entry.totalAdjustments),
        })),
        [
          { label: "Members fully paid", value: fullyPaid.length },
          {
            label: "Excluded for prior-year balance",
            value: inPeriodCandidates.length - fullyPaid.length,
          },
        ],
        // Slim PDF to Name + amount paid, matching the desktop app; CSV/XLSX
        // keep full contact/category detail.
        { pdfColumns: ["Name", "Paid in Year"] }
      );
    }
    case "DUES_PAYMENT_DETAIL": {
      const rows = await prisma.duesPayment.findMany({
        where: {
          organizationId,
          ...(range ? { paymentDate: range } : {}),
          ...(memberId ? { memberId } : {}),
        },
        include: {
          member: { select: { firstName: true, lastName: true, preferredName: true, email: true, phone: true } },
          duesCharge: { select: { amountDue: true, amountPaid: true, status: true, periodStart: true, periodEnd: true } },
          duesAccount: { select: { name: true } },
        },
        orderBy: { paymentDate: "desc" },
        take,
      });
      return baseReport(
        input,
        ["Payment Date", "Member", "Email", "Phone", "Amount", "Method", "Account", "Period Start", "Period End", "Charge Amount", "Charge Status", "Reference"],
        rows.map((row) => ({
          "Payment Date": formatDate(row.paymentDate),
          Member: fullName(row.member),
          Email: row.member.email ?? "",
          Phone: row.member.phone ?? "",
          Amount: money(row.amount),
          Method: formatEnumLabel(row.method),
          Account: row.duesAccount?.name ?? "",
          "Period Start": formatDate(row.duesCharge?.periodStart),
          "Period End": formatDate(row.duesCharge?.periodEnd),
          "Charge Amount": row.duesCharge ? money(row.duesCharge.amountDue) : "",
          "Charge Status": row.duesCharge ? formatEnumLabel(row.duesCharge.status) : "",
          Reference: row.reference ?? "",
        })),
        [
          { label: "Total collected", value: money(total(rows)) },
          { label: "Payments", value: rows.length },
        ],
      );
    }
    case "CAMPAIGN_PAYERS": {
      const rows = await prisma.contribution.findMany({
        where: {
          organizationId,
          ...(campaignId ? { campaignId } : {}),
          ...(eventId ? { eventId } : {}),
          ...(range ? { contributionDate: range } : {}),
        },
        include: {
          member: { select: { firstName: true, lastName: true, preferredName: true, email: true, phone: true } },
          campaign: { select: { name: true } },
          event: { select: { title: true } },
        },
        orderBy: { contributionDate: "desc" },
        take,
      });
      return baseReport(
        input,
        ["Date", "Member / Contributor", "Email", "Phone", "Amount", "Payment Method", "Campaign", "Event", "Source"],
        rows.map((row) => ({
          Date: formatDate(row.contributionDate),
          "Member / Contributor": fullName(row.member) || (row.contributorName ?? "Anonymous"),
          Email: row.member?.email ?? "",
          Phone: row.member?.phone ?? "",
          Amount: money(row.amount),
          "Payment Method": formatEnumLabel(row.paymentMethod),
          Campaign: row.campaign?.name ?? "",
          Event: row.event?.title ?? "",
          Source: formatEnumLabel(row.source),
        })),
        [
          { label: "Total raised", value: money(total(rows)) },
          { label: "Contributions", value: rows.length },
          { label: "Unique contributors", value: new Set(rows.map((r) => r.memberId ?? r.contributorName ?? "anon")).size },
        ],
      );
    }
    default:
      return baseReport(input, ["Message"], [{ Message: "Unsupported report type" }], []);
  }
}

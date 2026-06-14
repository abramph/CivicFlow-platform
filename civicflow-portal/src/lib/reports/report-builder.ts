import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildMemberWhere, calculateAge, calculateMemberOutstandingDues, memberExportInclude, parseMemberFilters } from "@/lib/member-filters";
import { formatCurrency, formatDate, formatDateTime, formatEnumLabel, formatPersonName } from "@/lib/formatting";

export const reportTypeOptions = [
  { value: "GENERAL_FINANCIAL", label: "General financial report" },
  { value: "CONTRIBUTIONS", label: "Contributions report" },
  { value: "CAMPAIGNS", label: "Campaign report" },
  { value: "EVENTS", label: "Event report" },
  { value: "MONTHLY_DUES_COLLECTION", label: "Monthly dues collection" },
  { value: "OUTSTANDING_DUES", label: "Outstanding dues" },
  { value: "DELINQUENT_MEMBERS", label: "Delinquent members" },
  { value: "EXPENDITURES", label: "Expenditures" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "MEETING_ATTENDANCE", label: "Meeting attendance" },
  { value: "COMMUNICATIONS", label: "Communications" },
  { value: "PAYMENT_RECONCILIATION", label: "Payment reconciliation" },
  { value: "MEMBER_LOCATION", label: "Member demographic/location reports" },
  { value: "MEMBER_DEMOGRAPHICS", label: "Member demographics" },
] as const;

export type ReportType = (typeof reportTypeOptions)[number]["value"];
export type ReportCell = string | number | boolean | null;
export type ReportRow = Record<string, ReportCell>;
export type ReportSummaryItem = { label: string; value: string | number };

export type ReportData = {
  title: string;
  columns: string[];
  rows: ReportRow[];
  summary: ReportSummaryItem[];
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

const MAX_REPORT_ROWS = 5000;

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

function baseReport(input: BuildReportInput, columns: string[], rows: ReportRow[], summary: ReportSummaryItem[]): ReportData {
  return {
    title: reportTitle(input.reportType),
    columns,
    rows,
    summary,
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
  const campaignId = filterValue(input.filters, "campaignId");
  const eventId = filterValue(input.filters, "eventId");
  const meetingId = filterValue(input.filters, "meetingId");
  const status = filterValue(input.filters, "status");

  switch (input.reportType) {
    case "GENERAL_FINANCIAL": {
      const [contributions, duesPayments, expenditures, outstandingCharges] = await Promise.all([
        prisma.contribution.findMany({ where: { organizationId, ...(range ? { contributionDate: range } : {}), ...(campaignId ? { campaignId } : {}), ...(eventId ? { eventId } : {}) }, select: { amount: true } }),
        prisma.duesPayment.findMany({ where: { organizationId, ...(range ? { paymentDate: range } : {}), ...(memberId ? { memberId } : {}) }, select: { amount: true } }),
        prisma.expenditure.findMany({ where: { organizationId, ...(range ? { date: range } : {}), ...(campaignId ? { campaignId } : {}), ...(eventId ? { eventId } : {}) }, select: { amount: true } }),
        prisma.duesCharge.findMany({ where: { organizationId, status: { in: ["PENDING", "PARTIAL"] } }, include: { adjustments: { select: { amount: true } } } }),
      ]);
      const contributionTotal = total(contributions);
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
          { Metric: "Contributions", Amount: money(contributionTotal) },
          { Metric: "Dues collected", Amount: money(duesTotal) },
          { Metric: "Expenditures", Amount: money(expenditureTotal) },
          { Metric: "Net cash activity", Amount: money(contributionTotal + duesTotal - expenditureTotal) },
          { Metric: "Outstanding dues", Amount: money(outstandingTotal) },
        ],
        [
          { label: "Contribution total", value: money(contributionTotal) },
          { label: "Dues collected", value: money(duesTotal) },
          { label: "Expenditures", value: money(expenditureTotal) },
          { label: "Outstanding dues", value: money(outstandingTotal) },
        ]
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
        [{ label: "Members", value: rows.length }, { label: "Delinquent", value: rows.filter((row) => row.isDelinquent).length }]
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
    default:
      return baseReport(input, ["Message"], [{ Message: "Unsupported report type" }], []);
  }
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ReportType =
  | "family-summary"
  | "detail-activity"
  | "event-hours"
  | "compliance"
  | "financial"
  | "individual-volunteer"
  | "volunteer-category"
  | "family-agreement-status";

const REPORT_LABELS: Record<ReportType, string> = {
  "family-summary": "A — Family Volunteer Summary",
  "detail-activity": "B — Detailed Family Volunteer Activity",
  "event-hours": "C — Event Volunteer-Hours",
  compliance: "D — Volunteer Requirement Compliance",
  financial: "E — Purchased-Hours & Financial",
  "individual-volunteer": "F — Individual Volunteer",
  "volunteer-category": "G — Volunteer Category",
  "family-agreement-status": "H — Family Agreement Status",
};

const REPORT_TYPE_TO_EXPORT_TYPE: Record<ReportType, string> = {
  "family-summary": "PTA_VOLUNTEER_FAMILY_SUMMARY",
  "detail-activity": "PTA_VOLUNTEER_DETAIL_ACTIVITY",
  "event-hours": "PTA_VOLUNTEER_EVENT_HOURS",
  compliance: "PTA_VOLUNTEER_COMPLIANCE",
  financial: "PTA_VOLUNTEER_FINANCIAL",
  "individual-volunteer": "PTA_VOLUNTEER_INDIVIDUAL",
  "volunteer-category": "PTA_VOLUNTEER_CATEGORY",
  "family-agreement-status": "PTA_VOLUNTEER_FAMILY_AGREEMENT_STATUS",
};

const VOLUNTEER_CATEGORIES = [
  "EVENT_SERVICE",
  "COMMITTEE_SERVICE",
  "CLASSROOM_SERVICE",
  "SCHOOL_ACTIVITY",
  "FUNDRAISING",
  "ADMINISTRATIVE_SUPPORT",
  "AT_HOME_SERVICE",
  "DONATED_GOODS",
  "OTHER_APPROVED_SERVICE",
];

const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

const COMPLIANCE_FILTERS = ["MET", "NOT_MET", "NO_HOURS", "PENDING", "ELIGIBLE_FOR_BUYOUT", "SUBJECT_TO_ASSESSMENT", "EXEMPT"];

interface ReportRow {
  [key: string]: unknown;
}

interface ReportInfoMeta {
  organizationName: string;
  reportTitle: string;
  requirementPeriodName: string;
  coveredDateRange: string;
  generatedAt: string;
  generatedByName: string;
  organizationTimezone: string;
}

interface ReportSummaryTotals {
  totalFamilies: number;
  totalIndividualVolunteers: number;
  totalVerifiedMinutes: number;
  totalEventMinutes: number;
  totalNonEventMinutes: number;
  totalPendingMinutes: number;
  totalPurchasedMinutes: number;
  totalWaivedMinutes: number;
  totalRemainingMinutes: number;
  familiesMeetingRequirement: number;
  familiesNotMeetingRequirement: number;
  familiesExempt: number;
  totalBuyoutRevenueCents: number;
  totalAssessmentsCents: number;
  outstandingBalanceCents: number;
}

interface ReportDataShape {
  info: ReportInfoMeta;
  summary: ReportSummaryTotals;
  rows: ReportRow[];
}

type ColumnKind = "text" | "integer" | "currency" | "date" | "datetime" | "percent" | "hours" | "bool";

interface DisplayColumn {
  key: string;
  header: string;
  kind: ColumnKind;
}

const COLUMNS: Record<ReportType, DisplayColumn[]> = {
  "family-summary": [
    { key: "householdDisplayName", header: "Family", kind: "text" },
    { key: "primaryContactName", header: "Primary contact", kind: "text" },
    { key: "membershipStatus", header: "Membership", kind: "text" },
    { key: "adjustedRequiredMinutes", header: "Required (h)", kind: "hours" },
    { key: "verifiedMinutes", header: "Verified (h)", kind: "hours" },
    { key: "purchasedMinutes", header: "Purchased (h)", kind: "hours" },
    { key: "waivedMinutes", header: "Waived (h)", kind: "hours" },
    { key: "remainingMinutes", header: "Remaining (h)", kind: "hours" },
    { key: "completionPercent", header: "Completion", kind: "percent" },
    { key: "requirementStatus", header: "Status", kind: "text" },
    { key: "buyoutAmountPaidCents", header: "Buyout paid", kind: "currency" },
    { key: "assessmentAmountCents", header: "Assessment", kind: "currency" },
    { key: "outstandingBalanceCents", header: "Outstanding", kind: "currency" },
  ],
  "detail-activity": [
    { key: "householdDisplayName", header: "Family", kind: "text" },
    { key: "volunteerName", header: "Volunteer", kind: "text" },
    { key: "serviceDate", header: "Service date", kind: "date" },
    { key: "eventOrActivityName", header: "Event / activity", kind: "text" },
    { key: "volunteerCategory", header: "Category", kind: "text" },
    { key: "isEventBased", header: "Event-based", kind: "bool" },
    { key: "reportedMinutes", header: "Reported (h)", kind: "hours" },
    { key: "approvalStatus", header: "Approval status", kind: "text" },
    { key: "approvedByName", header: "Approved by", kind: "text" },
    { key: "location", header: "Location", kind: "text" },
  ],
  "event-hours": [
    { key: "eventName", header: "Event", kind: "text" },
    { key: "eventDate", header: "Event date", kind: "date" },
    { key: "opportunityCount", header: "Opportunities", kind: "integer" },
    { key: "signupCount", header: "Signups", kind: "integer" },
    { key: "attendedCount", header: "Attended", kind: "integer" },
    { key: "noShowCount", header: "No-shows", kind: "integer" },
    { key: "familyCount", header: "Families", kind: "integer" },
    { key: "individualVolunteerCount", header: "Volunteers", kind: "integer" },
    { key: "totalVerifiedMinutes", header: "Verified (h)", kind: "hours" },
    { key: "totalPendingMinutes", header: "Pending (h)", kind: "hours" },
    { key: "eventStatus", header: "Status", kind: "text" },
  ],
  compliance: [
    { key: "householdDisplayName", header: "Family", kind: "text" },
    { key: "adjustedRequiredMinutes", header: "Required (h)", kind: "hours" },
    { key: "verifiedMinutes", header: "Verified (h)", kind: "hours" },
    { key: "purchasedMinutes", header: "Purchased (h)", kind: "hours" },
    { key: "remainingMinutes", header: "Remaining (h)", kind: "hours" },
    { key: "completionPercent", header: "Completion", kind: "percent" },
    { key: "completionStatus", header: "Status", kind: "text" },
    { key: "volunteerDeadline", header: "Deadline", kind: "date" },
    { key: "daysRemainingOrOverdue", header: "Days left/over", kind: "integer" },
    { key: "estimatedFinalAssessmentCents", header: "Est. assessment", kind: "currency" },
  ],
  financial: [
    { key: "householdDisplayName", header: "Family", kind: "text" },
    { key: "transactionType", header: "Type", kind: "text" },
    { key: "transactionDate", header: "Date", kind: "date" },
    { key: "description", header: "Description", kind: "text" },
    { key: "hoursMinutes", header: "Hours", kind: "hours" },
    { key: "totalAmountCents", header: "Total", kind: "currency" },
    { key: "amountPaidCents", header: "Paid", kind: "currency" },
    { key: "refundedCents", header: "Refunded", kind: "currency" },
    { key: "outstandingCents", header: "Outstanding", kind: "currency" },
    { key: "paymentMethod", header: "Payment method", kind: "text" },
    { key: "status", header: "Status", kind: "text" },
  ],
  "individual-volunteer": [
    { key: "volunteerName", header: "Volunteer", kind: "text" },
    { key: "householdDisplayName", header: "Family", kind: "text" },
    { key: "verifiedMinutes", header: "Verified (h)", kind: "hours" },
    { key: "eventMinutes", header: "Event (h)", kind: "hours" },
    { key: "nonEventMinutes", header: "Non-event (h)", kind: "hours" },
    { key: "entryCount", header: "Entries", kind: "integer" },
    { key: "categoriesServed", header: "Categories", kind: "text" },
    { key: "lastServiceDate", header: "Last service date", kind: "date" },
  ],
  "volunteer-category": [
    { key: "category", header: "Category", kind: "text" },
    { key: "verifiedMinutes", header: "Verified (h)", kind: "hours" },
    { key: "pendingMinutes", header: "Pending (h)", kind: "hours" },
    { key: "entryCount", header: "Entries", kind: "integer" },
    { key: "uniqueVolunteers", header: "Volunteers", kind: "integer" },
    { key: "uniqueFamilies", header: "Families", kind: "integer" },
  ],
  "family-agreement-status": [
    { key: "householdDisplayName", header: "Family", kind: "text" },
    { key: "agreementRequired", header: "Required", kind: "bool" },
    { key: "assignedAgreementTitle", header: "Assigned agreement", kind: "text" },
    { key: "acceptanceStatus", header: "Acceptance status", kind: "text" },
    { key: "acceptedByName", header: "Accepted by", kind: "text" },
    { key: "acceptedAtOrgTime", header: "Accepted (org time)", kind: "text" },
    { key: "contractLinkedOfferStatus", header: "Contract-linked offer", kind: "text" },
    { key: "offerExpirationOrgTime", header: "Offer expiration (org time)", kind: "text" },
    { key: "electionStatus", header: "Election", kind: "text" },
    { key: "versionMismatchNote", header: "Version mismatch / reacceptance", kind: "text" },
    { key: "operationalExceptionStatus", header: "Operational exception/review", kind: "text" },
  ],
};

function formatCell(kind: ColumnKind, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (kind) {
    case "hours":
      return typeof value === "number" ? `${(value / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })}h` : "—";
    case "currency":
      return typeof value === "number" ? (value / 100).toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—";
    case "percent":
      return typeof value === "number" ? `${value}%` : "—";
    case "integer":
      return typeof value === "number" ? value.toLocaleString() : "—";
    case "date":
      return typeof value === "string" ? new Date(value).toLocaleDateString() : "—";
    case "datetime":
      return typeof value === "string" ? new Date(value).toLocaleString() : "—";
    case "bool":
      return value ? "Yes" : "No";
    default:
      return String(value);
  }
}

/** VH-J Volunteer Hours Reporting Center — Reports A-D. On-screen tables call
 * the exact same report-data API the .xlsx export route calls, so the numbers
 * shown here can never diverge from the downloaded workbook (spec §14). */
export function PtaVolunteerReportsCenter({
  periodId,
  canExport,
  canViewFinancial,
}: {
  periodId: string;
  canExport: boolean;
  canViewFinancial: boolean;
}) {
  const router = useRouter();
  const [reportType, setReportType] = useState<ReportType>("family-summary");
  const [dateRangeStart, setDateRangeStart] = useState("");
  const [dateRangeEnd, setDateRangeEnd] = useState("");
  const [householdId, setHouseholdId] = useState("");
  const [eventId, setEventId] = useState("");
  const [volunteerCategory, setVolunteerCategory] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("");
  const [requirementStatus, setRequirementStatus] = useState("");
  const [complianceFilter, setComplianceFilter] = useState("");
  const [data, setData] = useState<ReportDataShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingQueueExport, setPendingQueueExport] = useState(false);
  const [exportsRefreshToken, setExportsRefreshToken] = useState(0);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (dateRangeStart) params.set("dateRangeStart", dateRangeStart);
    if (dateRangeEnd) params.set("dateRangeEnd", dateRangeEnd);
    if (householdId) params.set("householdId", householdId);
    if (eventId) params.set("eventId", eventId);
    if (volunteerCategory) params.set("volunteerCategory", volunteerCategory);
    if (approvalStatus) params.set("approvalStatus", approvalStatus);
    if (requirementStatus) params.set("requirementStatus", requirementStatus);
    if (complianceFilter) params.set("complianceFilter", complianceFilter);
    return params.toString();
  }, [dateRangeStart, dateRangeEnd, householdId, eventId, volunteerCategory, approvalStatus, requirementStatus, complianceFilter]);

  useEffect(() => {
    let cancelled = false;
    // Reactive refetch on filter/report-type change, guarded by the
    // cancelled flag below — the React-docs data-fetching-effect shape.
    setLoading(true);
    const url = `/api/labs/pta/volunteer-hours/periods/${periodId}/reports/${reportType}${queryString ? `?${queryString}` : ""}`;
    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body?.ok) {
          setError(body?.error || "Unable to load this report.");
          setData(null);
          return;
        }
        setError(null);
        setData(body.data);
      })
      .catch(() => !cancelled && setError("Unable to connect. Please try again."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [periodId, reportType, queryString]);

  const columns = COLUMNS[reportType];
  const exportHref = `/api/labs/pta/volunteer-hours/periods/${periodId}/reports/${reportType}/export${queryString ? `?${queryString}` : ""}`;

  async function queueBackgroundExport() {
    setPendingQueueExport(true);
    setError(null);
    try {
      const body: Record<string, string> = { reportType: REPORT_TYPE_TO_EXPORT_TYPE[reportType] };
      if (dateRangeStart) body.dateRangeStart = new Date(dateRangeStart).toISOString();
      if (dateRangeEnd) body.dateRangeEnd = new Date(dateRangeEnd).toISOString();
      if (householdId) body.householdId = householdId;
      if (eventId) body.eventId = eventId;
      if (volunteerCategory) body.volunteerCategory = volunteerCategory;
      if (approvalStatus) body.approvalStatus = approvalStatus;
      if (requirementStatus) body.requirementStatus = requirementStatus;
      if (complianceFilter) body.complianceFilter = complianceFilter;

      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/reports/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody = await res.json().catch(() => null);
      if (!res.ok || !responseBody?.ok) {
        setError(responseBody?.error || "Unable to queue this export.");
        return;
      }
      setExportsRefreshToken((t) => t + 1);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPendingQueueExport(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs font-semibold text-slate-600">
          Report
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
            className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            {(Object.keys(REPORT_LABELS) as ReportType[])
              .filter((key) => key !== "financial" || canViewFinancial)
              .map((key) => (
                <option key={key} value={key}>
                  {REPORT_LABELS[key]}
                </option>
              ))}
          </select>
        </label>

        {reportType === "family-summary" ? (
          <>
            <FilterInput label="Family ID" value={householdId} onChange={setHouseholdId} />
            <FilterSelect
              label="Requirement status"
              value={requirementStatus}
              onChange={setRequirementStatus}
              options={["NOT_STARTED", "IN_PROGRESS", "MET_SERVICE", "MET_BUYOUT", "MET_COMBINED", "EXEMPT", "OVERDUE", "ASSESSMENT_DUE", "ASSESSMENT_PAID"]}
            />
          </>
        ) : null}

        {reportType === "detail-activity" ? (
          <>
            <FilterInput label="From" type="date" value={dateRangeStart} onChange={setDateRangeStart} />
            <FilterInput label="To" type="date" value={dateRangeEnd} onChange={setDateRangeEnd} />
            <FilterInput label="Family ID" value={householdId} onChange={setHouseholdId} />
            <FilterInput label="Event ID" value={eventId} onChange={setEventId} />
            <FilterSelect label="Category" value={volunteerCategory} onChange={setVolunteerCategory} options={VOLUNTEER_CATEGORIES} />
            <FilterSelect label="Approval status" value={approvalStatus} onChange={setApprovalStatus} options={APPROVAL_STATUSES} />
          </>
        ) : null}

        {reportType === "event-hours" ? (
          <>
            <FilterInput label="From" type="date" value={dateRangeStart} onChange={setDateRangeStart} />
            <FilterInput label="To" type="date" value={dateRangeEnd} onChange={setDateRangeEnd} />
            <FilterInput label="Event ID" value={eventId} onChange={setEventId} />
          </>
        ) : null}

        {reportType === "compliance" ? <FilterSelect label="Compliance" value={complianceFilter} onChange={setComplianceFilter} options={COMPLIANCE_FILTERS} /> : null}

        {reportType === "family-agreement-status" ? <FilterInput label="Family ID" value={householdId} onChange={setHouseholdId} /> : null}

        {reportType === "financial" ? (
          <>
            <FilterInput label="From" type="date" value={dateRangeStart} onChange={setDateRangeStart} />
            <FilterInput label="To" type="date" value={dateRangeEnd} onChange={setDateRangeEnd} />
            <FilterInput label="Family ID" value={householdId} onChange={setHouseholdId} />
          </>
        ) : null}

        {reportType === "individual-volunteer" || reportType === "volunteer-category" ? (
          <>
            <FilterInput label="From" type="date" value={dateRangeStart} onChange={setDateRangeStart} />
            <FilterInput label="To" type="date" value={dateRangeEnd} onChange={setDateRangeEnd} />
            <FilterSelect label="Category" value={volunteerCategory} onChange={setVolunteerCategory} options={VOLUNTEER_CATEGORIES} />
          </>
        ) : null}

        {canExport ? (
          <a
            href={exportHref}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            Export to Excel
          </a>
        ) : null}
        {canExport ? (
          <button
            type="button"
            disabled={pendingQueueExport}
            onClick={queueBackgroundExport}
            className="ml-auto rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            {pendingQueueExport ? "Queuing..." : "Generate in background"}
          </button>
        ) : null}
      </div>

      {canExport ? <BackgroundExportsPanel periodId={periodId} refreshToken={exportsRefreshToken} /> : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">Loading report...</p> : null}

      {!loading && data ? (
        <>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {data.info.organizationName} · {data.info.requirementPeriodName} · {data.info.coveredDateRange} · Generated{" "}
            {new Date(data.info.generatedAt).toLocaleString()} by {data.info.generatedByName}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryStat label="Families" value={data.summary.totalFamilies.toLocaleString()} />
            <SummaryStat label="Meeting requirement" value={data.summary.familiesMeetingRequirement.toLocaleString()} />
            <SummaryStat label="Not meeting" value={data.summary.familiesNotMeetingRequirement.toLocaleString()} />
            <SummaryStat label="Exempt" value={data.summary.familiesExempt.toLocaleString()} />
            <SummaryStat label="Verified hours" value={(data.summary.totalVerifiedMinutes / 60).toFixed(2)} />
            <SummaryStat label="Purchased hours" value={(data.summary.totalPurchasedMinutes / 60).toFixed(2)} />
            <SummaryStat label="Remaining hours" value={(data.summary.totalRemainingMinutes / 60).toFixed(2)} />
            <SummaryStat
              label="Outstanding balance"
              value={(data.summary.outstandingBalanceCents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {columns.map((col) => (
                    <th key={col.key} className="py-2 pr-4">
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="py-4 text-center text-slate-500">
                      No rows match the current filters.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((col) => (
                        <td key={col.key} className="py-2 pr-4">
                          {formatCell(col.kind, row[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FilterInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col text-xs font-semibold text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-36 rounded border border-slate-300 px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex flex-col text-xs font-semibold text-slate-600">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm">
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

const EXPORT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  (Object.keys(REPORT_TYPE_TO_EXPORT_TYPE) as ReportType[]).map((key) => [REPORT_TYPE_TO_EXPORT_TYPE[key], REPORT_LABELS[key]])
);

interface BackgroundExportRow {
  id: string;
  reportType: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
}

/** Lists this period's queued/processing/completed/failed background report
 * exports (spec: "background generation for large orgs"), polling once on
 * mount and again whenever a new export is queued. Reuses the same
 * ReportExport-backed worker every other export in this platform uses. */
function BackgroundExportsPanel({ periodId, refreshToken }: { periodId: string; refreshToken: number }) {
  const [rows, setRows] = useState<BackgroundExportRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Reactive refetch when a new export is queued — same sanctioned
    // data-fetching-effect shape as the report-data effect above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(false);
    fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/reports/exports`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok) setRows(body.data ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [periodId, refreshToken]);

  if (!loaded || rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Background exports</h4>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3">
            <span>
              {EXPORT_TYPE_LABELS[row.reportType] ?? row.reportType} — {row.status.toLowerCase()}
              {row.status === "FAILED" && row.errorMessage ? `: ${row.errorMessage}` : ""}
            </span>
            {row.status === "COMPLETED" ? (
              <a
                href={`/api/labs/pta/volunteer-hours/periods/${periodId}/reports/exports/${row.id}/download`}
                className="font-semibold text-emerald-700 hover:underline"
              >
                Download
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

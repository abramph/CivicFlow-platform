import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listPendingPtaVolunteerHourEntries } from "@/lib/labs/pta/volunteers";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { HourEntryApprovalControls } from "@/components/labs/pta/HourEntryApprovalControls";
import { formatDateTime } from "@/lib/formatting";

function minutesToHours(minutes: number): string {
  return (minutes / 60).toFixed(2).replace(/\.?0+$/, "") || "0";
}

export default async function PtaVolunteerHourApprovalsPage() {
  const { organizationId, access } = await getPtaPageGate("pta:volunteer-hours:approve");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer Hour Approvals" description="Not available for this organization." />
      </main>
    );
  }

  const entries = await listPendingPtaVolunteerHourEntries(organizationId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <Breadcrumbs items={[{ href: "/labs/pta/volunteers/manage", label: "Manage Volunteers" }, { label: "Hour Approvals" }]} />
      <PageHeader
        title="Volunteer Hour Approvals"
        description="Only APPROVED entries ever count toward a household's total — nothing here is credited until an officer acts on it. An officer can never approve their own hours."
      />

      <SectionCard title="Pending" description={`${entries.length} entry(ies) awaiting review.`}>
        {entries.length === 0 ? (
          <EmptyState title="Nothing pending" description="Every reported volunteer shift has been reviewed." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold text-slate-900">{entry.signup.householdAdult.name}</p>
                  <p className="text-sm text-slate-600">
                    <Link href={`/labs/pta/volunteers/manage/${entry.opportunityId}`} className="text-emerald-700 hover:underline">
                      {entry.signup.slot.opportunity.title}
                    </Link>
                    {" · "}
                    {minutesToHours(entry.creditedMinutes)} hour(s) proposed
                    {entry.signup.attendance?.checkInAt && entry.signup.attendance?.checkOutAt ? " (from check-in/out)" : ""}
                  </p>
                  <p className="text-xs text-slate-500">Submitted {formatDateTime(entry.createdAt)}</p>
                </div>
                <HourEntryApprovalControls entryId={entry.id} defaultMinutes={entry.creditedMinutes} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}

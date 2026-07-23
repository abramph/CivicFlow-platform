import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaHousehold } from "@/lib/labs/pta/households";
import { getPtaHouseholdDuesStatus } from "@/lib/labs/pta/dues";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { listPtaClassrooms, getPtaStudentEnrollment } from "@/lib/labs/pta/academic";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { Breadcrumbs, StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { AddHouseholdAdultForm } from "@/components/labs/pta/AddHouseholdAdultForm";
import { AddStudentForm } from "@/components/labs/pta/AddStudentForm";
import { EnrollStudentForm } from "@/components/labs/pta/EnrollStudentForm";
import { EditHouseholdForm } from "@/components/labs/pta/EditHouseholdForm";
import { CreateDuesChargeForm } from "@/components/labs/pta/CreateDuesChargeForm";
import { RecordDuesPaymentForm } from "@/components/labs/pta/RecordDuesPaymentForm";
import { WaiveDuesChargeButton } from "@/components/labs/pta/WaiveDuesChargeButton";
import { ConfirmActionButton } from "@/components/labs/pta/ConfirmActionButton";
import { formatDateTime } from "@/lib/formatting";

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const CHARGE_STATUS_TONE: Record<string, string> = {
  PENDING: "warning",
  PARTIAL: "warning",
  PAID: "healthy",
  WAIVED: "info",
  VOID: "unknown",
};

export default async function PtaHouseholdDetailPage({ params }: { params: Promise<{ householdId: string }> }) {
  const { householdId } = await params;
  const { organizationId, access, can } = await getPtaPageGate("pta:directory:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Household" description="Not available for this organization." />
      </main>
    );
  }

  const [household, duesStatus, profile] = await Promise.all([
    getPtaHousehold(organizationId, householdId),
    can("pta:dues:manage") ? getPtaHouseholdDuesStatus(organizationId, householdId) : Promise.resolve(null),
    getPtaProfile(organizationId),
  ]);

  const schoolYear = profile?.currentSchoolYear ?? household.schoolYear;
  const classrooms = can("pta:students:manage") ? await listPtaClassrooms(organizationId, schoolYear) : [];
  const classroomOptions = classrooms.map((c) => ({ id: c.id, name: c.name, gradeName: c.grade.name }));

  const activeStudents = household.students.filter((s) => s.status === "ACTIVE");
  const enrollments = can("pta:students:manage")
    ? await Promise.all(activeStudents.map((s) => getPtaStudentEnrollment(organizationId, s.id, schoolYear)))
    : [];

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <Breadcrumbs items={[{ href: "/labs/pta/households", label: "Household Directory" }, { label: household.displayName }]} />
      <PageHeader
        title={household.displayName}
        description={`School year ${household.schoolYear}.`}
        actions={can("pta:households:manage") ? [{ href: "#dues", label: "Jump to dues" }] : []}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Status" value={<StatusPill status={household.status.toLowerCase()} label={household.status} />} />
        <StatCard label="Adults" value={household.adults.length} />
        <StatCard label="Active students" value={activeStudents.length} />
      </div>

      {can("pta:households:manage") ? (
        <SectionCard title="Household settings">
          <div className="flex flex-wrap items-center gap-2">
            <EditHouseholdForm
              householdId={household.id}
              initialDisplayName={household.displayName}
              initialStatus={household.status}
              initialNotes={household.notes}
            />
            {household.status !== "INACTIVE" ? (
              <ConfirmActionButton
                label="Deactivate household"
                confirmLabel="Confirm deactivate"
                method="DELETE"
                url={`/api/labs/pta/households/${household.id}`}
              />
            ) : null}
          </div>
          {household.notes ? <p className="mt-3 text-sm text-slate-700">Notes: {household.notes}</p> : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Adults" description="Parents/guardians linked to this household.">
        {household.adults.length === 0 ? (
          <EmptyState title="No adults on file" />
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {household.adults.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-semibold text-slate-900">{a.name}</span>
                  {a.relationshipLabel ? <span className="ml-2 text-slate-500">({a.relationshipLabel})</span> : null}
                  {a.email ? <span className="ml-2 text-slate-500">{a.email}</span> : null}
                  {a.userId ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Has portal access</span> : null}
                </div>
                {can("pta:households:manage") ? (
                  <ConfirmActionButton
                    label="Remove"
                    confirmLabel="Confirm remove"
                    method="DELETE"
                    url={`/api/labs/pta/households/${household.id}/adults/${a.id}`}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {can("pta:households:manage") ? <AddHouseholdAdultForm householdId={household.id} /> : null}
      </SectionCard>

      <SectionCard title="Students" description="Deliberately minimal — no academic, health, discipline, or custody records.">
        {household.students.length === 0 ? (
          <EmptyState title="No students on file" />
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {activeStudents.map((s, i) => {
              const enrollment = enrollments[i];
              return (
                <li key={s.id} className="space-y-2 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{s.displayName}</span>
                    {can("pta:students:manage") ? (
                      <ConfirmActionButton
                        label="Deactivate"
                        confirmLabel="Confirm deactivate"
                        method="DELETE"
                        url={`/api/labs/pta/households/${household.id}/students/${s.id}`}
                      />
                    ) : null}
                  </div>
                  {can("pta:students:manage") ? (
                    <EnrollStudentForm
                      studentId={s.id}
                      schoolYear={schoolYear}
                      classrooms={classroomOptions}
                      currentClassroomId={enrollment?.classroomId ?? null}
                    />
                  ) : enrollment ? (
                    <p className="text-xs text-slate-500">
                      {enrollment.classroom.grade.name} — {enrollment.classroom.name}
                    </p>
                  ) : null}
                </li>
              );
            })}
            {household.students
              .filter((s) => s.status !== "ACTIVE")
              .map((s) => (
                <li key={s.id} className="py-2 text-sm text-slate-500">
                  {s.displayName} <span className="italic">({s.status.toLowerCase()})</span>
                </li>
              ))}
          </ul>
        )}
        {can("pta:students:manage") ? <AddStudentForm householdId={household.id} /> : null}
      </SectionCard>

      {can("pta:dues:manage") ? (
        <SectionCard title="Dues" description="Charges, payments, and adjustments for this household.">
          <div id="dues" className="space-y-4">
            {duesStatus && duesStatus.charges.length === 0 ? (
              <EmptyState title="No dues charges yet" description="Create this year's charge below." />
            ) : (
              duesStatus?.charges.map((charge) => (
                <div key={charge.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <StatusPill status={CHARGE_STATUS_TONE[charge.status] ?? "unknown"} label={charge.status} />
                    <span className="text-sm text-slate-600">Due {formatDateTime(charge.dueDate)}</span>
                    <span className="text-sm text-slate-600">
                      {centsToDollars(Math.round(Number(charge.amountPaid) * 100))} / {centsToDollars(Math.round(Number(charge.amountDue) * 100))} paid
                    </span>
                  </div>
                  {charge.status === "PENDING" || charge.status === "PARTIAL" ? (
                    <div className="flex flex-wrap gap-2">
                      <RecordDuesPaymentForm householdId={household.id} chargeId={charge.id} />
                      <WaiveDuesChargeButton householdId={household.id} chargeId={charge.id} />
                    </div>
                  ) : null}
                </div>
              ))
            )}
            <CreateDuesChargeForm householdId={household.id} defaultSchoolYear={schoolYear} defaultAmountCents={profile?.defaultDuesAmountCents ?? null} />
          </div>
        </SectionCard>
      ) : null}
    </main>
  );
}

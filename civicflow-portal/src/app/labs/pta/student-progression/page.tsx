import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { getSchoolYearContext } from "@/lib/labs/pta/school-years";
import { listPtaClassrooms } from "@/lib/labs/pta/academic";
import { listProgressionBatches, getProgressionBatchDetail } from "@/lib/labs/pta/student-progression";
import { isPtaStudentProgressionPlatformEnabled } from "@/lib/env";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaStudentProgressionCenter } from "@/components/labs/pta/PtaStudentProgressionCenter";

/**
 * PTA/PTO Academic-Year Student Progression admin area (Section 4 of the
 * build-26 program). Server page resolves gate + initial data; all
 * workflow interaction (select years, configure mappings, preview,
 * confirm, results) lives in the client component below, mirroring the
 * Transition Center's shape.
 */
export default async function PtaStudentProgressionPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:student-progression:preview");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Student Progression" description="Not available for this organization." />
      </main>
    );
  }

  if (!isPtaStudentProgressionPlatformEnabled()) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="Student Progression" />
        <EmptyState title="Not yet available" description="This feature is not enabled on this platform yet." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);
  if (!profile) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="Student Progression" />
        <EmptyState title="Set up your PTA profile first" description="Configure your current school year at Settings." />
      </main>
    );
  }

  if (!profile.studentProgressionEnabled) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="Student Progression" description="Advance students to the next school year without losing history." />
        <EmptyState
          title="Not turned on yet"
          description={can("pta:school-years:manage") ? "Enable Student Progression in Settings to start using it." : "An administrator hasn't turned this on yet."}
        />
      </main>
    );
  }

  const [yearContext, batches] = await Promise.all([getSchoolYearContext(organizationId), listProgressionBatches(organizationId)]);

  // A COMMITTED batch used to drop straight into history, which meant the
  // workflow visibly ended at commit. With publication as a separate step,
  // a committed batch still has work outstanding (publish, or withdraw
  // again), so it stays active until it is rolled back or published — at
  // which point the rollover really is finished and the next one can start.
  const active =
    batches.find((b) => b.status !== "ROLLED_BACK" && (b as { publicationStatus?: string }).publicationStatus !== "PUBLISHED") ?? null;
  const history = batches.filter(
    (b) => b.status === "ROLLED_BACK" || (b as { publicationStatus?: string }).publicationStatus === "PUBLISHED"
  );

  let activeDetail = null;
  let sourceClassrooms: { id: string; name: string; gradeName: string }[] = [];
  let targetClassrooms: { id: string; name: string; gradeName: string }[] = [];
  if (active) {
    activeDetail = await getProgressionBatchDetail(organizationId, active.id);
    const [sourceRows, targetRows] = await Promise.all([
      listPtaClassrooms(organizationId, activeDetail.fromSchoolYear.label),
      listPtaClassrooms(organizationId, activeDetail.toSchoolYear.label),
    ]);
    sourceClassrooms = sourceRows.map((c) => ({ id: c.id, name: c.name, gradeName: c.grade.name }));
    targetClassrooms = targetRows.map((c) => ({ id: c.id, name: c.name, gradeName: c.grade.name }));
  }

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Student Progression"
        description="Advance students to the next school year — the same student record and family relationships carry forward; prior-year enrollment, volunteer hours, and payments are never overwritten."
      />
      <SectionCard
        title={active ? `${activeDetail!.fromSchoolYear.label} → ${activeDetail!.toSchoolYear.label}` : "Start a progression"}
        description={
          active
            ? "Configure classroom mappings, preview the plan, resolve anything needing review, then commit when ready."
            : "Pick the source and target school years to begin."
        }
      >
        <PtaStudentProgressionCenter
          canCommit={can("pta:student-progression:commit")}
          canPublish={can("pta:student-progression:publish")}
          years={yearContext.years.map((y) => ({ id: y.id, label: y.label }))}
          suggestedToLabel={yearContext.suggestedNextLabel}
          activeBatch={
            activeDetail
              ? {
                  id: activeDetail.id,
                  status: activeDetail.status,
                  notes: activeDetail.notes,
                  previewedAt: activeDetail.previewedAt ? activeDetail.previewedAt.toISOString() : null,
                  fromYearLabel: activeDetail.fromSchoolYear.label,
                  toYearLabel: activeDetail.toSchoolYear.label,
                  publicationStatus: activeDetail.publicationStatus,
                  publicationVersion: activeDetail.publicationVersion,
                  publishedAt: activeDetail.publishedAt ? activeDetail.publishedAt.toISOString() : null,
                  classroomMappings: activeDetail.classroomMappings.map((m) => ({
                    sourceClassroomId: m.sourceClassroomId,
                    targetClassroomId: m.targetClassroomId,
                  })),
                  records: activeDetail.records.map((r) => ({
                    id: r.id,
                    studentId: r.studentId,
                    studentName: r.student.displayName,
                    outcome: r.outcome,
                    status: r.status,
                    sourceClassroomId: r.sourceClassroomId,
                    targetGradeId: r.targetGradeId,
                    targetClassroomId: r.targetClassroomId,
                    exceptionReason: r.exceptionReason,
                  })),
                }
              : null
          }
          sourceClassrooms={sourceClassrooms}
          targetClassrooms={targetClassrooms}
          history={history.map((b) => ({ id: b.id, fromYearLabel: b.fromSchoolYear.label, toYearLabel: b.toSchoolYear.label, status: b.status }))}
        />
      </SectionCard>
    </main>
  );
}

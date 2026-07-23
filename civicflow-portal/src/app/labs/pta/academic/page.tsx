import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { listPtaGrades, listPtaTeachers, listPtaClassrooms } from "@/lib/labs/pta/academic";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { CreateGradeForm } from "@/components/labs/pta/CreateGradeForm";
import { CreateTeacherForm } from "@/components/labs/pta/CreateTeacherForm";
import { CreateClassroomForm } from "@/components/labs/pta/CreateClassroomForm";

export default async function PtaAcademicPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:directory:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Academic Structure" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);
  if (!profile) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="Academic Structure" />
        <EmptyState title="Set up your PTA profile first" description="Configure your current school year at Settings." />
      </main>
    );
  }

  const [grades, teachers, classrooms] = await Promise.all([
    listPtaGrades(organizationId),
    listPtaTeachers(organizationId),
    listPtaClassrooms(organizationId, profile.currentSchoolYear),
  ]);
  const canManage = can("pta:students:manage");

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader title="Academic Structure" description={`Grades, teachers, and classrooms for ${profile.currentSchoolYear}. No academic performance or discipline records are stored here.`} />

      <SectionCard title="Grades" description={`${grades.length} grade(s).`}>
        {grades.length === 0 ? (
          <EmptyState title="No grades yet" description={canManage ? "Add your school's grades below." : "An officer with student-management access hasn't set these up yet."} />
        ) : (
          <ul className="mb-4 flex flex-wrap gap-2">
            {grades.map((g) => (
              <li key={g.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
                {g.name}
              </li>
            ))}
          </ul>
        )}
        {canManage ? <CreateGradeForm /> : null}
      </SectionCard>

      <SectionCard title="Teachers" description={`${teachers.length} teacher(s) on file. Teacher records never carry portal access.`}>
        {teachers.length === 0 ? (
          <EmptyState title="No teachers yet" />
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {teachers.map((t) => (
              <li key={t.id} className="py-2 text-sm text-slate-900">
                {t.name} {t.email ? <span className="text-slate-500">({t.email})</span> : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? <CreateTeacherForm /> : null}
      </SectionCard>

      <SectionCard title="Classrooms" description={`${classrooms.length} classroom(s) for ${profile.currentSchoolYear}.`}>
        {classrooms.length === 0 ? (
          <EmptyState title="No classrooms yet" description={canManage ? "Add a grade first, then create classrooms below." : undefined} />
        ) : (
          <div className="mb-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-2">Grade</th>
                  <th className="px-4 py-2">Classroom</th>
                  <th className="px-4 py-2">Teacher</th>
                </tr>
              </thead>
              <tbody>
                {classrooms.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{c.grade.name}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{c.name}</td>
                    <td className="px-4 py-2 text-slate-600">{c.teacher?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canManage ? (
          <CreateClassroomForm
            schoolYear={profile.currentSchoolYear}
            grades={grades.map((g) => ({ id: g.id, name: g.name }))}
            teachers={teachers.map((t) => ({ id: t.id, name: t.name }))}
          />
        ) : null}
      </SectionCard>
    </main>
  );
}

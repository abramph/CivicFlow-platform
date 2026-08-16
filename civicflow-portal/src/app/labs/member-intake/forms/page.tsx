import Link from "next/link";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDate, formatEnumLabel } from "@/lib/formatting";
import { getMemberIntakePageGate } from "@/lib/member-intake/guard";
import { listIntakeForms } from "@/lib/member-intake/forms";
import { PERMISSIONS } from "@/lib/rbac";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PAUSED: "bg-amber-100 text-amber-800",
  ARCHIVED: "bg-slate-200 text-slate-500",
};

export default async function MemberIntakeFormsPage() {
  const { organizationId, access, can } = await getMemberIntakePageGate(PERMISSIONS.MEMBER_INTAKE_VIEW);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Member Forms & QR" description="Not available for this organization." />
      </main>
    );
  }

  const forms = await listIntakeForms(organizationId);
  const activeCount = forms.filter((f) => f.status === "ACTIVE").length;
  const totalSubmissions = forms.reduce((sum, f) => sum + f._count.submissions, 0);
  const canManage = can(PERMISSIONS.MEMBER_INTAKE_MANAGE);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Member Forms & QR"
        description="Create a public form and QR code so people can join or update their info without an admin — new members and updates land in your review queue before anything touches a member record."
        actions={[
          ...(canManage ? [{ href: "/labs/member-intake/forms/new", label: "New Form", tone: "primary" as const }] : []),
          { href: "/members", label: "Back to Members" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total Forms" value={forms.length} />
        <StatCard label="Active Forms" value={activeCount} />
        <StatCard label="Total Submissions" value={totalSubmissions} />
      </div>

      <SectionCard title="Forms" description="Each form has its own public link and QR code, and can be paused or archived independently.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Fields</th>
                <th className="px-4 py-3">Submissions</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {forms.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                    No forms yet.{" "}
                    {canManage ? (
                      <Link href="/labs/member-intake/forms/new" className="font-semibold text-emerald-700 hover:underline">
                        Create your first one.
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ) : (
                forms.map((form) => (
                  <tr key={form.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <Link href={`/labs/member-intake/forms/${form.id}`} className="font-semibold text-emerald-700 hover:underline">
                        {form.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(form.purpose)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[form.status]}`}>
                        {formatEnumLabel(form.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{form._count.fields}</td>
                    <td className="px-4 py-3 text-slate-900">{form._count.submissions}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(form.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}

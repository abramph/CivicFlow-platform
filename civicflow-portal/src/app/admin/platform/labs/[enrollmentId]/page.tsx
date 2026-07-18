import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, EmptyState } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";
import { prisma } from "@/lib/prisma";
import { getLabEnrollmentHistory } from "@/lib/platform-operations/labs";

export default async function LabEnrollmentHistoryPage({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  await requireSuperAdmin();
  const { enrollmentId } = await params;

  const enrollment = await prisma.organizationLabFeature.findUnique({
    where: { id: enrollmentId },
    include: { organization: { select: { name: true, slug: true } } },
  });
  if (!enrollment) notFound();

  const history = await getLabEnrollmentHistory(enrollmentId);

  return (
    <main className="space-y-6">
      <Breadcrumbs
        items={[
          { href: "/admin/platform", label: "Overview" },
          { href: "/admin/platform/labs", label: "Unestra Labs" },
          { label: "Enrollment history" },
        ]}
      />
      <PageHeader
        title={`${enrollment.featureKey} — ${enrollment.organization.name}`}
        description={`Organization: ${enrollment.organization.name} (${enrollment.organization.slug}). Current status: ${enrollment.status}.`}
      />

      <SectionCard title="Enrollment history" description="Reconstructed from the platform audit trail — every status change is audit-logged.">
        {history.length === 0 ? (
          <EmptyState title="No history recorded yet" description="Status changes will appear here once this enrollment is modified." />
        ) : (
          <ul className="space-y-3">
            {history.map((event) => (
              <li key={event.id} className="rounded-lg border border-slate-200 px-4 py-3 text-sm">
                <p className="font-medium text-slate-900">{event.action}</p>
                <p className="text-xs text-slate-600">
                  {formatDateTime(event.createdAt)} · {event.actorEmail ?? "system"}
                </p>
                {event.metadata ? (
                  <pre className="mt-2 overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}

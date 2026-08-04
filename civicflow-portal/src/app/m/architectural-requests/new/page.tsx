import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getMemberWebSession } from "@/lib/member-web-session";
import { listMyEligibleSubmissionProperties } from "@/lib/hoa/architectural-requests-guard";
import { prisma } from "@/lib/prisma";
import { ArchitecturalRequestForm } from "@/components/hoa/ArchitecturalRequestForm";

export default async function NewArchitecturalRequestPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="architectural-requests" title="Architectural Requests" />
      </div>
    );
  }

  const { propertyIds } = await listMyEligibleSubmissionProperties(memberSession.organizationId);
  const properties = propertyIds.length
    ? await prisma.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true, addressLine1: true, unitLabel: true, displayName: true },
      })
    : [];

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New architectural request</h1>
        <p className="mt-1 text-sm text-slate-600">Submit a proposal for board or committee approval.</p>
      </div>

      <ArchitecturalRequestForm
        organizationId={memberSession.organizationId}
        properties={properties.map((p) => ({
          id: p.id,
          label: p.displayName || (p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1),
        }))}
      />

      <p className="text-sm">
        <Link href="/m/architectural-requests" className="font-semibold text-emerald-700 hover:underline">← Back</Link>
      </p>
    </main>
  );
}

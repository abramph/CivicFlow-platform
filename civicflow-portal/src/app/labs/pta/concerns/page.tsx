import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listConcerns } from "@/lib/labs/pta/concerns";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaConcernsManager } from "@/components/labs/pta/PtaConcernsManager";

/**
 * PTA Vertical 2.0, PR PTA-E — Concerns & Grievances. The page itself is
 * reachable only with pta:concerns:view (ORG_ADMIN+ by default); per-case
 * access — including the restricted-case assignment wall — is enforced in
 * lib/labs/pta/concerns.ts, never here.
 */
export default async function PtaConcernsPage() {
  const { organizationId, session, access, can } = await getPtaPageGate("pta:concerns:view");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Concerns & Grievances" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await prisma.ptaProfile.findUnique({
    where: { organizationId },
    select: { concernsEnabled: true, concernsLabel: true },
  });
  const label = profile?.concernsLabel?.trim() || "Concerns & Grievances";

  if (profile && profile.concernsEnabled === false) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader
          title={label}
          description="This module is currently turned off for your PTA. An administrator can re-enable it under PTA Setup."
        />
      </main>
    );
  }

  const viewer = {
    userId: session.userId,
    userEmail: session.userEmail,
    canView: true,
    canManage: can("pta:concerns:manage"),
    canAssign: can("pta:concerns:assign"),
    canResolve: can("pta:concerns:resolve"),
  };

  const [{ readable, redacted }, officerMemberships, committees, currentGovernance] = await Promise.all([
    listConcerns(organizationId, viewer),
    prisma.organizationMembership.findMany({
      where: { organizationId, status: "active", role: { not: "MEMBER" } },
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.ptaCommittee.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.governanceDocument.findMany({
      where: { organizationId, status: "CURRENT" },
      select: { id: true, title: true, version: true },
      orderBy: { title: "asc" },
    }),
  ]);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title={label}
        description="A confidential case register for formal concerns brought to the board. Restricted cases are readable only by their explicitly assigned officers — no role or permission bypasses that."
      />
      <SectionCard title="Case register" description={`${readable.length} case(s) you can read${redacted.length ? `, ${redacted.length} restricted case(s) you can reassign but not read` : ""}.`}>
        <PtaConcernsManager
          featureLabel={label}
          cases={readable.map((row) => ({
            id: row.id,
            caseNumber: row.caseNumber,
            title: row.title,
            category: row.category,
            status: row.status,
            isRestricted: row.isRestricted,
            submittedAt: row.submittedAt.toISOString(),
            responseDeadline: row.responseDeadline?.toISOString() ?? null,
          }))}
          redactedCases={redacted.map((row) => ({
            id: row.id,
            caseNumber: row.caseNumber,
            category: row.category,
            status: row.status,
            submittedAt: row.submittedAt.toISOString(),
          }))}
          officers={officerMemberships.map((membership) => ({
            userId: membership.user.id,
            name: membership.user.displayName || membership.user.email,
            role: membership.role,
          }))}
          committees={committees}
          governanceDocuments={currentGovernance.map((doc) => ({ id: doc.id, label: `${doc.title} (v${doc.version})` }))}
          viewer={{ canManage: viewer.canManage, canAssign: viewer.canAssign, canResolve: viewer.canResolve }}
        />
      </SectionCard>
    </main>
  );
}

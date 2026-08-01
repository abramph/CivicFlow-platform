import Link from "next/link";
import { getHoaPageGate } from "@/lib/hoa/guard";
import { getProperty } from "@/lib/hoa/properties";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, EmptyState, StatusPill } from "@/components/admin/OperationsUI";
import { AssignResidentForm } from "@/components/hoa/AssignResidentForm";
import { EndResidentRelationshipButton } from "@/components/hoa/EndResidentRelationshipButton";
import { PropertyArchiveButton } from "@/components/hoa/PropertyArchiveButton";

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  SINGLE_FAMILY: "Single-family lot",
  CONDO_UNIT: "Condo unit",
  TOWNHOME: "Townhome",
  VACANT_LOT: "Vacant lot",
  COMMON_PROPERTY: "Common property",
  OTHER: "Other",
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  OWNER: "Owner",
  CO_OWNER: "Co-owner",
  RESIDENT: "Resident",
  TENANT: "Tenant",
  NON_RESIDENT_OWNER: "Non-resident owner",
  OTHER: "Other",
};

function propertyLabel(p: { addressLine1: string; unitLabel: string | null; displayName: string | null }) {
  if (p.displayName) return p.displayName;
  return p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1;
}

function memberName(m: { firstName: string; lastName: string }) {
  return `${m.firstName} ${m.lastName}`;
}

function formatDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default async function HoaPropertyDetailPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { organizationId, access, can } = await getHoaPageGate(PERMISSIONS.HOA_PROPERTIES_READ);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Property" description="Not available for this organization." />
      </main>
    );
  }

  const { propertyId } = await params;
  const property = await getProperty(organizationId, propertyId);

  const activeResidents = property.residents.filter((r) => r.status === "ACTIVE");
  const endedResidents = property.residents.filter((r) => r.status === "ENDED");

  const canManageProperty = can(PERMISSIONS.HOA_PROPERTIES_WRITE);
  const canReadResidents = can(PERMISSIONS.HOA_RESIDENTS_READ);
  const canManageResidents = can(PERMISSIONS.HOA_RESIDENTS_WRITE);

  const members = canManageResidents
    ? await prisma.orgMember.findMany({
        where: { organizationId },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 200,
        select: { id: true, firstName: true, lastName: true },
      })
    : [];

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/hoa/properties", label: "Properties" }, { label: propertyLabel(property) }]} />
      <PageHeader
        title={propertyLabel(property)}
        description={[property.addressLine1, property.city, property.state, property.zipCode].filter(Boolean).join(", ")}
        actions={canManageProperty ? [{ href: `/hoa/properties/${property.id}/edit`, label: "Edit property" }] : []}
      />

      {property.status === "INACTIVE" ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          This property is archived.
        </div>
      ) : null}

      <SectionCard title="Property details">
        <dl className="grid gap-4 md:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</dt>
            <dd className="text-sm text-slate-900">{PROPERTY_TYPE_LABELS[property.propertyType] ?? property.propertyType}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
            <dd><StatusPill status={property.status === "ACTIVE" ? "healthy" : "unknown"} label={property.status === "ACTIVE" ? "Active" : "Archived"} /></dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing / assessment contact</dt>
            <dd className="text-sm text-slate-900">{property.billingMember ? memberName(property.billingMember) : "No owner on file"}</dd>
          </div>
          {property.buildingLabel ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Building</dt>
              <dd className="text-sm text-slate-900">{property.buildingLabel}</dd>
            </div>
          ) : null}
        </dl>
        {canManageProperty ? (
          <div className="mt-4">
            <PropertyArchiveButton propertyId={property.id} isArchived={property.status === "INACTIVE"} />
          </div>
        ) : null}
      </SectionCard>

      {canReadResidents ? (
        <SectionCard title="Current owners and residents" description={`${activeResidents.length} active relationship(s).`}>
          {activeResidents.length === 0 ? (
            <EmptyState title="No residents or owners are linked to this property." description={canManageResidents ? "Link an existing member below." : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="mb-4 min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Relationship</th>
                    <th className="px-4 py-3">Primary contact</th>
                    <th className="px-4 py-3">Move-in date</th>
                    {canManageResidents ? <th className="px-4 py-3">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {activeResidents.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-semibold text-slate-900">{memberName(r.orgMember)}</td>
                      <td className="px-4 py-3 text-slate-700">{RELATIONSHIP_LABELS[r.relationshipType] ?? r.relationshipType}</td>
                      <td className="px-4 py-3 text-slate-700">{r.isPrimaryContact ? "Yes" : ""}</td>
                      <td className="px-4 py-3 text-slate-700">{formatDate(r.moveInDate)}</td>
                      {canManageResidents ? (
                        <td className="px-4 py-3">
                          <EndResidentRelationshipButton propertyId={property.id} residentId={r.id} memberName={memberName(r.orgMember)} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canManageResidents ? <AssignResidentForm propertyId={property.id} members={members} /> : null}
        </SectionCard>
      ) : null}

      {canReadResidents && endedResidents.length > 0 ? (
        <SectionCard title="Relationship history" description="Prior owners, tenants, and residents — preserved, never deleted.">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Relationship</th>
                  <th className="px-4 py-3">Move-in</th>
                  <th className="px-4 py-3">Move-out</th>
                </tr>
              </thead>
              <tbody>
                {endedResidents.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 text-slate-500">
                    <td className="px-4 py-3">{memberName(r.orgMember)}</td>
                    <td className="px-4 py-3">{RELATIONSHIP_LABELS[r.relationshipType] ?? r.relationshipType}</td>
                    <td className="px-4 py-3">{formatDate(r.moveInDate)}</td>
                    <td className="px-4 py-3">{formatDate(r.moveOutDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      <Link href="/hoa/properties" className="inline-block text-sm font-semibold text-emerald-700 hover:underline">
        ← Back to properties
      </Link>
    </main>
  );
}

import Link from "next/link";
import { getHoaPageGate } from "@/lib/hoa/guard";
import { listProperties } from "@/lib/hoa/properties";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";

const PROPERTY_TYPES = ["SINGLE_FAMILY", "CONDO_UNIT", "TOWNHOME", "VACANT_LOT", "COMMON_PROPERTY", "OTHER"] as const;
type PropertyTypeValue = (typeof PROPERTY_TYPES)[number];

const PROPERTY_TYPE_LABELS: Record<PropertyTypeValue, string> = {
  SINGLE_FAMILY: "Single-family",
  CONDO_UNIT: "Condo unit",
  TOWNHOME: "Townhome",
  VACANT_LOT: "Vacant lot",
  COMMON_PROPERTY: "Common property",
  OTHER: "Other",
};

function isPropertyType(value: string): value is PropertyTypeValue {
  return (PROPERTY_TYPES as readonly string[]).includes(value);
}

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function propertyLabel(p: { addressLine1: string; unitLabel: string | null; displayName: string | null }) {
  if (p.displayName) return p.displayName;
  return p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1;
}

export default async function HoaPropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, access, can } = await getHoaPageGate(PERMISSIONS.HOA_PROPERTIES_READ);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Properties" description="Not available for this organization." />
      </main>
    );
  }

  const params = await searchParams;
  const search = getValue(params.search);
  const status = getValue(params.status);
  const propertyType = getValue(params.propertyType);
  const noActiveResident = getValue(params.noActiveResident) === "true";

  const { properties, total } = await listProperties(organizationId, {
    noActiveResident: noActiveResident || undefined,
    search: search || undefined,
    status: status === "ACTIVE" || status === "INACTIVE" ? status : undefined,
    propertyType: isPropertyType(propertyType) ? propertyType : undefined,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Properties"
        description="Every lot, unit, townhome, and common property this association governs."
        actions={can(PERMISSIONS.HOA_PROPERTIES_WRITE) ? [{ href: "/hoa/properties/new", label: "Add property", tone: "primary" }] : []}
      />

      <SectionCard
        title="Property directory"
        description={`${total} propert${total === 1 ? "y" : "ies"} matching your filters${noActiveResident ? " — showing only properties with no active owner or contact" : ""}.`}
      >
        <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Search</span>
            <input
              type="text"
              name="search"
              defaultValue={search}
              placeholder="Address, unit, or name"
              className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Type</span>
            <select name="propertyType" defaultValue={propertyType} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">All types</option>
              {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Status</span>
            <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Archived</option>
            </select>
          </label>
          {noActiveResident ? <input type="hidden" name="noActiveResident" value="true" /> : null}
          <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
            Filter
          </button>
          {search || status || propertyType || noActiveResident ? (
            <Link href="/hoa/properties" className="text-sm font-semibold text-emerald-700 hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        {properties.length === 0 ? (
          <EmptyState
            title={search || status || propertyType ? "No properties match your filters" : "No properties have been added yet."}
            description={
              search || status || propertyType
                ? "Try a different search term or clear the filters."
                : can(PERMISSIONS.HOA_PROPERTIES_WRITE)
                  ? "Add your first property to get started."
                  : "Properties are added by a board member or property manager."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Property</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Primary owner/contact</th>
                  <th className="px-4 py-3">Active residents</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-emerald-700">
                      <Link href={`/hoa/properties/${p.id}`} className="hover:underline">
                        {propertyLabel(p)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{PROPERTY_TYPE_LABELS[p.propertyType] ?? p.propertyType}</td>
                    <td className="px-4 py-3"><StatusPill status={p.status === "ACTIVE" ? "healthy" : "unknown"} label={p.status === "ACTIVE" ? "Active" : "Archived"} /></td>
                    <td className="px-4 py-3 text-slate-700">
                      {p.billingMember ? `${p.billingMember.firstName} ${p.billingMember.lastName}` : <span className="text-slate-400">No owner on file</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{p._count.residents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </main>
  );
}

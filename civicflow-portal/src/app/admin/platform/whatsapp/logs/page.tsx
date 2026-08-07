import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";
import { prisma } from "@/lib/prisma";
import { maskPhone } from "@/lib/sms-otp";

const STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED", "UNDELIVERED"] as const;
const DISPLAY_LIMIT = 200;

export default async function WhatsAppLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string; status?: string; dateFrom?: string; dateTo?: string }>;
}) {
  await requireSuperAdmin();
  const filters = await searchParams;

  const where = {
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(filters.status ? { status: filters.status as (typeof STATUSES)[number] } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          createdAt: {
            ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
            ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [organizations, messages, totalCount] = await Promise.all([
    prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    prisma.whatsAppMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: DISPLAY_LIMIT,
      include: { organization: { select: { name: true } }, member: { select: { firstName: true, lastName: true } } },
    }),
    prisma.whatsAppMessage.count({ where }),
  ]);

  const exportParams = new URLSearchParams();
  if (filters.organizationId) exportParams.set("organizationId", filters.organizationId);
  if (filters.status) exportParams.set("status", filters.status);
  if (filters.dateFrom) exportParams.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) exportParams.set("dateTo", filters.dateTo);
  const csvHref = `/api/admin/whatsapp/logs/export?${new URLSearchParams({ ...Object.fromEntries(exportParams), format: "csv" }).toString()}`;
  const xlsxHref = `/api/admin/whatsapp/logs/export?${new URLSearchParams({ ...Object.fromEntries(exportParams), format: "xlsx" }).toString()}`;

  return (
    <main className="space-y-6">
      <PageHeader
        title="WhatsApp Logs"
        description={`Showing ${messages.length} of ${totalCount} matching messages. Adjust filters and export the full result set below.`}
        actions={[
          { href: csvHref, label: "Export CSV" },
          { href: xlsxHref, label: "Export XLSX" },
          { href: "/admin/platform/whatsapp", label: "Back to WhatsApp Administration" },
        ]}
      />

      <SectionCard title="Filters">
        <form className="grid gap-3 md:grid-cols-4" method="get">
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Organization</span>
            <select name="organizationId" defaultValue={filters.organizationId ?? ""} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">All organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Status</span>
            <select name="status" defaultValue={filters.status ?? ""} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>From</span>
            <input type="date" name="dateFrom" defaultValue={filters.dateFrom ?? ""} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>To</span>
            <input type="date" name="dateTo" defaultValue={filters.dateTo ?? ""} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="md:col-span-4">
            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              Apply Filters
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Messages">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Provider SID</th>
                <th className="px-4 py-3">Delivery Time</th>
                <th className="px-4 py-3">Cost</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-600">
                    No messages match these filters.
                  </td>
                </tr>
              ) : (
                messages.map((message) => (
                  <tr key={message.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatDateTime(message.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-900">{message.organization.name}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {message.member ? `${message.member.firstName} ${message.member.lastName}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-900">{maskPhone(message.phone)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {message.campaignId ? "Campaign" : message.templateKey ? "Template" : "Direct"}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{message.status}</td>
                    <td className="px-4 py-3 text-slate-900">{message.providerMessageId ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-900">{formatDateTime(message.sentAt)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {message.actualCostCents != null ? `$${(message.actualCostCents / 100).toFixed(4)}` : "—"}
                    </td>
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

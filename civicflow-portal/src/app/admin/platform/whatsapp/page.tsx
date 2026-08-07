import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { computeWhatsAppCostSummary } from "@/lib/whatsapp/admin-pricing";
import { getMaskedWhatsAppSettingsView } from "@/lib/whatsapp/credentials";
import { WhatsAppGlobalControls } from "@/components/admin/WhatsAppGlobalControls";
import { WhatsAppSenderPanel } from "@/components/admin/WhatsAppSenderPanel";

export default async function WhatsAppAdministrationPage() {
  await requireSuperAdmin();

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [settings, whatsappEnabledOrgsCount, messagesTodayCount, messagesThisMonthCount, failedThisMonthCount, deliveredThisMonthCount, costRows, activeOrgSettings] =
    await Promise.all([
      getMaskedWhatsAppSettingsView(),
      prisma.organizationWhatsAppSettings.count({ where: { whatsappAddOnActive: true } }),
      prisma.whatsAppMessage.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.whatsAppMessage.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.whatsAppMessage.count({ where: { status: { in: ["FAILED", "UNDELIVERED"] }, createdAt: { gte: monthStart } } }),
      prisma.whatsAppMessage.count({ where: { status: { in: ["DELIVERED", "READ"] }, createdAt: { gte: monthStart } } }),
      prisma.whatsAppMessage.findMany({
        where: { createdAt: { gte: monthStart }, OR: [{ actualCostCents: { not: null } }, { costEstimateCents: { not: null } }] },
        select: { actualCostCents: true, costEstimateCents: true },
      }),
      prisma.organizationWhatsAppSettings.findMany({
        where: { whatsappAddOnActive: true },
        select: { whatsappMonthlyLimit: true, whatsappUsedThisPeriod: true, whatsappOverageRateCents: true },
      }),
    ]);

  const twilioCostCents = costRows.reduce((sum, row) => sum + (row.actualCostCents ?? row.costEstimateCents ?? 0), 0);
  const costSummary = computeWhatsAppCostSummary({ organizations: activeOrgSettings, twilioCostCents });

  const resolvedThisMonth = deliveredThisMonthCount + failedThisMonthCount;
  const deliverySuccessRate = resolvedThisMonth > 0 ? (deliveredThisMonthCount / resolvedThisMonth) * 100 : null;

  const statusLabel = settings.maintenanceMode
    ? "Maintenance Mode"
    : !settings.platformEnabled
      ? "Disabled"
      : settings.sandboxMode
        ? "Sandbox"
        : "Enabled";

  return (
    <main className="space-y-6">
      <PageHeader
        title="WhatsApp Administration"
        description="Platform-wide sender configuration, global controls, and delivery/cost visibility for the WhatsApp system."
        actions={[
          { href: "/admin/platform/whatsapp/organizations", label: "Organizations" },
          { href: "/admin/platform/whatsapp/queue", label: "Queue" },
          { href: "/admin/platform/whatsapp/logs", label: "Logs" },
          { href: "/admin/platform/whatsapp/usage", label: "Usage" },
          { href: "/admin/platform", label: "Back to Platform Admin" },
        ]}
      />

      {settings.sandboxMode ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Sandbox Mode is on.</strong> Only the test phone numbers below can receive WhatsApp messages until a
          real WhatsApp Business Account is connected and Sandbox Mode is turned off.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Status" value={statusLabel} />
        <StatCard label="Orgs Using WhatsApp" value={whatsappEnabledOrgsCount} />
        <StatCard label="Messages Today" value={messagesTodayCount} />
        <StatCard label="Messages This Month" value={messagesThisMonthCount} />
        <StatCard label="Failed Messages" value={failedThisMonthCount} />
        <StatCard
          label="Delivery Success Rate"
          value={deliverySuccessRate === null ? "—" : `${deliverySuccessRate.toFixed(1)}%`}
          helper="(Delivered + Read) ÷ (Delivered + Read + Failed + Undelivered) this month"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard label="Estimated Monthly Cost (Twilio)" value={`$${(costSummary.twilioCostCents / 100).toFixed(2)}`} />
        <StatCard
          label="Estimated Monthly Customer Charges"
          value={`$${(costSummary.customerChargesCents / 100).toFixed(2)}`}
          helper={`Est. profit: $${(costSummary.profitCents / 100).toFixed(2)}`}
        />
      </div>

      <SectionCard title="Global Controls" description="Platform-wide kill switches. Disabling any of these stops matching sends immediately.">
        <WhatsAppGlobalControls
          platformEnabled={settings.platformEnabled}
          sandboxMode={settings.sandboxMode}
          maintenanceMode={settings.maintenanceMode}
          outboundPaused={settings.outboundPaused}
          orgMessagingEnabled={settings.orgMessagingEnabled}
          testPhoneNumbers={settings.testPhoneNumbers}
        />
      </SectionCard>

      <SectionCard title="Sender Identity" description="WhatsApp reuses SMS's Twilio account credentials — only the sender identity below is WhatsApp-specific.">
        <WhatsAppSenderPanel
          sender={{
            fromNumber: settings.fromNumber,
            messagingServiceSid: settings.messagingServiceSid,
            accountSidMasked: settings.accountSidMasked,
            senderSource: settings.senderSource,
          }}
        />
      </SectionCard>
    </main>
  );
}

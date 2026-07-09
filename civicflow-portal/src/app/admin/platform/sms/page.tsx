import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { computeSmsCostSummary } from "@/lib/sms-admin-pricing";
import { getMaskedSmsCredentialsView, getPlatformSmsSettings } from "@/lib/sms-credentials";
import { formatDateTime } from "@/lib/formatting";
import { SmsGlobalControls } from "@/components/admin/SmsGlobalControls";
import { SmsCredentialsPanel } from "@/components/admin/SmsCredentialsPanel";
import { SmsTollFreeVerificationCard } from "@/components/admin/SmsTollFreeVerificationCard";

export default async function SmsAdministrationPage() {
  await requireSuperAdmin();

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [settings, credentials, smsEnabledOrgsCount, messagesTodayCount, messagesThisMonthCount, failedThisMonthCount, deliveredThisMonthCount, costRows, activeOrgSettings] =
    await Promise.all([
      getPlatformSmsSettings(),
      getMaskedSmsCredentialsView(),
      prisma.organizationSmsSettings.count({ where: { smsAddOnActive: true } }),
      prisma.smsMessage.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.smsMessage.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.smsMessage.count({ where: { status: "FAILED", createdAt: { gte: monthStart } } }),
      prisma.smsMessage.count({ where: { status: "DELIVERED", createdAt: { gte: monthStart } } }),
      prisma.smsMessage.findMany({
        where: { createdAt: { gte: monthStart }, OR: [{ actualCostCents: { not: null } }, { costEstimateCents: { not: null } }] },
        select: { actualCostCents: true, costEstimateCents: true },
      }),
      prisma.organizationSmsSettings.findMany({
        where: { smsAddOnActive: true },
        select: { smsMonthlyLimit: true, smsUsedThisPeriod: true, smsOverageRateCents: true, planPriceCents: true },
      }),
    ]);

  const twilioCostCents = costRows.reduce((sum, row) => sum + (row.actualCostCents ?? row.costEstimateCents ?? 0), 0);
  const costSummary = computeSmsCostSummary({
    organizations: activeOrgSettings,
    twilioCostCents,
    carrierFeePercent: settings.carrierFeePercent,
  });

  const resolvedThisMonth = deliveredThisMonthCount + failedThisMonthCount;
  const deliverySuccessRate = resolvedThisMonth > 0 ? (deliveredThisMonthCount / resolvedThisMonth) * 100 : null;

  const statusLabel = settings.maintenanceMode
    ? "Maintenance Mode"
    : !settings.platformEnabled
      ? "Disabled"
      : settings.tollFreeVerificationStatus !== "VERIFIED"
        ? "Verification Pending"
        : "Enabled";

  return (
    <main className="space-y-6">
      <PageHeader
        title="SMS Administration"
        description="Platform-wide Twilio configuration, global controls, and delivery/cost visibility for the SMS system."
        actions={[
          { href: "/admin/platform/sms/organizations", label: "Organizations" },
          { href: "/admin/platform/sms/queue", label: "Queue" },
          { href: "/admin/platform/sms/logs", label: "Logs" },
          { href: "/admin/platform/sms/usage", label: "Usage" },
          { href: "/admin/platform", label: "Back to Platform Admin" },
        ]}
      />

      {settings.tollFreeVerificationStatus !== "VERIFIED" ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Your Toll-Free number has not yet been verified.</strong> SMS delivery may be delayed or filtered
          by carriers until verification completes. Safe Launch Mode restricts sends to verified test numbers while
          this is pending.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Status" value={statusLabel} />
        <StatCard label="Orgs Using SMS" value={smsEnabledOrgsCount} />
        <StatCard label="Messages Today" value={messagesTodayCount} />
        <StatCard label="Messages This Month" value={messagesThisMonthCount} />
        <StatCard label="Failed Messages" value={failedThisMonthCount} />
        <StatCard
          label="Delivery Success Rate"
          value={deliverySuccessRate === null ? "—" : `${deliverySuccessRate.toFixed(1)}%`}
          helper="Delivered ÷ (Delivered + Failed) this month"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          label="Estimated Monthly Cost (Twilio)"
          value={`$${(costSummary.twilioCostCents / 100).toFixed(2)}`}
        />
        <StatCard
          label="Estimated Monthly Customer Charges"
          value={`$${(costSummary.customerChargesCents / 100).toFixed(2)}`}
          helper={`Est. profit: $${(costSummary.profitCents / 100).toFixed(2)}`}
        />
      </div>

      <SectionCard title="Global Controls" description="Platform-wide kill switches. Disabling any of these stops matching sends immediately, except internal system testing.">
        <SmsGlobalControls
          platformEnabled={settings.platformEnabled}
          testMode={settings.testMode}
          maintenanceMode={settings.maintenanceMode}
          outboundPaused={settings.outboundPaused}
          mfaSmsEnabled={settings.mfaSmsEnabled}
          orgMessagingEnabled={settings.orgMessagingEnabled}
          testPhoneNumbers={settings.testPhoneNumbers}
          carrierFeePercent={settings.carrierFeePercent}
        />
      </SectionCard>

      <SectionCard title="Twilio Configuration" description="Credentials are encrypted at rest and never shown in full after saving. Leave a field blank to keep its current value.">
        <SmsCredentialsPanel credentials={credentials} />
      </SectionCard>

      <SectionCard title="Toll-Free Verification" description="CivicFlow displays and refreshes status here — submitting a new verification happens in the Twilio Console.">
        <SmsTollFreeVerificationCard
          status={settings.tollFreeVerificationStatus}
          submittedAt={settings.tollFreeVerificationSubmittedAt?.toISOString() ?? null}
          approvedAt={settings.tollFreeVerificationApprovedAt?.toISOString() ?? null}
          lastCheckedAt={settings.tollFreeVerificationLastCheckedAt?.toISOString() ?? null}
          lastCheckedLabel={formatDateTime(settings.tollFreeVerificationLastCheckedAt)}
        />
      </SectionCard>
    </main>
  );
}

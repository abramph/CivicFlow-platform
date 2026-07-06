import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { DuesAdjustmentForm } from "@/components/forms/DuesAdjustmentForm";
import { DuesGenerateForm } from "@/components/forms/DuesGenerateForm";
import { EvaluateMemberCategoryButton } from "@/components/forms/MembershipRuleActions";
import { InviteMemberToAppButton } from "@/components/forms/InviteMemberToAppButton";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { paymentMethodLabels as defaultPaymentMethodLabels } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import {
  formatCurrency,
  formatDate,
  formatEnumLabel,
  formatPersonName,
  formatText,
} from "@/lib/formatting";

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId, can } = await requirePermission("members:read");
  const { id } = await params;

  const [
    member,
    duesTotals,
    duesOpenCount,
    duesPaymentTotals,
    contributionTotals,
    recentCharges,
    recentPayments,
    duesAdjustmentTotals,
    recentAdjustments,
    recentContributions,
    paymentMethods,
    recentCommunications,
    recentCampaignRecipients,
    recentPaymentImports,
    followUpCommunications,
    recentAttendance,
    recentTimelineEvents,
  ] = await Promise.all([
    prisma.orgMember.findFirst({
      where: { id, organizationId },
      include: {
        membershipCategory: true,
      },
    }),
    prisma.duesCharge.aggregate({
      where: { organizationId, memberId: id },
      _sum: { amountDue: true, amountPaid: true },
      _count: { id: true },
    }),
    prisma.duesCharge.count({
      where: {
        organizationId,
        memberId: id,
        status: { in: ["PENDING", "PARTIAL"] },
      },
    }),
    prisma.duesPayment.aggregate({
      where: { organizationId, memberId: id },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.contribution.aggregate({
      where: { organizationId, memberId: id },
      _sum: { amount: true },
      _count: { id: true },
      _max: { contributionDate: true },
    }),
    prisma.duesCharge.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
      include: {
        duesAccount: true,
      },
      take: 6,
    }),
    prisma.duesPayment.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      include: {
        duesAccount: true,
        duesCharge: {
          select: {
            dueDate: true,
            status: true,
          },
        },
      },
      take: 6,
    }),
    prisma.duesAdjustment.aggregate({
      where: { organizationId, memberId: id },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.duesAdjustment.findMany({
      where: { organizationId, memberId: id },
      orderBy: { createdAt: "desc" },
      include: { duesCharge: true },
      take: 6,
    }),
    prisma.contribution.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      include: {
        campaign: true,
        event: true,
      },
      take: 8,
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId },
      select: { method: true, label: true },
    }),
    prisma.communicationLog.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ communicationDate: "desc" }, { createdAt: "desc" }],
      take: 5,
    }),
    prisma.communicationRecipient.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ createdAt: "desc" }],
      include: { campaign: true },
      take: 5,
    }),
    prisma.paymentImportItem.findMany({
      where: { organizationId, matchedMemberId: id },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: 5,
    }),
    prisma.communicationLog.findMany({
      where: { organizationId, memberId: id, followUpRequired: true },
      orderBy: [{ followUpDate: "asc" }, { communicationDate: "desc" }],
      take: 5,
    }),
    prisma.attendanceRecord.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      include: { event: true },
      take: 5,
    }),
    prisma.memberTimelineEvent.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 6,
    }),
  ]);

  if (!member) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Member not found"
          description="The requested member does not exist in your organization or is no longer available."
          actions={[
            { href: "/members", label: "Back to Members" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  const totalDuesAssessed = Number(duesTotals._sum.amountDue ?? 0);
  const totalDuesApplied = Number(duesTotals._sum.amountPaid ?? 0);
  const totalDuesAdjusted = Number(duesAdjustmentTotals._sum.amount ?? 0);
  const totalOutstanding = Math.max(0, totalDuesAssessed - totalDuesApplied - totalDuesAdjusted);
  const totalContributions = Number(contributionTotals._sum.amount ?? 0);
  const addressLines = [member.addressLine1, member.addressLine2].filter(Boolean);
  const locality = [member.city, member.state, member.zipCode].filter(Boolean).join(", ");
  const methodLabels = Object.fromEntries(defaultPaymentMethodLabels);
  for (const method of paymentMethods) {
    methodLabels[method.method] = method.label;
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={formatPersonName(member)}
        description="Member profile with current status, dues standing, and recent contribution activity."
        actions={[
          { href: `/members/${member.id}/edit`, label: "Edit Member", tone: "primary" },
          ...(can("messages:write") && member.userId
            ? [{ href: `/inbox?composeMemberId=${member.id}&composeMemberName=${encodeURIComponent(formatPersonName(member))}`, label: "Message" }]
            : []),
          { href: `/contributions/new?memberId=${member.id}`, label: "Record Contribution" },
          { href: `/dues/payments/new?memberId=${member.id}`, label: "Record Dues Payment" },
          { href: `/communications/new?memberId=${member.id}`, label: "Log Communication" },
          { href: `/attendance/new?memberId=${member.id}`, label: "Record Attendance" },
          { href: `/members/${member.id}/timeline`, label: "Timeline" },
          { href: `/dues/charges?memberId=${member.id}`, label: "Create Dues Charge" },
          { href: "/members", label: "Back to Members" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <SectionCard title="Member Details" description="Core membership and contact information for this person.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Status" value={formatEnumLabel(member.membershipStatus)} />
          <StatCard
            label="Dues Standing"
            value={member.isDelinquent ? "Delinquent" : "Current / Not marked delinquent"}
            helper={member.delinquentSince ? `Since ${formatDate(member.delinquentSince)}` : `Last evaluated ${formatDate(member.lastDuesEvaluationAt)}`}
          />
          <StatCard
            label="Membership Category"
            value={formatText(member.membershipCategory?.name, "No category assigned")}
            helper={member.membershipCategoryManualOverride ? "Manual override locked" : "Rule evaluation available"}
          />
          <StatCard label="Email" value={formatText(member.email, "No email on file")} />
          <StatCard label="Phone" value={formatText(member.phone, "No phone on file")} />
          <StatCard label="Joined" value={formatDate(member.joinDate)} />
          <StatCard label="Date of Birth" value={formatDate(member.dateOfBirth)} />
          <StatCard label="Gender" value={formatText(member.gender, "Not recorded")} />
          <StatCard label="Preferred Name" value={formatText(member.preferredName, "Matches first name")} />
          <StatCard label="Household" value={formatText(member.householdName, "No household assigned")} />
          <StatCard label="Member Record" value={member.id} helper="Internal CivicFlow member identifier." />
        </div>
        <div className="mt-4">
          <EvaluateMemberCategoryButton memberId={member.id} canWrite={can("members:write")} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Mailing Address</p>
            <div className="mt-2 space-y-1 text-sm leading-6 text-slate-800">
              {addressLines.length > 0 ? addressLines.map((line) => <p key={line}>{line}</p>) : <p>No street address on file.</p>}
              <p>{formatText(locality, "No city, state, or ZIP recorded")}</p>
              <p>{formatText(member.county, "No county recorded")}</p>
              <p>{formatText(member.country, "No country recorded")}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Emergency Contact</p>
            <div className="mt-2 space-y-1 text-sm leading-6 text-slate-800">
              <p>{formatText(member.emergencyContactName, "No emergency contact name on file")}</p>
              <p>{formatText(member.emergencyContactPhone, "No emergency contact phone on file")}</p>
            </div>
          </div>
        </div>
        {member.notes ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{member.notes}</p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Member Documents" description="Private member files, forms, and supporting documents stored in organization-scoped object storage.">
        <AttachmentManager entityType="MEMBER" entityId={member.id} canWrite={can("members:write")} />
      </SectionCard>

      <SectionCard title="Mobile App Access" description="Lets this member log into the CivicFlow mobile app to view dues, report payments, and receive announcements.">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard
            label="App Login"
            value={member.userId ? "Linked" : "Not set up"}
            helper={member.userId ? "This member can log into the mobile app." : "Send an invite to let them set up a password."}
          />
          <StatCard
            label="Push Notifications"
            value={member.commsPushEnabled ? "Enabled" : "Opted out"}
            helper={member.requiredNoticesOnly ? "Required notices only" : "Marketing + required notices"}
          />
        </div>
        {!member.userId && can("members:write") ? (
          <div className="mt-4">
            <InviteMemberToAppButton memberId={member.id} />
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="SMS Preferences" description="SMS is a paid add-on — this member only receives texts if their organization has it enabled and they've opted in.">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard
            label="SMS Notifications"
            value={member.commsSmsEnabled ? "Enabled" : "Opted out"}
            helper={member.phone ? undefined : "No phone number on file"}
          />
          <StatCard
            label="Carrier Opt-Out (STOP)"
            value={member.smsOptedOutAt ? `Replied STOP ${formatDate(member.smsOptedOutAt)}` : "None recorded"}
            helper={member.smsOptedOutAt ? "Blocks SMS regardless of the toggle until they text START" : undefined}
          />
        </div>
      </SectionCard>

      <SectionCard title="Member Timeline" description="Recent member transitions and activity history.">
        <div className="space-y-3">
          {recentTimelineEvents.length === 0 ? <p className="text-sm text-slate-600">No timeline events yet.</p> : recentTimelineEvents.map((event) => (
            <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-950">{event.title}</p>
              <p className="mt-1 text-xs text-slate-700">{formatEnumLabel(event.eventType)} · {formatDate(event.occurredAt)}</p>
              {event.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{event.description}</p> : null}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Link href={`/members/${member.id}/timeline`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">View full timeline</Link>
        </div>
      </SectionCard>

      <SectionCard title="Communications and Follow-ups" description="Recent communication history and open follow-up items for this member.">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Recent Communications" value={recentCommunications.length} />
          <StatCard label="Open Follow-ups" value={followUpCommunications.length} />
          <StatCard label="Latest Communication" value={formatDate(recentCommunications[0]?.communicationDate)} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Follow-up</th></tr>
            </thead>
            <tbody>
              {recentCommunications.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No communications recorded yet.</td></tr>
              ) : recentCommunications.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDate(row.communicationDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.communicationType)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatText(row.subject, "No subject")}</td>
                  <td className="px-4 py-3 text-slate-900">{row.followUpRequired ? formatDate(row.followUpDate, "Required") : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/members/${member.id}/communications`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">View all communications</Link>
          <Link href={`/communications/new?memberId=${member.id}`} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Log communication</Link>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Sent</th></tr>
            </thead>
            <tbody>
              {recentCampaignRecipients.length === 0 ? <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-600">No campaign deliveries recorded.</td></tr> : recentCampaignRecipients.map((row) => (
                <tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-3 text-slate-900">{row.campaign.title}</td><td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.deliveryStatus)}</td><td className="px-4 py-3 text-slate-900">{formatDate(row.sentAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Electronic Payment Reconciliation" description="Recent imported electronic payments matched or posted to this member.">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Posted As</th></tr></thead>
            <tbody>{recentPaymentImports.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">No imported electronic payments matched.</td></tr> : recentPaymentImports.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-3 text-slate-900">{formatDate(row.transactionDate)}</td><td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.sourceType)}</td><td className="px-4 py-3 text-slate-900">{formatCurrency(row.amount)}</td><td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.verificationStatus)}</td><td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.postedAs)}</td></tr>)}</tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Attendance" description="Recent attendance for events and general meetings.">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Recent Records" value={recentAttendance.length} />
          <StatCard label="Present / Virtual" value={recentAttendance.filter((row) => ["PRESENT", "VIRTUAL"].includes(row.attendanceStatus)).length} />
          <StatCard label="Latest Attendance" value={formatDate(recentAttendance[0]?.meetingDate)} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Meeting / Event</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody>
              {recentAttendance.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-600">No attendance recorded yet.</td></tr>
              ) : recentAttendance.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDate(row.meetingDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{row.event?.title ?? formatText(row.meetingTitle, "General meeting")}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.attendanceStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/members/${member.id}/attendance`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">View attendance</Link>
          <Link href={`/attendance/new?memberId=${member.id}`} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Record attendance</Link>
        </div>
      </SectionCard>

      <SectionCard title="Dues Summary" description="Outstanding balance and recent dues movement for this member.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Charges" value={duesTotals._count.id} />
          <StatCard label="Total Assessed" value={formatCurrency(totalDuesAssessed)} />
          <StatCard label="Applied to Charges" value={formatCurrency(totalDuesApplied)} />
          <StatCard label="Adjustments" value={formatCurrency(totalDuesAdjusted)} helper={`${duesAdjustmentTotals._count.id} adjustments`} />
          <StatCard label="Outstanding" value={formatCurrency(totalOutstanding)} helper={`${duesOpenCount} open charges`} />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <DuesGenerateForm memberId={member.id} canWrite={can("dues:write")} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-950">Recent Dues Charges</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCharges.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-600">
                        No dues charges recorded yet.
                      </td>
                    </tr>
                  ) : (
                    recentCharges.map((charge) => (
                      <tr key={charge.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-900">{formatDate(charge.dueDate)}</td>
                        <td className="px-4 py-3 text-slate-900">{charge.duesAccount.name}</td>
                        <td className="px-4 py-3 text-slate-900">{formatEnumLabel(charge.status)}</td>
                        <td className="px-4 py-3 text-slate-900">{formatCurrency(charge.amountDue)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-950">Recent Dues Payments</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Applied Charge</th>
                    <th className="px-4 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-600">
                        No dues payments recorded yet.
                      </td>
                    </tr>
                  ) : (
                    recentPayments.map((payment) => (
                      <tr key={payment.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-900">{formatDate(payment.paymentDate)}</td>
                        <td className="px-4 py-3 text-slate-900">{methodLabels[payment.method] ?? formatEnumLabel(payment.method)}</td>
                        <td className="px-4 py-3 text-slate-900">
                          {payment.duesCharge
                            ? `${formatDate(payment.duesCharge.dueDate)} · ${formatEnumLabel(payment.duesCharge.status)}`
                            : payment.duesAccount?.name ?? "Unapplied"}
                        </td>
                        <td className="px-4 py-3 text-slate-900">{formatCurrency(payment.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-700">
              Total dues payments recorded:{" "}
              <span className="font-semibold text-slate-950">
                {formatCurrency(duesPaymentTotals._sum.amount)}
              </span>{" "}
              across {duesPaymentTotals._count.id} payments.
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">Dues Adjustments</h3>
          <div className="mt-4">
            <DuesAdjustmentForm memberId={member.id} canWrite={can("dues:write")} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentAdjustments.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No dues adjustments recorded.</td></tr>
                ) : recentAdjustments.map((adjustment) => (
                  <tr key={adjustment.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatDate(adjustment.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(adjustment.adjustmentType)}</td>
                    <td className="px-4 py-3 text-slate-900">{adjustment.reason}</td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(adjustment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Contribution Summary" description="Donation history tied directly to this member.">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Contributions" value={contributionTotals._count.id} />
          <StatCard label="Total Raised" value={formatCurrency(totalContributions)} />
          <StatCard
            label="Most Recent Contribution"
            value={formatDate(contributionTotals._max.contributionDate)}
          />
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Campaign / Event</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentContributions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-600">
                    No contributions have been recorded for this member yet.
                  </td>
                </tr>
              ) : (
                recentContributions.map((contribution) => (
                  <tr key={contribution.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatDate(contribution.contributionDate)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(contribution.source)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {contribution.campaign?.name || contribution.event?.title || "Direct / manual"}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(contribution.amount)}</td>
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

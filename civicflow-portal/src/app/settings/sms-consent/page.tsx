import { headers } from "next/headers";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatPersonName, formatText } from "@/lib/formatting";
import { formatSmsOptInMethod } from "@/lib/sms-consent-text";
import { maskPhone } from "@/lib/sms-otp";

/** Best-effort public origin from proxy headers, same approach as the Twilio webhook's signature check. */
async function getPublicOrigin(): Promise<string> {
  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  return host ? `${proto}://${host}` : "";
}

export default async function SmsConsentPage() {
  const { organizationId } = await requirePermission("sms_consent:read");

  const [members, origin] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ smsOptInDate: "desc" }, { lastName: "asc" }],
      take: 200,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        phone: true,
        smsOptIn: true,
        smsOptInDate: true,
        smsOptInMethod: true,
        smsOptOutDate: true,
        smsOptedOutAt: true,
      },
    }),
    getPublicOrigin(),
  ]);

  const optedIn = members.filter((m) => m.smsOptIn).length;
  const optedOut = members.filter((m) => !m.smsOptIn && m.smsOptOutDate).length;
  const neverAsked = members.length - optedIn - optedOut;

  const optInUrl = origin ? `${origin}/sms-opt-in?org=${organizationId}` : null;
  const qrCodeDataUrl = optInUrl ? await QRCode.toDataURL(optInUrl, { width: 240, margin: 1 }) : null;

  return (
    <main className="space-y-6">
      <PageHeader
        title="SMS Consent"
        description="Review each member's SMS opt-in status for Twilio/TCPA compliance auditing, and get a QR code members can scan to opt in."
        actions={[
          { href: "/settings", label: "Settings Hub" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total Members" value={members.length} />
        <StatCard label="Opted In" value={optedIn} />
        <StatCard label="Opted Out" value={optedOut} />
        <StatCard label="Never Asked" value={neverAsked} />
      </div>

      <SectionCard
        title="Get QR Code"
        description="Print this on flyers, event signage, or your website. Scanning it opens your organization's SMS opt-in page."
      >
        {qrCodeDataUrl ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCodeDataUrl} alt="QR code linking to the SMS opt-in page" className="h-40 w-40 rounded-lg border border-slate-200" />
            <div className="space-y-2 text-sm text-slate-700">
              <p className="break-all text-slate-600">{optInUrl}</p>
              <a
                href={qrCodeDataUrl}
                download="unestra-sms-opt-in-qr.png"
                className="inline-block rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Download QR Code
              </a>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Unable to determine this site's public URL to generate a QR code.</p>
        )}
      </SectionCard>

      <SectionCard title="Consent Log" description="One row per member, showing the latest recorded opt-in/opt-out state.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Opt-In Date</th>
                <th className="px-4 py-3">Opt-Out Date</th>
                <th className="px-4 py-3">Method</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                    No members on file yet.
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatPersonName(member)}</td>
                    <td className="px-4 py-3 text-slate-900">{member.phone ? maskPhone(member.phone) : "—"}</td>
                    <td className="px-4 py-3">
                      {member.smsOptedOutAt ? (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                          STOP received
                        </span>
                      ) : member.smsOptIn ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                          Opted in
                        </span>
                      ) : member.smsOptOutDate ? (
                        <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                          Withdrawn
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">
                          Not asked
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatDateTime(member.smsOptInDate)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatDateTime(member.smsOptOutDate)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatText(formatSmsOptInMethod(member.smsOptInMethod))}</td>
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

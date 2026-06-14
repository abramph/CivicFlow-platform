import type { Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { formatDate, formatPersonName } from "@/lib/formatting";
import { sendEmail } from "@/lib/mail";
import { buildMemberOrderBy, buildMemberWhere, parseMemberFilters } from "@/lib/member-filters";
import { prisma } from "@/lib/prisma";
import type { ReportData, ReportType } from "@/lib/reports/report-builder";
import type { ReportExportFormat } from "@/lib/reports/exporters";

export type ReportRecipientMode =
  | "all_active"
  | "filtered_members"
  | "category"
  | "location"
  | "delinquent"
  | "event_attendees"
  | "meeting_attendees"
  | "manual"
  | "external";

export type ReportRecipient = {
  memberId?: string;
  email: string;
  phone?: string | null;
  name?: string;
};

export type ResolveReportRecipientsInput = {
  organizationId: string;
  recipientMode: ReportRecipientMode;
  filters?: Record<string, unknown>;
  selectedMemberIds?: string[];
  externalEmail?: string | null;
};

export type SendReportEmailInput = ResolveReportRecipientsInput & {
  reportType: ReportType;
  startDate?: string | null;
  endDate?: string | null;
  format: ReportExportFormat;
  report: ReportData;
  subject: string;
  body: string;
  includeSummary?: boolean;
  attachmentBuffer?: Buffer | null;
  attachmentFileName?: string | null;
  attachmentContentType?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(values: string[] | undefined) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function filtersToSearchParams(filters: Record<string, unknown> | undefined) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (typeof value === "string" && value) params.set(key, value);
  }
  return params;
}

function memberSelectWhere(input: ResolveReportRecipientsInput): Prisma.OrgMemberWhereInput {
  const filters = input.filters ?? {};
  if (input.recipientMode === "filtered_members") {
    return buildMemberWhere(input.organizationId, parseMemberFilters(filtersToSearchParams(filters)));
  }
  if (input.recipientMode === "category") {
    return { organizationId: input.organizationId, membershipStatus: "active", membershipCategoryId: stringValue(filters.categoryId) || undefined };
  }
  if (input.recipientMode === "location") {
    return {
      organizationId: input.organizationId,
      membershipStatus: "active",
      ...(stringValue(filters.city) ? { city: { contains: stringValue(filters.city), mode: "insensitive" } } : {}),
      ...(stringValue(filters.state) ? { state: { contains: stringValue(filters.state), mode: "insensitive" } } : {}),
      ...(stringValue(filters.zipCode) ? { zipCode: { contains: stringValue(filters.zipCode), mode: "insensitive" } } : {}),
      ...(stringValue(filters.county) ? { county: { contains: stringValue(filters.county), mode: "insensitive" } } : {}),
    };
  }
  if (input.recipientMode === "delinquent") {
    return { organizationId: input.organizationId, isDelinquent: true };
  }
  if (input.recipientMode === "manual") {
    return { organizationId: input.organizationId, id: { in: asStringArray(input.selectedMemberIds) } };
  }
  return { organizationId: input.organizationId, membershipStatus: "active" };
}

export async function resolveReportRecipients(input: ResolveReportRecipientsInput) {
  if (input.recipientMode === "external") {
    const email = stringValue(input.externalEmail);
    const recipients: ReportRecipient[] = email ? [{ email, name: email }] : [];
    return { recipients, skippedNoEmail: email ? 0 : 1 };
  }

  if (input.recipientMode === "event_attendees" || input.recipientMode === "meeting_attendees") {
    const eventId = stringValue(input.filters?.eventId);
    const meetingId = stringValue(input.filters?.meetingId);
    const attendanceRows = await prisma.attendanceRecord.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.recipientMode === "event_attendees" ? { eventId } : { meetingId }),
      },
      include: { member: true },
      distinct: ["memberId"],
      orderBy: { meetingDate: "desc" },
      take: 5000,
    });
    const recipients = attendanceRows
      .filter((row) => row.member.email)
      .map((row) => ({ memberId: row.memberId, email: row.member.email as string, phone: row.member.phone, name: formatPersonName(row.member) }));
    return { recipients, skippedNoEmail: attendanceRows.length - recipients.length };
  }

  const parsedFilters = parseMemberFilters(filtersToSearchParams(input.filters));
  const members = await prisma.orgMember.findMany({
    where: memberSelectWhere(input),
    orderBy: input.recipientMode === "filtered_members" ? buildMemberOrderBy(parsedFilters.sort) : [{ lastName: "asc" }, { firstName: "asc" }],
    take: 5000,
  });
  const recipients = members
    .filter((member) => member.email)
    .map((member) => ({ memberId: member.id, email: member.email as string, phone: member.phone, name: formatPersonName(member) }));
  return { recipients, skippedNoEmail: members.length - recipients.length };
}

function summaryText(report: ReportData) {
  if (!report.summary.length) return "";
  return report.summary.map((item) => `${item.label}: ${item.value}`).join("\n");
}

export async function sendReportEmail(input: SendReportEmailInput) {
  const { recipients, skippedNoEmail } = await resolveReportRecipients(input);
  const campaign = await prisma.communicationCampaign.create({
    data: {
      organizationId: input.organizationId,
      title: `Report: ${input.report.title}`,
      communicationType: "GENERAL",
      channel: "EMAIL",
      subject: input.subject,
      body: input.body,
      status: "SENDING",
      recipientFilter: {
        mode: input.recipientMode,
        filters: input.filters ?? {},
        reportType: input.reportType,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      } as Prisma.InputJsonObject,
      attachmentKeys: input.attachmentFileName
        ? { fileName: input.attachmentFileName, format: input.format, generatedAt: new Date().toISOString() }
        : undefined,
      createdByUserId: input.actorUserId ?? null,
    },
  });

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = skippedNoEmail;
  const bodyParts = [input.body];
  if (input.includeSummary) bodyParts.push("", "Report summary:", summaryText(input.report));
  bodyParts.push("", `Generated: ${formatDate(input.report.metadata.generatedAt)}`);
  const text = bodyParts.filter(Boolean).join("\n");

  for (const recipient of recipients) {
    const recipientRow = await prisma.communicationRecipient.create({
      data: {
        organizationId: input.organizationId,
        campaignId: campaign.id,
        memberId: recipient.memberId ?? null,
        email: recipient.email,
        phone: recipient.phone ?? null,
        deliveryStatus: "PENDING",
      },
    });

    try {
      const result = await sendEmail({
        to: recipient.email,
        subject: input.subject,
        text,
        attachments:
          input.attachmentBuffer && input.attachmentFileName
            ? [{ filename: input.attachmentFileName, content: input.attachmentBuffer, contentType: input.attachmentContentType ?? undefined }]
            : undefined,
      });

      if (result.sent) {
        sentCount += 1;
        await prisma.communicationRecipient.update({ where: { id: recipientRow.id }, data: { deliveryStatus: "SENT", sentAt: new Date() } });
      } else {
        skippedCount += 1;
        await prisma.communicationRecipient.update({ where: { id: recipientRow.id }, data: { deliveryStatus: "SKIPPED", errorMessage: result.reason ?? "Email sending disabled" } });
      }

      if (recipient.memberId) {
        await prisma.communicationLog.create({
          data: {
            organizationId: input.organizationId,
            memberId: recipient.memberId,
            createdByUserId: input.actorUserId ?? null,
            communicationType: "EMAIL",
            direction: "OUTBOUND",
            subject: input.subject,
            message: text,
            outcome: result.sent ? "Report sent" : "Report send skipped",
            communicationDate: new Date(),
          },
        });
      }
    } catch (error) {
      failedCount += 1;
      await prisma.communicationRecipient.update({
        where: { id: recipientRow.id },
        data: { deliveryStatus: "FAILED", errorMessage: error instanceof Error ? error.message : "Failed to send email" },
      });
    }
  }

  await prisma.communicationCampaign.update({
    where: { id: campaign.id },
    data: { status: failedCount > 0 && sentCount === 0 ? "FAILED" : "SENT", sentAt: new Date() },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "send",
    entityType: "report",
    entityId: campaign.id,
    metadata: {
      reportType: input.reportType,
      format: input.format,
      recipientMode: input.recipientMode,
      recipientCount: recipients.length,
      skippedCount,
      failedCount,
      externalEmail: input.recipientMode === "external" ? input.externalEmail : undefined,
    },
  });

  return {
    campaignId: campaign.id,
    recipientCount: recipients.length,
    sentCount,
    skippedCount,
    failedCount,
  };
}

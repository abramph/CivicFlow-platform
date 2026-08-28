import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { requireVolunteerHoursFlag } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildVolunteerReportExportFile, isVolunteerReportType } from "@/lib/labs/pta/volunteer-hours/reports/dispatch";
import { resolveGeneratedByName, volunteerReportFiltersFromJson } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { buildSafeObjectKey, uploadBufferToSpaces } from "@/lib/storage";

type SupportedReportType =
  | "MEMBERS"
  | "DUES"
  | "CONTRIBUTIONS"
  | "CAMPAIGNS"
  | "EVENTS"
  | "EXPENDITURES";

const SUPPORTED_REPORT_TYPES = new Set<SupportedReportType>([
  "MEMBERS",
  "DUES",
  "CONTRIBUTIONS",
  "CAMPAIGNS",
  "EVENTS",
  "EXPENDITURES",
]);

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
    return `"${text.replace(/\"/g, "\"\"")}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

async function buildReportCsv(organizationId: string, reportType: SupportedReportType) {
  switch (reportType) {
    case "MEMBERS": {
      const rows = await prisma.orgMember.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 2000 });
      return toCsv(
        ["id", "firstName", "lastName", "email", "status", "createdAt"],
        rows.map((r) => [r.id, r.firstName, r.lastName, r.email, r.membershipStatus, r.createdAt.toISOString()])
      );
    }
    case "DUES": {
      const rows = await prisma.duesCharge.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 2000 });
      return toCsv(
        ["id", "memberId", "amountDue", "amountPaid", "status", "dueDate"],
        rows.map((r) => [r.id, r.memberId, r.amountDue.toString(), r.amountPaid.toString(), r.status, r.dueDate.toISOString()])
      );
    }
    case "CONTRIBUTIONS": {
      const rows = await prisma.contribution.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 2000 });
      return toCsv(
        ["id", "memberId", "campaignId", "eventId", "amount", "source", "date"],
        rows.map((r) => [r.id, r.memberId, r.campaignId, r.eventId, r.amount.toString(), r.source, r.contributionDate.toISOString()])
      );
    }
    case "CAMPAIGNS": {
      const rows = await prisma.campaign.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 2000 });
      return toCsv(
        ["id", "name", "status", "goal", "startDate", "endDate"],
        rows.map((r) => [r.id, r.name, r.status, r.goal?.toString() ?? "", r.startDate?.toISOString() ?? "", r.endDate?.toISOString() ?? ""])
      );
    }
    case "EVENTS": {
      const rows = await prisma.event.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 2000 });
      return toCsv(
        ["id", "title", "status", "location", "startAt", "endAt"],
        rows.map((r) => [r.id, r.title, r.status, r.location, r.startAt?.toISOString() ?? "", r.endAt?.toISOString() ?? ""])
      );
    }
    case "EXPENDITURES": {
      const rows = await prisma.expenditure.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 2000 });
      return toCsv(
        ["id", "description", "amount", "category", "date", "vendor"],
        rows.map((r) => [r.id, r.description, r.amount.toString(), r.category, r.date.toISOString(), r.vendor])
      );
    }
    default:
      throw new Error(`Unsupported report type: ${reportType}`);
  }
}

export async function processQueuedReportExport(exportId: string) {
  const exportJob = await prisma.reportExport.findFirst({ where: { id: exportId } });
  if (!exportJob) throw new Error("Report export not found");

  // Volunteer Hour Requirements & Buyout program, VH-K (docs/pta-volunteer-hours.md):
  // background generation for Reports A-G, reusing this exact worker/queue
  // rather than a second polling loop. Real .xlsx (not CSV), so it's kept as
  // its own branch ahead of the generic CSV path below rather than folded
  // into buildReportCsv.
  if (isVolunteerReportType(exportJob.reportType)) {
    await prisma.reportExport.update({ where: { id: exportId }, data: { status: "PROCESSING" } });
    try {
      // Re-checked here, not just at enqueue time: platform switch, pilot
      // allowlist, and the reports capability flag must all still hold at
      // the moment a queued job actually runs, not only when it was
      // originally requested — a flag or allowlist change between enqueue
      // and processing must not let a stale job slip through.
      await requireVolunteerHoursFlag(exportJob.organizationId, "reports");
      const filters = volunteerReportFiltersFromJson(exportJob.filters);
      const generatedByName = await resolveGeneratedByName(exportJob.createdByUserId ?? "");
      const { buffer, filename } = await buildVolunteerReportExportFile(exportJob.organizationId, exportJob.reportType, filters, generatedByName);
      const fileKey = buildSafeObjectKey(`pta-volunteer-reports/${exportJob.organizationId}`, filename);

      await uploadBufferToSpaces({
        key: fileKey,
        buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        metadata: { reportExportId: exportJob.id, organizationId: exportJob.organizationId },
      });

      await prisma.reportExport.update({
        where: { id: exportId },
        data: { status: "COMPLETED", fileUrl: fileKey, completedAt: new Date() },
      });

      await createAuditEvent({
        organizationId: exportJob.organizationId,
        actorUserId: exportJob.createdByUserId,
        action: "export",
        entityType: "pta_volunteer_report_export",
        entityId: exportJob.id,
        metadata: { status: "COMPLETED", reportType: exportJob.reportType, fileKey },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Report export failed";
      await prisma.reportExport.update({ where: { id: exportId }, data: { status: "FAILED", errorMessage: message } });
      await createAuditEvent({
        organizationId: exportJob.organizationId,
        actorUserId: exportJob.createdByUserId,
        action: "export",
        entityType: "pta_volunteer_report_export",
        entityId: exportJob.id,
        metadata: { status: "FAILED", error: message },
      });
    }
    return;
  }

  if (!SUPPORTED_REPORT_TYPES.has(exportJob.reportType as SupportedReportType)) {
    await prisma.reportExport.update({
      where: { id: exportId },
      data: { status: "FAILED", errorMessage: `Unsupported report type: ${exportJob.reportType}` },
    });
    return;
  }

  await prisma.reportExport.update({ where: { id: exportId }, data: { status: "PROCESSING" } });

  try {
    const csv = await buildReportCsv(exportJob.organizationId, exportJob.reportType as SupportedReportType);
    const fileKey = buildSafeObjectKey(`reports/${exportJob.organizationId}`, `${exportJob.reportType}.csv`);

    await uploadBufferToSpaces({
      key: fileKey,
      buffer: Buffer.from(csv, "utf8"),
      contentType: "text/csv",
      metadata: {
        reportExportId: exportJob.id,
        organizationId: exportJob.organizationId,
      },
    });

    await prisma.reportExport.update({
      where: { id: exportId },
      data: {
        status: "COMPLETED",
        fileUrl: fileKey,
        completedAt: new Date(),
      },
    });

    await prisma.attachment.create({
      data: {
        organizationId: exportJob.organizationId,
        entityType: "REPORT_EXPORT",
        entityId: exportJob.id,
        purpose: "REPORT_EXPORT_FILE",
        fileName: `${exportJob.reportType}.csv`,
        contentType: "text/csv",
        byteSize: Buffer.byteLength(csv, "utf8"),
        objectKey: fileKey,
        title: `${exportJob.reportType} export`,
        uploadedByUserId: exportJob.createdByUserId,
      },
    });

    await createAuditEvent({
      organizationId: exportJob.organizationId,
      actorUserId: exportJob.createdByUserId,
      action: "export",
      entityType: "report_export",
      entityId: exportJob.id,
      metadata: {
        status: "COMPLETED",
        reportType: exportJob.reportType,
        fileKey,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report export failed";
    await prisma.reportExport.update({
      where: { id: exportId },
      data: { status: "FAILED", errorMessage: message },
    });

    await createAuditEvent({
      organizationId: exportJob.organizationId,
      actorUserId: exportJob.createdByUserId,
      action: "export",
      entityType: "report_export",
      entityId: exportJob.id,
      metadata: {
        status: "FAILED",
        error: message,
      },
    });
  }
}

export async function processQueuedReportExports(limit = 25) {
  const queued = await prisma.reportExport.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const item of queued) {
    await processQueuedReportExport(item.id);
  }

  return { processed: queued.length };
}

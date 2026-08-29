import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { requireVolunteerHoursFlag } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildVolunteerReportExportFile, isVolunteerReportType } from "@/lib/labs/pta/volunteer-hours/reports/dispatch";
import { resolveGeneratedByName, volunteerReportFiltersFromJson } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { buildSafeObjectKey, uploadBufferToSpaces } from "@/lib/storage";
import {
  attemptClaimReportExport,
  bestEffortCleanupFailedVolunteerReportUpload,
  buildDeterministicVolunteerReportObjectKey,
  claimReportExportBatch,
  completeReportExport,
  resolveReportExportFailure,
  runReportExportCleanup,
} from "@/lib/report-export-queue";

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

/**
 * fix/report-export-queue-hardening: safe to call two ways —
 * (a) after claimReportExportBatch already atomically claimed this row
 *     (status is already PROCESSING, owned by this invocation), or
 * (b) directly on a still-QUEUED id (e.g. a test, or any future direct
 *     caller) — in which case this function claims it itself first via the
 *     exact same atomic conditional update claimReportExportBatch uses.
 * Either way, if the claim doesn't succeed (already claimed elsewhere,
 * already terminal, or genuinely doesn't exist), this returns quietly
 * rather than reprocessing or erroring — never a double-run.
 */
export async function processQueuedReportExport(exportId: string) {
  const exportJob = await prisma.reportExport.findFirst({ where: { id: exportId } });
  if (!exportJob) throw new Error("Report export not found");

  let attemptCount = exportJob.attemptCount;
  if (exportJob.status !== "PROCESSING") {
    const { claimed } = await attemptClaimReportExport(exportId);
    if (!claimed) return; // lost the race, already terminal, or not yet due for retry — not an error
    attemptCount += 1;
  }

  // Volunteer Hour Requirements & Buyout program, VH-K (docs/pta-volunteer-hours.md):
  // background generation for Reports A-G, reusing this exact worker/queue
  // rather than a second polling loop. Real .xlsx (not CSV), so it's kept as
  // its own branch ahead of the generic CSV path below rather than folded
  // into buildReportCsv.
  if (isVolunteerReportType(exportJob.reportType)) {
    try {
      // Re-checked here, not just at enqueue time: platform switch, pilot
      // allowlist, and the reports capability flag must all still hold at
      // the moment a queued job actually runs, not only when it was
      // originally requested — a flag or allowlist change between enqueue
      // and processing must not let a stale job slip through. This is also
      // what guarantees a disabled organization's queued export cannot
      // complete: this throws a permanent PtaError, which resolveReportExportFailure
      // below sends straight to FAILED without ever uploading a file.
      await requireVolunteerHoursFlag(exportJob.organizationId, "reports");
      const filters = volunteerReportFiltersFromJson(exportJob.filters);
      const generatedByName = await resolveGeneratedByName(exportJob.createdByUserId ?? "");
      const { buffer, filename } = await buildVolunteerReportExportFile(exportJob.organizationId, exportJob.reportType, filters, generatedByName);
      // Deterministic (organizationId + exportId), not the random-suffixed
      // buildSafeObjectKey — a retry re-PUTs to the identical key, which
      // Spaces treats as a plain overwrite rather than a new orphaned object.
      // The human-readable name still reaches the downloader via
      // Content-Disposition, set separately below.
      const fileKey = buildDeterministicVolunteerReportObjectKey(exportJob.organizationId, exportJob.id);

      await uploadBufferToSpaces({
        key: fileKey,
        buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        metadata: { reportExportId: exportJob.id, organizationId: exportJob.organizationId },
        downloadFilename: filename,
      });

      await completeReportExport(exportJob.id, fileKey);

      await createAuditEvent({
        organizationId: exportJob.organizationId,
        actorUserId: exportJob.createdByUserId,
        action: "export",
        entityType: "pta_volunteer_report_export",
        entityId: exportJob.id,
        metadata: { status: "COMPLETED", reportType: exportJob.reportType, fileKey },
      });
    } catch (error) {
      const { terminal, sanitizedMessage } = await resolveReportExportFailure(exportJob.id, attemptCount, error);
      if (terminal) {
        // Best-effort: an earlier attempt in this same job's history might
        // have uploaded before a later step failed. Safe unconditionally —
        // deleting a key that was never written is a normal no-op.
        await bestEffortCleanupFailedVolunteerReportUpload(exportJob.organizationId, exportJob.id);
      }
      await createAuditEvent({
        organizationId: exportJob.organizationId,
        actorUserId: exportJob.createdByUserId,
        action: "export",
        entityType: "pta_volunteer_report_export",
        entityId: exportJob.id,
        metadata: { status: terminal ? "FAILED" : "RETRY_SCHEDULED", error: sanitizedMessage, attemptCount },
      });
    }
    return;
  }

  if (!SUPPORTED_REPORT_TYPES.has(exportJob.reportType as SupportedReportType)) {
    // Permanent by construction — no retry could ever make an unknown
    // report type become known, so this bypasses the generic retry
    // machinery and goes straight to FAILED, same as before this change.
    await prisma.reportExport.update({
      where: { id: exportId },
      data: { status: "FAILED", errorMessage: `Unsupported report type: ${exportJob.reportType}`, leaseExpiresAt: null },
    });
    return;
  }

  try {
    const csv = await buildReportCsv(exportJob.organizationId, exportJob.reportType as SupportedReportType);
    // Unchanged from before this branch: random-suffixed key, Attachment
    // row created, no expiration/retention window applied — this program's
    // scope is the PTA volunteer export path's queue safety, not a
    // retention-policy change for every other vertical's CSV exports.
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
        leaseExpiresAt: null,
        errorMessage: null,
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
    // Same bounded-retry treatment as the PTA branch: no PtaError ever
    // comes out of buildReportCsv, so isPermanentReportExportError never
    // classifies a CSV failure as permanent — every CSV failure gets up to
    // REPORT_EXPORT_MAX_ATTEMPTS tries (strictly more resilient than the
    // previous immediate-FAILED behavior) before landing on FAILED.
    const { terminal, sanitizedMessage } = await resolveReportExportFailure(exportJob.id, attemptCount, error);
    await createAuditEvent({
      organizationId: exportJob.organizationId,
      actorUserId: exportJob.createdByUserId,
      action: "export",
      entityType: "report_export",
      entityId: exportJob.id,
      metadata: {
        status: terminal ? "FAILED" : "RETRY_SCHEDULED",
        error: sanitizedMessage,
      },
    });
  }
}

/**
 * Claims and processes a bounded batch, then runs a bounded cleanup sweep
 * for expired PTA-volunteer exports. Each claimed job is independent —
 * one job's failure never stops the others (processQueuedReportExport
 * already catches its own errors internally and always resolves).
 */
export async function processQueuedReportExports(limit = 25, cleanupLimit = 25) {
  const claimed = await claimReportExportBatch(limit);

  for (const item of claimed) {
    try {
      await processQueuedReportExport(item.id);
    } catch {
      // processQueuedReportExport already catches and resolves every error
      // it knows how to handle (transient -> retry, permanent -> FAILED).
      // This outer catch exists only so a genuinely unexpected exception in
      // one claimed job (e.g. the row vanishing between claim and this
      // call) can't abort the rest of an otherwise-healthy batch.
      continue;
    }
  }

  const cleanup = await runReportExportCleanup(cleanupLimit);

  return { processed: claimed.length, cleanupChecked: cleanup.checked, cleanupDeleted: cleanup.deleted };
}

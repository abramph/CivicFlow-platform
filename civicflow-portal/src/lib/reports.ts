import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { requireVolunteerHoursFlag } from "@/lib/labs/pta/volunteer-hours/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { hasCurrentPermissionForOrg } from "@/lib/role-permissions";
import { buildVolunteerReportExportFile, isVolunteerReportType } from "@/lib/labs/pta/volunteer-hours/reports/dispatch";
import { resolveGeneratedByName, volunteerReportFiltersFromJson } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { buildSafeObjectKey, uploadBufferToSpaces } from "@/lib/storage";
import {
  attemptClaimReportExport,
  bestEffortCleanupFailedVolunteerReportUpload,
  buildDeterministicVolunteerReportObjectKey,
  claimReportExportBatch,
  completeReportExport,
  markReportExportArtifactCleanupPending,
  renewReportExportLease,
  resolveReportExportFailure,
  runFailedArtifactCleanup,
  runReportExportCleanup,
} from "@/lib/report-export-queue";

/** "Record only a sanitized operational result" for the lost-ownership
 * path — never an AuditEvent (which would misattribute an outcome this
 * invocation didn't actually cause), never raw error/object data. */
function logOwnershipLost(exportId: string, boundary: string) {
  console.warn(`[report-export-queue] ownership lost for export ${exportId} at boundary "${boundary}" — stopping without mutating state`);
}

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
 *
 * Every subsequent state transition (lease renewal, completion, failure) is
 * conditioned on the claimId this invocation established here — if the
 * lease expires and another invocation reclaims the row mid-processing,
 * every one of THIS invocation's later conditional updates matches zero
 * rows, and this function stops immediately without completing, failing,
 * retry-scheduling, or deleting anything (see renewReportExportLease's
 * doc comment for why that's safe).
 */
export async function processQueuedReportExport(exportId: string) {
  const exportJob = await prisma.reportExport.findFirst({ where: { id: exportId } });
  if (!exportJob) throw new Error("Report export not found");

  let attemptCount = exportJob.attemptCount;
  let claimId = exportJob.claimId ?? "";
  if (exportJob.status !== "PROCESSING") {
    const claim = await attemptClaimReportExport(exportId);
    if (!claim.claimed) return; // lost the race, already terminal, or not yet due for retry — not an error
    attemptCount += 1;
    claimId = claim.claimId;
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
      // Deployment-gate review: financial content requires the permission to
      // hold at BOTH enqueue time and processing time, not processing time
      // alone. `hasCurrentPermissionForOrg` re-derives fresh from the
      // export's creator's CURRENT org role/permissions — same "must still
      // hold at the moment a queued job actually runs" reasoning as the flag
      // re-check just above, and it's what makes a permission LOSS between
      // enqueue and processing correctly narrow the export. On its own,
      // though, that check would let a permission GAINED after enqueue
      // silently EXPAND an already-queued export beyond what its requester
      // was authorized to see when they clicked "export" — the enqueue route
      // (.../reports/exports/route.ts) snapshots `_includeFinancialsAtEnqueue`
      // into this same job's `filters` for exactly this reason (no schema
      // migration needed; volunteerReportFiltersFromJson already ignores
      // unknown keys). ANDing the two means the export's financial content
      // is bounded by the MINIMUM of what held at either moment — a later
      // gain can never expand it, only a loss can narrow it further. Only
      // affects PTA_VOLUNTEER_FAMILY_SUMMARY and PTA_VOLUNTEER_COMPLIANCE;
      // harmless no-op lookup for every other report type (their
      // `_includeFinancialsAtEnqueue` key is simply absent/unused).
      const includeFinancialsAtEnqueue = (exportJob.filters as { _includeFinancialsAtEnqueue?: boolean } | null)?._includeFinancialsAtEnqueue === true;
      const includeFinancials =
        includeFinancialsAtEnqueue &&
        (await hasCurrentPermissionForOrg(exportJob.organizationId, exportJob.createdByUserId ?? "", PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW));
      // The bulk of this call's work (exceljs's workbook.xlsx.writeBuffer)
      // is synchronous CPU-bound XML/zip construction — no heartbeat can
      // reliably fire mid-call. REPORT_EXPORT_LEASE_MS is sized to
      // comfortably exceed the platform's 100s hard HTTP-request ceiling
      // specifically so this gap can never legitimately outlive the lease
      // (see report-export-queue.ts's documented reasoning). The renewal
      // immediately after is the real async boundary this code DOES have.
      const { buffer, filename } = await buildVolunteerReportExportFile(
        exportJob.organizationId,
        exportJob.reportType,
        filters,
        generatedByName,
        includeFinancials
      );

      if (!(await renewReportExportLease(exportId, claimId))) {
        logOwnershipLost(exportId, "before-upload");
        return;
      }

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

      if (!(await renewReportExportLease(exportId, claimId))) {
        // Ownership moved on between finishing the upload and this check.
        // Never delete fileKey here — the current owner may have uploaded
        // (or be about to upload) the exact same deterministic key as its
        // own valid, current attempt.
        logOwnershipLost(exportId, "after-upload-before-completion");
        return;
      }

      const completed = await completeReportExport(exportJob.id, claimId, fileKey);
      if (!completed) {
        logOwnershipLost(exportId, "completion");
        return;
      }

      await createAuditEvent({
        organizationId: exportJob.organizationId,
        actorUserId: exportJob.createdByUserId,
        action: "export",
        entityType: "pta_volunteer_report_export",
        entityId: exportJob.id,
        metadata: { status: "COMPLETED", reportType: exportJob.reportType, fileKey },
      });
    } catch (error) {
      const { ownershipRetained, terminal, sanitizedMessage } = await resolveReportExportFailure(exportJob.id, claimId, attemptCount, error);
      if (!ownershipRetained) {
        logOwnershipLost(exportId, "failure-resolution");
        return;
      }
      if (terminal) {
        // Best-effort: an earlier attempt in this same job's history might
        // have uploaded before a later step failed. Safe unconditionally —
        // deleting a key that was never written is a normal no-op. If the
        // delete itself fails, persist a durable, retryable cleanup record
        // rather than silently losing track of a possible orphan.
        const deleted = await bestEffortCleanupFailedVolunteerReportUpload(exportJob.organizationId, exportJob.id);
        if (!deleted) {
          await markReportExportArtifactCleanupPending(exportJob.id, new Error("initial best-effort artifact delete failed"));
        }
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
    // Claim-ID-conditioned like every other terminal write, even though a
    // lost race here is extremely unlikely given how fast this check runs.
    await prisma.reportExport.updateMany({
      where: { id: exportId, status: "PROCESSING", claimId },
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

    if (!(await renewReportExportLease(exportId, claimId))) {
      logOwnershipLost(exportId, "csv-after-upload-before-completion");
      return;
    }

    const completeResult = await prisma.reportExport.updateMany({
      where: { id: exportId, status: "PROCESSING", claimId },
      data: {
        status: "COMPLETED",
        fileUrl: fileKey,
        completedAt: new Date(),
        leaseExpiresAt: null,
        errorMessage: null,
      },
    });
    if (completeResult.count !== 1) {
      logOwnershipLost(exportId, "csv-completion");
      return;
    }

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
    const { ownershipRetained, terminal, sanitizedMessage } = await resolveReportExportFailure(exportJob.id, claimId, attemptCount, error);
    if (!ownershipRetained) {
      logOwnershipLost(exportId, "csv-failure-resolution");
      return;
    }
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
 * Claims and processes a bounded batch, then runs two bounded cleanup
 * sweeps: expired-COMPLETED-export objects, and durable retries for
 * permanently-FAILED exports whose initial best-effort artifact delete
 * failed. Each claimed job is independent — one job's failure never stops
 * the others (processQueuedReportExport already catches its own errors
 * internally and always resolves).
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
  const artifactCleanup = await runFailedArtifactCleanup(cleanupLimit);

  return {
    processed: claimed.length,
    cleanupChecked: cleanup.checked,
    cleanupDeleted: cleanup.deleted,
    artifactCleanupChecked: artifactCleanup.checked,
    artifactCleanupCleaned: artifactCleanup.cleaned,
  };
}

import { NextResponse } from "next/server";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { isVolunteerReportType, permissionForVolunteerReportType } from "@/lib/labs/pta/volunteer-hours/reports/dispatch";
import { prisma } from "@/lib/prisma";
import { getSignedObjectUrl } from "@/lib/storage";
import { withApiErrorHandling } from "@/lib/api-route";

/**
 * GET — secure download for a completed background volunteer-report export.
 * Deliberately its OWN route rather than the platform's generic
 * /api/attachments/[id]/download: that route grants read access to anyone
 * holding the generic "reports:read" permission, which would let a STAFF
 * officer (who has that, but not pta:volunteer-financial-reports:view)
 * download a queued Report E export just by knowing its id. Here the
 * permission is resolved per the export's own reportType before the
 * signed URL is ever generated.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string; exportId: string }> }) {
  return withApiErrorHandling(async () => {
    const { exportId } = await params;
    const exportJob = await prisma.reportExport.findFirst({ where: { id: exportId } });
    if (!exportJob || !isVolunteerReportType(exportJob.reportType)) {
      return NextResponse.json({ ok: false, error: "Export not found." }, { status: 404 });
    }

    const permission = permissionForVolunteerReportType(exportJob.reportType);
    const { organizationId } = await requireVolunteerHoursAccess(permission, "reports");
    if (organizationId !== exportJob.organizationId) {
      return NextResponse.json({ ok: false, error: "Export not found." }, { status: 404 });
    }
    if (exportJob.status !== "COMPLETED") {
      return NextResponse.json({ ok: false, error: "This export is not ready yet." }, { status: 409 });
    }
    // fix/report-export-queue-hardening: logical expiration — checked BEFORE
    // the fileUrl-null check below, deliberately. Once the cleanup sweep has
    // physically removed the object, fileUrl is cleared to null on an
    // otherwise still-COMPLETED, still-expired row — if the fileUrl check
    // ran first, that row would incorrectly report 409 "not ready yet"
    // (implying it might become available later) instead of 410 "expired"
    // (which is the true, permanent state). Fail-closed for the pilot: an
    // expired export is never downloadable, no grace window, and the
    // expired-vs-not-ready distinction is reported accurately either way.
    if (exportJob.expiresAt && exportJob.expiresAt < new Date()) {
      return NextResponse.json({ ok: false, error: "This export has expired." }, { status: 410 });
    }
    if (!exportJob.fileUrl) {
      // Defensive: a COMPLETED, unexpired row should always have a fileUrl —
      // this would only happen for data corrupted outside the normal
      // lifecycle. Treated as "not ready" rather than crashing.
      return NextResponse.json({ ok: false, error: "This export is not ready yet." }, { status: 409 });
    }

    const url = await getSignedObjectUrl(exportJob.fileUrl, 300);
    return NextResponse.redirect(url);
  });
}

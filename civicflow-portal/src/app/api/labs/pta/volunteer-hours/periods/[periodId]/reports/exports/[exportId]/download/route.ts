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
    if (exportJob.status !== "COMPLETED" || !exportJob.fileUrl) {
      return NextResponse.json({ ok: false, error: "This export is not ready yet." }, { status: 409 });
    }

    const url = await getSignedObjectUrl(exportJob.fileUrl, 300);
    return NextResponse.redirect(url);
  });
}

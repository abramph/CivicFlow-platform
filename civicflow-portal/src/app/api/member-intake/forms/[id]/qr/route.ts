import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { getServerEnv } from "@/lib/env";
import { MemberIntakeError } from "@/lib/member-intake/errors";
import { requireMemberIntakeView } from "@/lib/member-intake/forms";

/**
 * Mints a QR image + shareable URL for a form's current publicToken (or, if
 * `?sourceId=` is supplied, a specific QR-campaign source's token appended
 * as `?src=`) -- nothing persisted, regenerated on demand, same pattern as
 * /api/attendance-sessions/[id]/qr. The embedded URL never contains any
 * organization or form database id, only the opaque public token(s).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMemberIntakeView();
    const { id } = await params;
    const sourceId = new URL(request.url).searchParams.get("sourceId");

    const form = await prisma.memberIntakeForm.findFirst({ where: { id, organizationId }, select: { publicToken: true } });
    if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");

    let sourceToken: string | null = null;
    if (sourceId) {
      const source = await prisma.memberIntakeFormSource.findFirst({ where: { id: sourceId, formId: id }, select: { token: true } });
      if (!source) throw new MemberIntakeError("MEMBER_INTAKE_SOURCE_NOT_FOUND", "Source not found.");
      sourceToken = source.token;
    }

    const baseUrl = getServerEnv().NEXTAUTH_URL.replace(/\/+$/, "");
    const publicUrl = `${baseUrl}/f/${form.publicToken}${sourceToken ? `?src=${encodeURIComponent(sourceToken)}` : ""}`;
    const qrDataUrl = await QRCode.toDataURL(publicUrl, { errorCorrectionLevel: "M", margin: 2, scale: 8 });

    return Response.json({ ok: true, data: { publicUrl, qrDataUrl } });
  });
}

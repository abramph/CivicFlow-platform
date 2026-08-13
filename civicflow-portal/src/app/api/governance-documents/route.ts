import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import {
  GOVERNANCE_DOC_TYPES,
  GovernanceDocumentError,
  createGovernanceDocument,
  listGovernanceDocuments,
} from "@/lib/governance-documents";
import type { GovernanceDocumentType } from "@prisma/client";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("governance:read", "throw");
    const documents = await listGovernanceDocuments(organizationId);
    return Response.json({ ok: true, data: documents });
  });
}

function textValue(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: FormDataEntryValue | null): Date | null {
  const text = textValue(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new GovernanceDocumentError("Invalid date.");
  return parsed;
}

/** POST multipart/form-data — create a governing document or a new version of
 * one (rootDocumentId). The file is optional; makeCurrent publishes it. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("governance:write", "throw");
    const formData = await request.formData();

    const title = textValue(formData.get("title"));
    if (!title) throw new GovernanceDocumentError("Document title is required.");
    const docTypeRaw = textValue(formData.get("docType")) ?? "OTHER";
    if (!GOVERNANCE_DOC_TYPES.includes(docTypeRaw as GovernanceDocumentType)) {
      throw new GovernanceDocumentError("Unknown document type.");
    }

    const fileEntry = formData.get("file");
    let file: { fileName: string; contentType: string; buffer: Buffer } | null = null;
    if (fileEntry instanceof File && fileEntry.size > 0) {
      file = {
        fileName: fileEntry.name,
        contentType: fileEntry.type || "application/octet-stream",
        buffer: Buffer.from(await fileEntry.arrayBuffer()),
      };
    }

    const document = await createGovernanceDocument({
      organizationId,
      title,
      docType: docTypeRaw as GovernanceDocumentType,
      rootDocumentId: textValue(formData.get("rootDocumentId")),
      effectiveDate: dateValue(formData.get("effectiveDate")),
      approvedDate: dateValue(formData.get("approvedDate")),
      reviewDate: dateValue(formData.get("reviewDate")),
      notes: textValue(formData.get("notes")),
      file,
      makeCurrent: textValue(formData.get("makeCurrent")) === "true",
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: document }, { status: 201 });
  });
}

import type { ImportKind } from "@prisma/client";
import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hashFileBuffer, findExistingBatchByHash } from "@/lib/imports/file-identity";
import { buildImportSourceObjectKey, computeImportRetentionDate, uploadImportSourceFile } from "@/lib/imports/storage";
import { analyzeBatch } from "@/lib/imports/engine";
import { ImportError } from "@/lib/imports/errors";
import { IMPORT_KINDS, authorizeImportKind } from "@/lib/imports/authorization";
import { SpreadsheetValidationError } from "@/lib/imports/spreadsheet-parser";
import { parseUploadedSpreadsheet, ParseAdmissionDeniedError } from "@/lib/imports/parse-spreadsheet-isolated";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — same cap as the existing /api/import

/** Kind-specific required-mapping checks — same "at least the identity
 * fields must be mapped" spirit as Community's original check, extended per
 * kind's own required fields (see analyzePtaHouseholdRow/analyzeHoaPropertyRow
 * in engine.ts, which enforce the same requirements again per-row as a
 * defense-in-depth backstop). */
function validateMapping(importKind: ImportKind, mappedFields: Set<string>): void {
  if (importKind === "PTA_HOUSEHOLDS") {
    if (!mappedFields.has("householdName")) throw new ImportError("IMPORT_INVALID_MAPPING", "Household Name must be mapped.");
    if (!mappedFields.has("schoolYear")) throw new ImportError("IMPORT_INVALID_MAPPING", "School Year must be mapped.");
    if (!mappedFields.has("contactName")) throw new ImportError("IMPORT_INVALID_MAPPING", "Primary Contact Name must be mapped.");
    return;
  }
  if (importKind === "HOA_PROPERTIES") {
    if (!mappedFields.has("addressLine1")) throw new ImportError("IMPORT_INVALID_MAPPING", "Street Address must be mapped.");
    return;
  }
  // columnMapping is keyed by source header, valued by canonical field
  // (mapping[header] = field) — same direction documented on
  // src/lib/member-import.ts's buildFieldGetter, which reverses it to read
  // by field. Checking columnMapping.firstName directly here would look
  // for a *header* literally named "firstName" instead of checking
  // whether any header was mapped *to* firstName/lastName.
  if (!mappedFields.has("firstName") && !mappedFields.has("lastName")) {
    throw new ImportError("IMPORT_INVALID_MAPPING", "At least one of first name or last name must be mapped.");
  }
}

export async function POST(request: Request) {
  const limited = await requireRateLimit({ scope: "api:imports:create", request, limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  return withApiErrorHandling(async () => {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      return Response.json({ ok: false, error: "File too large (max 50 MB)", code: "IMPORT_VALIDATION_ERROR" }, { status: 413 });
    }

    const { organizationId, session, can } = await requirePermission("imports:create", "throw");

    // Auth-ordering follow-up -- content type checked before parsing,
    // and a malformed multipart body now surfaces as a clean 400 instead
    // of falling through to the generic unhandled-error path (safe
    // either way, but that path answers 500 for what is really a client
    // error). This route's auth/rate-limit/content-length ordering was
    // already correct (all run above, before this point) -- only these
    // two checks were missing.
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return Response.json({ ok: false, error: "Unsupported content type. Expected a multipart/form-data file upload.", code: "IMPORT_VALIDATION_ERROR" }, { status: 415 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ ok: false, error: "Could not read the uploaded file. Please try again.", code: "IMPORT_VALIDATION_ERROR" }, { status: 400 });
    }

    const file = form.get("file") as File | null;
    const mappingRaw = String(form.get("mapping") ?? "{}");
    const forceNewAnalysis = form.get("forceNewAnalysis") === "1";
    const preview = form.get("preview") === "1";
    const kindRaw = String(form.get("kind") ?? "COMMUNITY_MEMBERS");
    if (!IMPORT_KINDS.includes(kindRaw as ImportKind)) {
      throw new ImportError("IMPORT_VALIDATION_ERROR", "Unrecognized import kind.");
    }
    const importKind = kindRaw as ImportKind;

    await authorizeImportKind(importKind, organizationId, can);

    if (!file) {
      throw new ImportError("IMPORT_VALIDATION_ERROR", "No file uploaded.");
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ ok: false, error: "File too large (max 50 MB)", code: "IMPORT_VALIDATION_ERROR" }, { status: 413 });
    }

    // Security Patch A -- lets the upload form get headers/a preview for
    // its column-mapping step through the same hardened server-side
    // parser used for the real import, instead of parsing the file with a
    // library in the user's browser at all (mirrors the existing preview
    // convention on /api/import). Nothing is stored or persisted for a
    // preview request.
    if (preview) {
      const previewExt = file.name.toLowerCase().split(".").pop() ?? "";
      try {
        const previewBuffer = Buffer.from(await file.arrayBuffer());
        const { rows } = await parseUploadedSpreadsheet(previewBuffer, previewExt, organizationId);
        return Response.json({ ok: true, data: { headers: Object.keys(rows[0]), preview: rows.slice(0, 5), totalRows: rows.length } });
      } catch (error) {
        if (error instanceof ParseAdmissionDeniedError) {
          return Response.json(
            { ok: false, error: error.message, retryAfterSeconds: error.retryAfterSeconds },
            { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
          );
        }
        if (error instanceof SpreadsheetValidationError) {
          throw new ImportError("IMPORT_VALIDATION_ERROR", error.message);
        }
        throw error;
      }
    }

    let columnMapping: Record<string, string>;
    try {
      columnMapping = JSON.parse(mappingRaw);
    } catch {
      throw new ImportError("IMPORT_INVALID_MAPPING", "Column mapping must be valid JSON.");
    }
    validateMapping(importKind, new Set(Object.values(columnMapping)));

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = hashFileBuffer(buffer);

    if (!forceNewAnalysis) {
      const existing = await findExistingBatchByHash(organizationId, importKind, fileHash);
      if (existing) {
        return Response.json({ ok: true, data: { matchedExistingBatch: existing } }, { status: 200 });
      }
    }

    const batch = await prisma.importBatch.create({
      data: {
        organizationId,
        importKind,
        fileName: file.name,
        fileHash,
        fileSizeBytes: buffer.byteLength,
        columnMapping,
        uploadedByUserId: session.userId,
      },
    });

    const objectKey = buildImportSourceObjectKey(organizationId, batch.id, file.type || "text/csv");
    await uploadImportSourceFile({ key: objectKey, buffer, contentType: file.type || "text/csv" });
    const retentionExpiresAt = computeImportRetentionDate(batch.uploadedAt);

    const updated = await prisma.importBatch.update({
      where: { id: batch.id },
      data: { storageObjectKey: objectKey, retentionExpiresAt },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "import_batch.create",
      entityType: "import_batch",
      entityId: batch.id,
      metadata: { importKind, fileName: file.name, fileSizeBytes: buffer.byteLength },
    });

    // Immediate first analysis pass so the administrator isn't staring at
    // "Uploaded" for up to a minute waiting on the next cron tick — the
    // cron worker (src/app/api/cron/imports/route.ts) remains the mechanism
    // that resumes/retries this if it was interrupted (crash, timeout).
    await analyzeBatch(updated.id, organizationId).catch(() => null);

    return Response.json({ ok: true, data: { batchId: updated.id } }, { status: 201 });
  });
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("imports:read", "throw");

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");

    const batches = await prisma.importBatch.findMany({
      where: { organizationId, ...(statusFilter ? { status: statusFilter as never } : {}) },
      orderBy: { uploadedAt: "desc" },
      take: 100,
      select: {
        id: true,
        importKind: true,
        fileName: true,
        status: true,
        totalRows: true,
        newCount: true,
        duplicateCount: true,
        updateCount: true,
        invalidCount: true,
        importedCount: true,
        skippedCount: true,
        blockedPlanLimitCount: true,
        uploadedAt: true,
        completedAt: true,
        retentionExpiresAt: true,
      },
    });

    return Response.json({ ok: true, data: batches });
  });
}

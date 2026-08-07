import type { ImportKind } from "@prisma/client";
import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission, ForbiddenError } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hashFileBuffer, findExistingBatchByHash } from "@/lib/imports/file-identity";
import { buildImportSourceObjectKey, computeImportRetentionDate, uploadImportSourceFile } from "@/lib/imports/storage";
import { analyzeBatch } from "@/lib/imports/engine";
import { ImportError } from "@/lib/imports/errors";
import { requirePtaVertical } from "@/lib/labs/pta/guard";
import { requireHoaCapability } from "@/lib/hoa/guard";
import { PERMISSIONS, type Permission } from "@/lib/rbac";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — same cap as the existing /api/import

const VALID_KINDS: ImportKind[] = ["COMMUNITY_MEMBERS", "PTA_HOUSEHOLDS", "HOA_PROPERTIES"];

/**
 * Every kind requires both the generic imports:create permission AND a
 * domain-specific write permission — "can create an import batch" and "can
 * write [members/households/properties]" are logically separate
 * authorities, mirroring the existing /api/import route's per-type dual-gate
 * shape. PTA/HOA additionally require the same vertical-capability check
 * (Organization.primaryVertical) requirePtaAccess()/requireHoaPropertyWrite()
 * already enforce elsewhere — an org whose STAFF role happens to hold
 * pta:households:manage still can't import PTA households unless the org
 * actually IS a PTA organization.
 */
async function authorizeImportKind(
  importKind: ImportKind,
  organizationId: string,
  can: (permission: Permission) => boolean
): Promise<void> {
  if (importKind === "PTA_HOUSEHOLDS") {
    await requirePtaVertical(organizationId);
    if (!can(PERMISSIONS.PTA_HOUSEHOLDS_MANAGE)) {
      throw new ForbiddenError("Permission denied: pta:households:manage is required to import PTA households.");
    }
    return;
  }
  if (importKind === "HOA_PROPERTIES") {
    await requireHoaCapability(organizationId);
    if (!can(PERMISSIONS.HOA_PROPERTIES_WRITE) || !can(PERMISSIONS.HOA_RESIDENTS_WRITE)) {
      throw new ForbiddenError("Permission denied: hoa:properties:write and hoa:residents:write are required to import HOA properties.");
    }
    return;
  }
  if (!can("members:write")) {
    throw new ForbiddenError("Permission denied: members:write is required to import Community members.");
  }
}

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

    const form = await request.formData();
    const file = form.get("file") as File | null;
    const mappingRaw = String(form.get("mapping") ?? "{}");
    const forceNewAnalysis = form.get("forceNewAnalysis") === "1";
    const kindRaw = String(form.get("kind") ?? "COMMUNITY_MEMBERS");
    if (!VALID_KINDS.includes(kindRaw as ImportKind)) {
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

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { ImportKind } from "@prisma/client";

/**
 * Resumable Import Program (PR A) — the first genuine file-hashing code in
 * this codebase (no prior art existed anywhere near an import path). sha256
 * of the raw uploaded bytes, hex-encoded — stored on ImportBatch.fileHash
 * and (for the same "you already uploaded this" check) PaymentImportBatch.fileHash.
 */
export function hashFileBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface ExistingBatchMatch {
  batchId: string;
  status: string;
  totalRows: number;
  importedCount: number;
  uploadedAt: Date;
}

/**
 * The "This file appears to match an earlier import" lookup (Phase 3/Core
 * product rules). Scoped to organizationId + importKind — a hash match in a
 * different organization must never be revealed (would leak that another
 * tenant uploaded byte-identical data). Returns the most recent match only;
 * an administrator who already ran several analyses on the same file only
 * needs to know about the latest one to decide whether to resume it.
 */
export async function findExistingBatchByHash(
  organizationId: string,
  importKind: ImportKind,
  fileHash: string
): Promise<ExistingBatchMatch | null> {
  const match = await prisma.importBatch.findFirst({
    where: { organizationId, importKind, fileHash },
    orderBy: { uploadedAt: "desc" },
    select: { id: true, status: true, totalRows: true, importedCount: true, uploadedAt: true },
  });
  if (!match) return null;
  return {
    batchId: match.id,
    status: match.status,
    totalRows: match.totalRows,
    importedCount: match.importedCount,
    uploadedAt: match.uploadedAt,
  };
}

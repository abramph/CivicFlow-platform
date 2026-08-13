import type { GovernanceDocumentStatus, GovernanceDocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { buildSafeObjectKey, getSignedObjectUrl, uploadBufferToSpaces } from "@/lib/storage";
import { maxAttachmentBytes } from "@/lib/attachments";

/**
 * PTA Vertical 2.0, PR PTA-D — the Governance Library (see
 * docs/pta-vertical-2.md §10). Core module: bylaws, standing rules,
 * policies, resolutions — versioned and permanent. The invariants this
 * module owns:
 *
 *  - Versions of one document share a group (v1's id is the group key;
 *    later versions carry rootDocumentId = that id).
 *  - Marking a version CURRENT transactionally supersedes the group's
 *    previous CURRENT rows.
 *  - Nothing here deletes anything, ever — SUPERSEDED/ARCHIVED rows are the
 *    amendment history.
 */

export class GovernanceDocumentError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GovernanceDocumentError";
    this.status = status;
  }
}

export const GOVERNANCE_DOC_TYPES: GovernanceDocumentType[] = [
  "BYLAWS",
  "STANDING_RULES",
  "POLICY",
  "PROCEDURE",
  "CONFLICT_OF_INTEREST",
  "FINANCIAL_PROCEDURES",
  "ELECTION_RULES",
  "CODE_OF_CONDUCT",
  "RESOLUTION",
  "OTHER",
];

function groupKeyOf(document: { id: string; rootDocumentId: string | null }): string {
  return document.rootDocumentId ?? document.id;
}

/** All versions, newest first, grouped by document — the library view. */
export async function listGovernanceDocuments(organizationId: string) {
  const rows = await prisma.governanceDocument.findMany({
    where: { organizationId },
    orderBy: [{ docType: "asc" }, { title: "asc" }, { version: "desc" }],
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((versions) => ({
    groupId: groupKeyOf(versions[0]),
    docType: versions[0].docType,
    title: versions[0].title,
    current: versions.find((version) => version.status === "CURRENT") ?? null,
    latest: versions[0],
    versions,
  }));
}

export interface CreateGovernanceDocumentInput {
  organizationId: string;
  title: string;
  docType: GovernanceDocumentType;
  /** New version of an existing document group; omitted for a brand-new document. */
  rootDocumentId?: string | null;
  effectiveDate?: Date | null;
  approvedDate?: Date | null;
  reviewDate?: Date | null;
  notes?: string | null;
  file?: { fileName: string; contentType: string; buffer: Buffer } | null;
  makeCurrent?: boolean;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function createGovernanceDocument(input: CreateGovernanceDocumentInput) {
  const title = input.title.trim();
  if (!title) throw new GovernanceDocumentError("Document title is required.");
  if (input.file && input.file.buffer.length > maxAttachmentBytes) {
    throw new GovernanceDocumentError("File exceeds the 15 MB limit.");
  }

  let version = 1;
  let rootDocumentId: string | null = null;
  if (input.rootDocumentId) {
    const root = await prisma.governanceDocument.findFirst({
      where: { id: input.rootDocumentId, organizationId: input.organizationId, rootDocumentId: null },
    });
    if (!root) throw new GovernanceDocumentError("Document to amend not found.", 404);
    const latest = await prisma.governanceDocument.findFirst({
      where: { organizationId: input.organizationId, OR: [{ id: root.id }, { rootDocumentId: root.id }] },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    version = (latest?.version ?? 1) + 1;
    rootDocumentId = root.id;
  }

  let storage: { objectKey: string; fileName: string; contentType: string; byteSize: number } | null = null;
  if (input.file) {
    const key = buildSafeObjectKey(`governance/${input.organizationId}`, input.file.fileName);
    await uploadBufferToSpaces({ key, buffer: input.file.buffer, contentType: input.file.contentType });
    storage = { objectKey: key, fileName: input.file.fileName, contentType: input.file.contentType, byteSize: input.file.buffer.length };
  }

  const document = await prisma.governanceDocument.create({
    data: {
      organizationId: input.organizationId,
      rootDocumentId,
      title,
      docType: input.docType,
      version,
      effectiveDate: input.effectiveDate ?? null,
      approvedDate: input.approvedDate ?? null,
      reviewDate: input.reviewDate ?? null,
      notes: input.notes ?? null,
      fileName: storage?.fileName ?? null,
      contentType: storage?.contentType ?? null,
      byteSize: storage?.byteSize ?? null,
      objectKey: storage?.objectKey ?? null,
      uploadedByUserId: input.actorUserId,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: rootDocumentId ? "governance.document_version_added" : "governance.document_created",
    entityType: "governance_document",
    entityId: document.id,
    metadata: { title, docType: input.docType, version },
  });

  if (input.makeCurrent) {
    return setGovernanceDocumentStatus({
      organizationId: input.organizationId,
      documentId: document.id,
      status: "CURRENT",
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
    });
  }
  return document;
}

export async function setGovernanceDocumentStatus(input: {
  organizationId: string;
  documentId: string;
  status: GovernanceDocumentStatus;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const document = await prisma.governanceDocument.findFirst({
    where: { id: input.documentId, organizationId: input.organizationId },
  });
  if (!document) throw new GovernanceDocumentError("Document not found.", 404);
  if (input.status === "SUPERSEDED") {
    throw new GovernanceDocumentError("SUPERSEDED is set automatically when another version becomes current.");
  }
  if (document.status === input.status) return document;

  const groupKey = groupKeyOf(document);
  const updated = await prisma.$transaction(async (tx) => {
    if (input.status === "CURRENT") {
      await tx.governanceDocument.updateMany({
        where: {
          organizationId: input.organizationId,
          status: "CURRENT",
          id: { not: document.id },
          OR: [{ id: groupKey }, { rootDocumentId: groupKey }],
        },
        data: { status: "SUPERSEDED" },
      });
    }
    return tx.governanceDocument.update({ where: { id: document.id }, data: { status: input.status } });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "governance.document_status_changed",
    entityType: "governance_document",
    entityId: document.id,
    metadata: { title: document.title, before: document.status, after: input.status },
  });
  return updated;
}

/** Short-lived signed URL for the stored file — the only way governance files
 * are ever served. Download access is audited by the calling route. */
export async function getGovernanceDocumentDownloadUrl(organizationId: string, documentId: string) {
  const document = await prisma.governanceDocument.findFirst({
    where: { id: documentId, organizationId },
  });
  if (!document) throw new GovernanceDocumentError("Document not found.", 404);
  if (!document.objectKey) throw new GovernanceDocumentError("This document has no file attached.");
  const url = await getSignedObjectUrl(document.objectKey);
  return { document, url };
}

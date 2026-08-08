import type { ContributionReceipt } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { generateAndStoreReceiptPdf } from "@/lib/receipt";
import { getSignedObjectUrl } from "@/lib/storage";
import { sendReceiptEmail } from "@/lib/mail";
import { z } from "@/lib/validation";

/**
 * Shared "generate a receipt for a contribution" logic — used by the web
 * /api/receipts route and the mobile admin equivalent. Receipt generation
 * is manually triggered (never automatic on contribution create), and is
 * idempotent per contributionId — a second call for the same contribution
 * returns the existing receipt rather than creating a duplicate, including
 * under a concurrent-request race (P2002 retry).
 */

export const createReceiptSchema = z.object({
  contributionId: z.string().min(1),
  memberId: z.string().min(1).optional(),
  deliveryStatus: z.enum(["NOT_SENT", "SENT", "FAILED"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;

export interface ReceiptMutationActor {
  userId: string;
  userEmail?: string | null;
}

export type CreateReceiptResult =
  | { ok: true; data: ContributionReceipt; existing?: true }
  | { ok: false; status: number; error: string };

function shortRandom() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const byte of bytes) {
    value += alphabet[byte % alphabet.length];
  }
  return value;
}

async function generateReceiptNumber(organizationId: string) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const receiptNumber = `CF-${day}-${shortRandom()}`;
    const existing = await prisma.contributionReceipt.findFirst({ where: { organizationId, receiptNumber }, select: { id: true } });
    if (!existing) return receiptNumber;
  }
  throw new Error("Unable to generate a unique receipt number. Please try again.");
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function createReceiptWithRetry(input: {
  organizationId: string;
  contributionId: string;
  memberId?: string | null;
  deliveryStatus: "NOT_SENT" | "SENT" | "FAILED";
  metadata?: Prisma.InputJsonValue;
}): Promise<ContributionReceipt> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await prisma.contributionReceipt.create({
        data: {
          organizationId: input.organizationId,
          contributionId: input.contributionId,
          memberId: input.memberId,
          receiptNumber: await generateReceiptNumber(input.organizationId),
          deliveryStatus: input.deliveryStatus,
          metadata: input.metadata,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existingForContribution = await prisma.contributionReceipt.findFirst({
        where: { organizationId: input.organizationId, contributionId: input.contributionId },
      });
      if (existingForContribution) return existingForContribution;
    }
  }
  throw new Error("Unable to create a unique receipt number. Please try again.");
}

export async function createReceiptForContribution(
  organizationId: string,
  actor: ReceiptMutationActor,
  input: CreateReceiptInput
): Promise<CreateReceiptResult> {
  const contribution = await prisma.contribution.findFirst({ where: { id: input.contributionId, organizationId } });
  if (!contribution) return { ok: false, status: 404, error: "Contribution not found in organization" };

  if (input.memberId) {
    const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId } });
    if (!member) return { ok: false, status: 404, error: "Member not found in organization" };
  }

  const existingReceipt = await prisma.contributionReceipt.findFirst({
    where: { organizationId, contributionId: input.contributionId },
  });
  if (existingReceipt) return { ok: true, data: existingReceipt, existing: true };

  let row: ContributionReceipt;
  try {
    row = await createReceiptWithRetry({
      organizationId,
      contributionId: input.contributionId,
      memberId: input.memberId ?? contribution.memberId,
      deliveryStatus: input.deliveryStatus ?? "NOT_SENT",
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existingForContribution = await prisma.contributionReceipt.findFirst({
        where: { organizationId, contributionId: input.contributionId },
      });
      if (existingForContribution) return { ok: true, data: existingForContribution, existing: true };
      return { ok: false, status: 409, error: "A receipt number collision occurred. Please try again." };
    }
    throw error;
  }

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "receipt",
    entityType: "contribution_receipt",
    entityId: row.id,
    metadata: { contributionId: row.contributionId, receiptNumber: row.receiptNumber, deliveryStatus: row.deliveryStatus },
  });

  const generated = await generateAndStoreReceiptPdf({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? undefined,
    receiptId: row.id,
  });

  if (generated.receipt.memberId) {
    const member = await prisma.orgMember.findFirst({ where: { id: generated.receipt.memberId, organizationId } });
    if (member?.email) {
      const metadataObj =
        generated.receipt.metadata && typeof generated.receipt.metadata === "object"
          ? (generated.receipt.metadata as Record<string, unknown>)
          : {};
      const maybeKey = metadataObj.fileKey;
      const downloadUrl = typeof maybeKey === "string" ? await getSignedObjectUrl(maybeKey) : undefined;

      await sendReceiptEmail({
        to: member.email,
        receiptNumber: generated.receipt.receiptNumber,
        amount: contribution.amount.toString(),
        date: contribution.contributionDate.toISOString().slice(0, 10),
        downloadUrl,
      });
    }
  }

  return { ok: true, data: generated.receipt };
}

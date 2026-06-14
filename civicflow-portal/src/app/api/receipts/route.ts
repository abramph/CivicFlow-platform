import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { Prisma, type ContributionReceipt } from "@prisma/client";
import { requireRateLimit } from "@/lib/rate-limit";
import { generateAndStoreReceiptPdf } from "@/lib/receipt";
import { getSignedObjectUrl } from "@/lib/storage";
import { sendReceiptEmail } from "@/lib/mail";

const createReceiptSchema = z.object({
  contributionId: z.string().min(1),
  memberId: z.string().min(1).optional(),
  receiptNumber: z.string().min(1).max(100).optional(),
  deliveryStatus: z.enum(["NOT_SENT", "SENT", "FAILED"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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
    const existing = await prisma.contributionReceipt.findFirst({
      where: { organizationId, receiptNumber },
      select: { id: true },
    });
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
        where: {
          organizationId: input.organizationId,
          contributionId: input.contributionId,
        },
      });
      if (existingForContribution) return existingForContribution;
    }
  }

  throw new Error("Unable to create a unique receipt number. Please try again.");
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("receipts:read", "throw");

    const rows = await prisma.contributionReceipt.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }],
      include: { contribution: true, member: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "receipt",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:receipts:write",
      request,
      limit: 40,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("receipts:write", "throw");
    const input = await parseJsonBody(request, createReceiptSchema);

    const contribution = await prisma.contribution.findFirst({
      where: { id: input.contributionId, organizationId },
    });
    if (!contribution) {
      return Response.json({ ok: false, error: "Contribution not found in organization" }, { status: 404 });
    }

    if (input.memberId) {
      const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId } });
      if (!member) {
        return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
      }
    }

    const existingReceipt = await prisma.contributionReceipt.findFirst({
      where: {
        organizationId,
        contributionId: input.contributionId,
      },
    });

    if (existingReceipt) {
      return Response.json({ ok: true, data: existingReceipt, existing: true }, { status: 200 });
    }

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
        if (existingForContribution) {
          return Response.json({ ok: true, data: existingForContribution, existing: true }, { status: 200 });
        }
        return Response.json(
          { ok: false, error: "A receipt number collision occurred. Please try again." },
          { status: 409 }
        );
      }
      throw error;
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "receipt",
      entityType: "contribution_receipt",
      entityId: row.id,
      metadata: {
        contributionId: row.contributionId,
        receiptNumber: row.receiptNumber,
        deliveryStatus: row.deliveryStatus,
      },
    });

    const generated = await generateAndStoreReceiptPdf({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      receiptId: row.id,
    });

    if (generated.receipt.memberId) {
      const member = await prisma.orgMember.findFirst({
        where: { id: generated.receipt.memberId, organizationId },
      });

      if (member?.email) {
        const metadataObj =
          generated.receipt.metadata && typeof generated.receipt.metadata === "object"
            ? (generated.receipt.metadata as Record<string, unknown>)
            : {};
        const maybeKey = metadataObj.fileKey;

        const downloadUrl =
          typeof maybeKey === "string" ? await getSignedObjectUrl(maybeKey) : undefined;

        await sendReceiptEmail({
          to: member.email,
          receiptNumber: generated.receipt.receiptNumber,
          amount: contribution.amount.toString(),
          date: contribution.contributionDate.toISOString().slice(0, 10),
          downloadUrl,
        });
      }
    }

    return Response.json({ ok: true, data: generated.receipt }, { status: 201 });
  });
}

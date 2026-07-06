import { prisma } from "@/lib/prisma";
import type { PaymentLinkType } from "@prisma/client";

/** Finds a still-usable (active, non-expired) payment link matching the given scope. */
export async function findActivePaymentLink(where: {
  organizationId: string;
  campaignId?: string;
  eventId?: string;
  linkType?: PaymentLinkType;
}) {
  const link = await prisma.paymentLink.findFirst({
    where: { ...where, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!link) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;
  return link;
}

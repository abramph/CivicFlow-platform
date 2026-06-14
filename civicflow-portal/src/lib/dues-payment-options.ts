import { ensureDefaultPaymentMethods } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";

export async function getDuesPaymentFormOptions(organizationId: string) {
  await ensureDefaultPaymentMethods(prisma, organizationId);

  const [members, charges, accounts, paymentMethods] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, preferredName: true },
      take: 300,
    }),
    prisma.duesCharge.findMany({
      where: { organizationId, status: { in: ["PENDING", "PARTIAL"] } },
      orderBy: [{ dueDate: "asc" }],
      include: { duesAccount: true },
      take: 300,
    }),
    prisma.duesAccount.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, memberId: true, amountDefault: true, frequency: true },
      take: 300,
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, method: true, label: true, instructions: true },
    }),
  ]);

  return {
    members,
    charges: charges.map((charge) => ({
      id: charge.id,
      memberId: charge.memberId,
      duesAccountId: charge.duesAccountId,
      dueDate: charge.dueDate.toISOString(),
      status: charge.status,
      amountDue: charge.amountDue.toString(),
      amountPaid: charge.amountPaid.toString(),
      accountName: charge.duesAccount.name,
    })),
    accounts: accounts.map((account) => ({
      ...account,
      amountDefault: account.amountDefault?.toString() ?? null,
    })),
    paymentMethods,
  };
}


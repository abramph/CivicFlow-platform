import type { DuesPaymentMethod, PrismaClient } from "@prisma/client";

export const defaultPaymentMethods: Array<{
  method: DuesPaymentMethod;
  label: string;
  sortOrder: number;
}> = [
  { method: "CASH", label: "Cash", sortOrder: 10 },
  { method: "CHECK", label: "Check", sortOrder: 20 },
  { method: "CREDIT_CARD", label: "Credit Card", sortOrder: 30 },
  { method: "DEBIT_CARD", label: "Debit Card", sortOrder: 40 },
  { method: "ACH", label: "ACH", sortOrder: 50 },
  { method: "ZELLE", label: "Zelle", sortOrder: 60 },
  { method: "CASH_APP", label: "Cash App", sortOrder: 70 },
  { method: "VENMO", label: "Venmo", sortOrder: 80 },
  { method: "PAYPAL", label: "PayPal", sortOrder: 90 },
  { method: "STRIPE", label: "Stripe", sortOrder: 100 },
  { method: "OTHER", label: "Other", sortOrder: 110 },
];

export const legacyPaymentMethods: Array<{
  method: DuesPaymentMethod;
  label: string;
  sortOrder: number;
}> = [{ method: "CARD", label: "Card", sortOrder: 35 }];

export const paymentMethodLabels = new Map<DuesPaymentMethod, string>(
  [...defaultPaymentMethods, ...legacyPaymentMethods].map((method) => [
    method.method,
    method.label,
  ])
);

export async function ensureDefaultPaymentMethods(
  prisma: PrismaClient,
  organizationId: string
) {
  await prisma.$transaction(
    defaultPaymentMethods.map((method) =>
      prisma.paymentMethodConfig.upsert({
        where: {
          organizationId_method: {
            organizationId,
            method: method.method,
          },
        },
        update: {},
        create: {
          organizationId,
          method: method.method,
          label: method.label,
          sortOrder: method.sortOrder,
          isActive: true,
        },
      })
    )
  );
}


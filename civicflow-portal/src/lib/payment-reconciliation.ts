import type { PaymentImportSourceType, Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { prisma } from "@/lib/prisma";
import { isValidEmail } from "@/lib/email";

const methodBySource: Partial<Record<PaymentImportSourceType, string>> = {
  ZELLE: "ZELLE",
  CASH_APP: "CASH_APP",
  VENMO: "VENMO",
  PAYPAL: "PAYPAL",
  STRIPE: "STRIPE",
  BANK: "ACH",
  MANUAL_CSV: "OTHER",
  PAYROLL_CHECKOFF: "PAYROLL_CHECKOFF",
  OTHER: "OTHER",
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhone(value: string | null | undefined) {
  return clean(value).replace(/\D/g, "");
}

function splitCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((item) => item.trim());
}

function findValue(row: Record<string, string>, names: string[]) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value]));
  for (const name of names) {
    const value = normalized[name.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (value) return value;
  }
  return "";
}

export function parsePaymentCsv(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export async function matchPaymentImportItem(organizationId: string, input: {
  payerEmail?: string | null;
  payerPhone?: string | null;
  payerName?: string | null;
  memo?: string | null;
}) {
  // Malformed input here never matches a real member anyway (every real
  // OrgMember.email is itself well-formed), but validating explicitly avoids
  // running a lookup query keyed on obvious garbage and keeps this file
  // consistent with every other importer's use of the same shared check.
  const payerEmailRaw = clean(input.payerEmail).toLowerCase();
  const payerEmail = isValidEmail(payerEmailRaw) ? payerEmailRaw : "";
  if (payerEmail) {
    const member = await prisma.orgMember.findFirst({
      where: { organizationId, email: { equals: payerEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (member) return { memberId: member.id, confidence: 95 };
  }

  const payerPhone = normalizePhone(input.payerPhone);
  if (payerPhone) {
    const members = await prisma.orgMember.findMany({
      where: { organizationId, phone: { not: null } },
      select: { id: true, phone: true },
      take: 1000,
    });
    const member = members.find((row) => normalizePhone(row.phone) === payerPhone);
    if (member) return { memberId: member.id, confidence: 90 };
  }

  const text = `${clean(input.payerName)} ${clean(input.memo)}`.toLowerCase();
  if (text) {
    const members = await prisma.orgMember.findMany({
      where: { organizationId },
      select: { id: true, firstName: true, lastName: true, preferredName: true },
      take: 2000,
    });
    const member = members.find((row) => {
      const full = `${row.firstName} ${row.lastName}`.toLowerCase();
      const preferred = `${row.preferredName ?? row.firstName} ${row.lastName}`.toLowerCase();
      return text.includes(full) || text.includes(preferred);
    });
    if (member) return { memberId: member.id, confidence: 70 };
  }

  return { memberId: null, confidence: 0 };
}

export async function buildPaymentImportItemData(organizationId: string, sourceType: PaymentImportSourceType, row: Record<string, string>) {
  const payerName = findValue(row, ["payer name", "name", "customer", "sender", "from"]);
  const payerEmail = findValue(row, ["payer email", "email", "sender email"]);
  const payerPhone = findValue(row, ["payer phone", "phone", "sender phone"]);
  const memo = findValue(row, ["memo", "description", "note", "notes", "message"]);
  const externalTransactionId = findValue(row, ["transaction id", "transaction", "id", "reference", "confirmation"]);
  const amountText = findValue(row, ["amount", "gross", "net", "total"]).replace(/[$,]/g, "");
  const dateText = findValue(row, ["date", "transaction date", "created", "paid at"]);
  const match = await matchPaymentImportItem(organizationId, { payerName, payerEmail, payerPhone, memo });

  return {
    sourceType,
    externalTransactionId: externalTransactionId || null,
    transactionDate: dateText ? new Date(dateText) : new Date(),
    payerName: payerName || null,
    payerEmail: payerEmail || null,
    payerPhone: payerPhone || null,
    amount: Number(amountText || 0),
    memo: memo || null,
    rawData: row as Prisma.InputJsonValue,
    matchedMemberId: match.memberId,
    matchConfidence: match.confidence,
  };
}

export async function postPaymentImportItem(input: {
  organizationId: string;
  itemId: string;
  postedAs: "DUES_PAYMENT" | "CONTRIBUTION";
  actorUserId?: string | null;
  actorEmail?: string | null;
  memberId?: string | null;
  duesChargeId?: string | null;
  campaignId?: string | null;
  eventId?: string | null;
  receiptRequested?: boolean;
}) {
  const item = await prisma.paymentImportItem.findFirst({
    where: { id: input.itemId, organizationId: input.organizationId },
  });
  if (!item) throw new Error("Import item not found");
  if (item.verificationStatus === "POSTED" || item.postedAs) throw new Error("Import item has already been posted");
  if (item.verificationStatus !== "VERIFIED") throw new Error("Only verified items can be posted");
  const memberId = input.memberId || item.matchedMemberId;
  if (!memberId) throw new Error("Select a member before posting");

  const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId: input.organizationId } });
  if (!member) throw new Error("Member not found in organization");

  if (input.postedAs === "DUES_PAYMENT") {
    const charge = input.duesChargeId
      ? await prisma.duesCharge.findFirst({ where: { id: input.duesChargeId, organizationId: input.organizationId, memberId } })
      : null;
    const method = (methodBySource[item.sourceType] ?? "OTHER") as "ZELLE" | "CASH_APP" | "VENMO" | "PAYPAL" | "STRIPE" | "ACH" | "PAYROLL_CHECKOFF" | "OTHER";
    const payment = await prisma.$transaction(async (tx) => {
      const row = await tx.duesPayment.create({
        data: {
          organizationId: input.organizationId,
          memberId,
          duesChargeId: charge?.id ?? null,
          duesAccountId: charge?.duesAccountId ?? null,
          amount: item.amount,
          paymentDate: item.transactionDate,
          method,
          reference: item.externalTransactionId,
          notes: item.memo,
        },
      });
      if (charge) {
        const nextAmountPaid = Number(charge.amountPaid) + Number(item.amount);
        await tx.duesCharge.update({
          where: { id: charge.id },
          data: { amountPaid: nextAmountPaid, status: nextAmountPaid >= Number(charge.amountDue) ? "PAID" : "PARTIAL" },
        });
      }
      await tx.paymentImportItem.update({
        where: { id: item.id },
        data: { verificationStatus: "POSTED", postedAs: "DUES_PAYMENT", postedDuesPaymentId: row.id, matchedMemberId: memberId, matchedDuesChargeId: charge?.id ?? item.matchedDuesChargeId, reviewedByUserId: input.actorUserId ?? null, reviewedAt: new Date() },
      });
      return row;
    });
    await createMemberTimelineEvent({ organizationId: input.organizationId, memberId, eventType: "PAYMENT_RECORDED", title: "Electronic dues payment posted", newValue: { importItemId: item.id, duesPaymentId: payment.id, amount: payment.amount.toString() }, occurredAt: payment.paymentDate, createdByUserId: input.actorUserId });
    await createAuditEvent({ organizationId: input.organizationId, actorUserId: input.actorUserId, actorEmail: input.actorEmail, action: "payment_import.post_dues", entityType: "payment_import_item", entityId: item.id, metadata: { duesPaymentId: payment.id, memberId } });
    return { duesPayment: payment };
  }

  const contribution = await prisma.$transaction(async (tx) => {
    const row = await tx.contribution.create({
      data: {
        organizationId: input.organizationId,
        memberId,
        campaignId: input.campaignId || item.matchedCampaignId,
        eventId: input.eventId || item.matchedEventId,
        amount: item.amount,
        contributionDate: item.transactionDate,
        paymentMethod: (methodBySource[item.sourceType] ?? "OTHER") as "ZELLE" | "CASH_APP" | "VENMO" | "PAYPAL" | "STRIPE" | "ACH" | "PAYROLL_CHECKOFF" | "OTHER",
        source: "IMPORT",
        receiptRequested: input.receiptRequested ?? false,
        notes: item.memo,
        createdByUserId: input.actorUserId ?? null,
      },
    });
    await tx.paymentImportItem.update({
      where: { id: item.id },
      data: { verificationStatus: "POSTED", postedAs: "CONTRIBUTION", postedContributionId: row.id, matchedMemberId: memberId, matchedCampaignId: input.campaignId || item.matchedCampaignId, matchedEventId: input.eventId || item.matchedEventId, reviewedByUserId: input.actorUserId ?? null, reviewedAt: new Date() },
    });
    return row;
  });
  await createMemberTimelineEvent({ organizationId: input.organizationId, memberId, eventType: "CONTRIBUTION_RECORDED", title: "Electronic contribution posted", newValue: { importItemId: item.id, contributionId: contribution.id, amount: contribution.amount.toString() }, occurredAt: contribution.contributionDate, createdByUserId: input.actorUserId });
  await createAuditEvent({ organizationId: input.organizationId, actorUserId: input.actorUserId, actorEmail: input.actorEmail, action: "payment_import.post_contribution", entityType: "payment_import_item", entityId: item.id, metadata: { contributionId: contribution.id, memberId } });
  return { contribution };
}

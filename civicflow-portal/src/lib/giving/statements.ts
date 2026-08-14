import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { toWinAnsiSafe } from "@/lib/pdf-text";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-G — contribution statements (docs/core-contributions-giving.md
 * §7). A statement is an ISSUED ARTIFACT: the PDF is built once, stored,
 * and never altered (§94) — corrections issue version N+1 and mark the
 * prior SUPERSEDED. §31: the title is always "Contribution Statement";
 * wording stays neutral unless the organization configured classifications.
 */

export interface StatementSubject {
  memberId?: string | null;
  contributorUserId?: string | null;
}

function subjectWhere(subject: StatementSubject) {
  const clauses = [];
  if (subject.memberId) clauses.push({ memberId: subject.memberId });
  if (subject.contributorUserId) clauses.push({ contributorUserId: subject.contributorUserId });
  if (clauses.length === 0) throw new FinanceError("A statement needs a subject.");
  return { OR: clauses };
}

export async function collectStatementData(organizationId: string, subject: StatementSubject, year: number) {
  const periodStart = new Date(Date.UTC(year, 0, 1));
  const periodEnd = new Date(Date.UTC(year + 1, 0, 1));
  const rows = await prisma.contribution.findMany({
    where: {
      organizationId,
      ...subjectWhere(subject),
      voidedAt: null,
      statementEligible: true,
      contributionDate: { gte: periodStart, lt: periodEnd },
    },
    orderBy: { contributionDate: "asc" },
    select: {
      contributionNumber: true,
      contributionDate: true,
      amount: true,
      goodsServicesValue: true,
      taxDeductibilityClassification: true,
      notes: true,
      fund: { select: { name: true } },
      campaign: { select: { name: true } },
      contributionProgram: { select: { name: true, receiptLanguage: true } },
    },
  });
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return { periodStart, periodEnd, rows, total };
}

/** §31 footer: neutral unless the organization configured classifications. */
export function statementFooter(rows: { taxDeductibilityClassification: string }[]): string {
  const classifications = new Set(rows.map((row) => row.taxDeductibilityClassification));
  classifications.delete("DEDUCTIBILITY_NOT_CONFIGURED");
  if (classifications.size === 0) {
    return "This statement is a record of contributions received. Consult the organization regarding tax treatment of these contributions.";
  }
  if (classifications.has("NOT_DEDUCTIBLE") && classifications.size === 1) {
    return "The organization has indicated these contributions are not tax-deductible.";
  }
  return "The organization has classified some contributions as potentially tax-deductible. Where noted, the value of goods or services received reduces the potential contribution component. This statement is not tax advice; consult the organization and your tax advisor.";
}

async function buildStatementPdf(input: {
  organizationName: string;
  subjectName: string;
  year: number;
  rows: Awaited<ReturnType<typeof collectStatementData>>["rows"];
  total: number;
  version: number;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 792 - 48;

  function line(text: string, options: { size?: number; useBold?: boolean; gray?: boolean; x?: number } = {}) {
    const size = options.size ?? 10;
    const usedFont = options.useBold ? bold : font;
    if (y < 60) {
      page = pdf.addPage([612, 792]);
      y = 792 - 48;
    }
    page.drawText(toWinAnsiSafe(text), {
      x: options.x ?? 48,
      y,
      size,
      font: usedFont,
      color: options.gray ? rgb(0.35, 0.4, 0.47) : rgb(0.08, 0.11, 0.18),
    });
    y -= 15;
  }

  line(input.organizationName, { gray: true });
  y -= 4;
  line(`${input.year} Contribution Statement`, { size: 16, useBold: true });
  line(input.subjectName, { size: 12 });
  line(`Statement period: January 1, ${input.year} - December 31, ${input.year} · Version ${input.version}`, { gray: true });
  y -= 10;
  line("Date          Fund / Designation                          Amount", { useBold: true });
  for (const row of input.rows) {
    const designation = row.fund?.name ?? row.campaign?.name ?? "General";
    const date = row.contributionDate.toISOString().slice(0, 10);
    line(`${date}    ${designation.padEnd(40).slice(0, 40)}  $${Number(row.amount).toFixed(2)}`);
    if (row.goodsServicesValue !== null && Number(row.goodsServicesValue) > 0) {
      const goods = Number(row.goodsServicesValue);
      line(
        `              Amount received $${Number(row.amount).toFixed(2)} · Goods/services $${goods.toFixed(2)} · Potential contribution component $${(Number(row.amount) - goods).toFixed(2)}`,
        { gray: true, size: 8 }
      );
    }
  }
  y -= 6;
  line(`Total contributions reflected on statement: $${input.total.toFixed(2)}`, { useBold: true });
  y -= 10;
  line(statementFooter(input.rows), { gray: true, size: 8 });

  return pdf.save();
}

export interface GenerateStatementInput {
  organizationId: string;
  subject: StatementSubject;
  subjectName: string;
  year: number;
  reason?: string | null;
  generatedByUserId: string;
  generatedByEmail?: string | null;
}

/** Generates version N+1, stores the PDF, supersedes the prior GENERATED
 * version (§94), audits. */
export async function generateStatement(input: GenerateStatementInput) {
  await ensureContributionsEnabled(input.organizationId);
  const { periodStart, periodEnd, rows, total } = await collectStatementData(input.organizationId, input.subject, input.year);
  if (rows.length === 0) throw new FinanceError(`No statement-eligible contributions in ${input.year}.`, 404);

  const prior = await prisma.contributionStatement.findFirst({
    where: {
      organizationId: input.organizationId,
      year: input.year,
      status: "GENERATED",
      ...(input.subject.memberId ? { memberId: input.subject.memberId } : {}),
      ...(input.subject.contributorUserId && !input.subject.memberId
        ? { contributorUserId: input.subject.contributorUserId }
        : {}),
    },
    orderBy: { version: "desc" },
  });
  if (prior && !input.reason?.trim()) {
    throw new FinanceError("A reason is required to reissue an already-generated statement.", 409);
  }

  const organization = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
  const bytes = await buildStatementPdf({
    organizationName: organization?.name ?? "Organization",
    subjectName: input.subjectName,
    year: input.year,
    rows,
    total,
    version: (prior?.version ?? 0) + 1,
  });

  const { buildSafeObjectKey, uploadBufferToSpaces } = await import("@/lib/storage");
  const objectKey = buildSafeObjectKey(`statements/${input.organizationId}`, `statement-${input.year}-v${(prior?.version ?? 0) + 1}.pdf`);
  await uploadBufferToSpaces({ key: objectKey, buffer: Buffer.from(bytes), contentType: "application/pdf" });

  const statement = await prisma.contributionStatement.create({
    data: {
      organizationId: input.organizationId,
      memberId: input.subject.memberId ?? null,
      contributorUserId: input.subject.contributorUserId ?? null,
      year: input.year,
      periodStart,
      periodEnd,
      version: (prior?.version ?? 0) + 1,
      reason: input.reason?.trim() || null,
      totalAmount: new Prisma.Decimal(total.toFixed(2)),
      contributionCount: rows.length,
      objectKey,
      generatedByUserId: input.generatedByUserId,
    },
  });

  if (prior) {
    await prisma.contributionStatement.update({
      where: { id: prior.id },
      data: { status: "SUPERSEDED", supersededById: statement.id },
    });
  }

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.generatedByUserId,
    actorEmail: input.generatedByEmail ?? null,
    action: "giving.statement_generated",
    entityType: "contribution_statement",
    entityId: statement.id,
    metadata: { year: input.year, version: statement.version, total, reissue: Boolean(prior) },
  });
  return statement;
}

/** §96 pre-generation exception report — resolve these before bulk runs. */
export async function statementExceptions(organizationId: string, year: number) {
  const periodStart = new Date(Date.UTC(year, 0, 1));
  const periodEnd = new Date(Date.UTC(year + 1, 0, 1));
  const inYear = { organizationId, voidedAt: null as null, contributionDate: { gte: periodStart, lt: periodEnd } };

  const [unattributed, unassignedFund, duplicates] = await Promise.all([
    prisma.contribution.count({
      where: { ...inYear, statementEligible: true, memberId: null, contributorUserId: null, contributorName: null, anonymityMode: "NONE" },
    }),
    prisma.contribution.count({ where: { ...inYear, statementEligible: true, fundId: null, campaignId: null } }),
    prisma.contribution.groupBy({
      by: ["providerPaymentIntentId"],
      where: { ...inYear, providerPaymentIntentId: { not: null } },
      _count: true,
      having: { providerPaymentIntentId: { _count: { gt: 1 } } },
    }),
  ]);

  const exceptions: { kind: string; description: string; count: number }[] = [];
  if (unattributed > 0) {
    exceptions.push({
      kind: "unattributed",
      description: "Contribution(s) with no member, user, or name attribution and not marked anonymous.",
      count: unattributed,
    });
  }
  if (unassignedFund > 0) {
    exceptions.push({
      kind: "unassigned_designation",
      description: 'Contribution(s) with no fund or campaign designation — they will appear as "General".',
      count: unassignedFund,
    });
  }
  if (duplicates.length > 0) {
    exceptions.push({ kind: "duplicate_provider_reference", description: "Duplicate provider payment references.", count: duplicates.length });
  }
  return exceptions;
}

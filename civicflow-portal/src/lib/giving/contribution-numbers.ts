import { prisma } from "@/lib/prisma";

/**
 * CORE-GIVE-A — human-readable contribution references "CTR-2026-000001"
 * (§36): per-organization, per-year, allocated inside the caller's create
 * transaction with a P2002 retry (the Decision-Register/concern-case
 * pattern). NEVER an authorization identifier — routes always authorize on
 * the internal cuid.
 */

export function formatContributionNumber(year: number, sequence: number): string {
  return `CTR-${year}-${String(sequence).padStart(6, "0")}`;
}

export async function nextContributionNumber(
  tx: { contribution: { count: (args: object) => Promise<number> } },
  organizationId: string,
  year: number = new Date().getFullYear()
): Promise<string> {
  const countThisYear = await tx.contribution.count({
    where: { organizationId, contributionNumber: { startsWith: `CTR-${year}-` } },
  });
  return formatContributionNumber(year, countThisYear + 1);
}

/** Convenience wrapper for creators outside an existing transaction: runs
 * `create` with an allocated number, retrying on unique collision. */
export async function withContributionNumber<T>(
  organizationId: string,
  create: (contributionNumber: string) => Promise<T>
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await nextContributionNumber(prisma, organizationId);
    try {
      return await create(number);
    } catch (error) {
      const isUniqueViolation = typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
      if (!isUniqueViolation) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

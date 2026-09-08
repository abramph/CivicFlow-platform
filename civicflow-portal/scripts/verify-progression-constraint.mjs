/**
 * Database-backed proof of the PTA progression "one active batch per
 * transition" rule.
 *
 * The rule is a PostgreSQL PARTIAL unique index that Prisma's schema language
 * cannot express (see the comment on model PtaStudentProgressionBatch and
 * migration 20260904150000_pta_progression_active_transition_unique). A mocked
 * Prisma client in the unit suite can prove the SERVICE asks the right
 * question; only a real database can prove the CONSTRAINT answers it. This
 * script is what closes that gap, and the Migrations CI job runs it against
 * the same throwaway Postgres it uses for `migrate deploy`.
 *
 * It writes only into an organization it creates, and deletes it at the end.
 *
 *   DATABASE_URL=postgresql://... node scripts/verify-progression-constraint.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const SLUG = `b26-constraint-check-${process.pid}-${Date.now()}`;
let orgId = null;

/** Insert a batch directly, bypassing the service, so the DATABASE is what
 * accepts or rejects it. Returns the new id, or null if the index refused. */
async function insertBatch({ fromId, toId, status = "PREPARING", publicationStatus = "UNPUBLISHED" }) {
  const id = `b26_${Math.random().toString(36).slice(2, 12)}`;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PtaStudentProgressionBatch"
         ("id","organizationId","fromSchoolYearId","toSchoolYearId","status","publicationStatus","publicationVersion","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5::"PtaStudentProgressionBatchStatus",$6::"PtaProgressionPublicationStatus",0,NOW(),NOW())`,
      id, orgId, fromId, toId, status, publicationStatus
    );
    return id;
  } catch (err) {
    // 23505 = unique_violation. Prisma surfaces a raw-query failure as P2010
    // carrying the underlying SQLSTATE, and names the COLUMNS rather than the
    // index, so match on the transition triple to stay narrow.
    const sqlState = err?.meta?.code ?? "";
    const message = String(err?.meta?.message ?? err?.message ?? "");
    const isTransitionConflict =
      sqlState === "23505" &&
      (message.includes("active_transition") ||
        (message.includes("fromSchoolYearId") && message.includes("toSchoolYearId")));
    if (isTransitionConflict) return null;
    throw err;
  }
}

try {
  // ── 1. the constraint exists, and is the right shape ──────────────────
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'PtaStudentProgressionBatch'`
  );
  const partial = idx.find((r) => r.indexname === "PtaStudentProgressionBatch_active_transition_key");
  check("partial unique index exists", !!partial);
  check("it is UNIQUE", !!partial && /CREATE UNIQUE INDEX/i.test(partial.indexdef));
  check(
    "it is PARTIAL on status <> ROLLED_BACK",
    !!partial && /WHERE\s+\(?status\s*<>\s*'ROLLED_BACK'/i.test(partial.indexdef.replace(/"/g, ""))
  );
  check(
    "the old unconditional unique index is gone",
    !idx.some((r) => r.indexname === "PtaStudentProgressionBatch_organizationId_fromSchoolYearId__key")
  );
  if (!partial) throw new Error("no partial index — the remaining checks would be meaningless");

  // ── 2. fixtures ───────────────────────────────────────────────────────
  const org = await prisma.organization.create({
    data: { slug: SLUG, name: "Build 26 constraint check", primaryVertical: "PTA", plan: "elite" },
  });
  orgId = org.id;
  const [fromYear, toYear] = await Promise.all([
    prisma.ptaSchoolYear.create({ data: { organizationId: orgId, label: "2026-2027", isCurrent: true } }),
    prisma.ptaSchoolYear.create({ data: { organizationId: orgId, label: "2027-2028", isCurrent: false } }),
  ]);
  const pair = { fromId: fromYear.id, toId: toYear.id };

  // ── 3. every NON-rolled-back state still blocks a second attempt ──────
  // Directive tests 2-7: active, previewed, committed-unpublished, published,
  // corrected, and withdrawn-but-not-rolled-back.
  const blocking = [
    ["PREPARING", "UNPUBLISHED", "active (PREPARING)"],
    ["PREVIEWED", "UNPUBLISHED", "previewed"],
    ["COMMITTED", "UNPUBLISHED", "committed but unpublished"],
    ["COMMITTED", "PUBLISHED", "published"],
    ["CORRECTED", "UNPUBLISHED", "corrected"],
    ["COMMITTED", "WITHDRAWN", "withdrawn but NOT rolled back"],
  ];
  for (const [status, publicationStatus, label] of blocking) {
    const first = await insertBatch({ ...pair, status, publicationStatus });
    const second = await insertBatch({ ...pair, status: "PREPARING" });
    check(`${label} blocks a second attempt`, first !== null && second === null);
    await prisma.ptaStudentProgressionBatch.deleteMany({ where: { organizationId: orgId } });
  }

  // ── 4. a rolled-back attempt does NOT block a new one ─────────────────
  const attempt1 = await insertBatch({ ...pair, status: "COMMITTED", publicationStatus: "WITHDRAWN" });
  await prisma.ptaStudentProgressionBatch.update({
    where: { id: attempt1 },
    data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
  });
  const attempt2 = await insertBatch({ ...pair, status: "PREPARING" });
  check("a rolled-back attempt permits a new attempt", attempt2 !== null);
  check("the new attempt has a distinct id", attempt2 !== null && attempt2 !== attempt1);

  const kept = await prisma.ptaStudentProgressionBatch.findUnique({ where: { id: attempt1 } });
  check("the old attempt is still ROLLED_BACK", kept?.status === "ROLLED_BACK", kept?.status);
  check("the old attempt keeps its rollback timestamp", !!kept?.rolledBackAt);
  check("the old attempt keeps its publication history", kept?.publicationStatus === "WITHDRAWN", kept?.publicationStatus);
  const fresh = await prisma.ptaStudentProgressionBatch.findUnique({ where: { id: attempt2 } });
  check("the new attempt starts UNPUBLISHED", fresh?.publicationStatus === "UNPUBLISHED", fresh?.publicationStatus);

  // ── 5. the new attempt is now the only thing blocking ─────────────────
  check("a third attempt is refused while attempt two is active", (await insertBatch({ ...pair, status: "PREPARING" })) === null);

  // ── 6. many historical rolled-back attempts may coexist ───────────────
  await prisma.ptaStudentProgressionBatch.update({ where: { id: attempt2 }, data: { status: "ROLLED_BACK" } });
  const attempt3 = await insertBatch({ ...pair, status: "PREPARING" });
  await prisma.ptaStudentProgressionBatch.update({ where: { id: attempt3 }, data: { status: "ROLLED_BACK" } });
  const attempt4 = await insertBatch({ ...pair, status: "PREPARING" });
  const rolledBack = await prisma.ptaStudentProgressionBatch.count({
    where: { organizationId: orgId, status: "ROLLED_BACK" },
  });
  check("three rolled-back attempts coexist", rolledBack === 3, `count=${rolledBack}`);
  check("plus exactly one active attempt", attempt4 !== null);

  // ── 7. history is queryable and deterministically ordered ─────────────
  const history = await prisma.ptaStudentProgressionBatch.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  check("history returns every attempt", history.length === 4, `count=${history.length}`);

  // ── 8. CONCURRENCY: parallel creates cannot both win ──────────────────
  await prisma.ptaStudentProgressionBatch.deleteMany({ where: { organizationId: orgId } });
  const RACERS = 12;
  const settled = await Promise.all(Array.from({ length: RACERS }, () => insertBatch({ ...pair, status: "PREPARING" })));
  const winners = settled.filter((id) => id !== null);
  check(`exactly one of ${RACERS} concurrent creates succeeds`, winners.length === 1, `winners=${winners.length}`);
  const active = await prisma.ptaStudentProgressionBatch.count({
    where: { organizationId: orgId, status: { not: "ROLLED_BACK" } },
  });
  check("exactly one active batch exists afterwards", active === 1, `active=${active}`);

  // ── 9. the constraint is per-organization, not global ─────────────────
  const other = await prisma.organization.create({
    data: { slug: `${SLUG}-other`, name: "Build 26 other tenant", primaryVertical: "PTA", plan: "elite" },
  });
  const otherFrom = await prisma.ptaSchoolYear.create({ data: { organizationId: other.id, label: "2026-2027", isCurrent: true } });
  const otherTo = await prisma.ptaSchoolYear.create({ data: { organizationId: other.id, label: "2027-2028", isCurrent: false } });
  const savedOrg = orgId;
  orgId = other.id;
  const otherBatch = await insertBatch({ fromId: otherFrom.id, toId: otherTo.id, status: "PREPARING" });
  orgId = savedOrg;
  check("another organization may hold its own active batch for the same years", otherBatch !== null);
  await prisma.organization.delete({ where: { id: other.id } }).catch(async () => {
    await prisma.ptaStudentProgressionBatch.deleteMany({ where: { organizationId: other.id } });
    await prisma.ptaSchoolYear.deleteMany({ where: { organizationId: other.id } });
    await prisma.organization.delete({ where: { id: other.id } });
  });
} finally {
  if (orgId) {
    await prisma.ptaStudentProgressionBatch.deleteMany({ where: { organizationId: orgId } });
    await prisma.ptaSchoolYear.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  }
  await prisma.$disconnect();
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n  progression constraint: ${passed}/${results.length}`);
if (passed !== results.length) process.exit(1);

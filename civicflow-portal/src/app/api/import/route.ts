import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { importMembers, buildFieldGetter, parseDate } from "@/lib/member-import";
import { importPtaHouseholds, importHoaProperties } from "@/lib/vertical-import";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { requireHoaPropertyWrite, requireHoaResidentWrite } from "@/lib/hoa/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { parseSpreadsheetBuffer, SpreadsheetValidationError } from "@/lib/imports/spreadsheet-parser";
import Database from "better-sqlite3";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB (db files can be larger)

// ── helpers ───────────────────────────────────────────────────────────────────

/** Security Patch A -- routes through the hardened shared parser
 * (spreadsheet-parser.ts) rather than the vulnerable `xlsx` package.
 * Rejections surface as the caller's existing plain-message convention. */
async function parseSpreadsheet(buffer: Buffer, extension: string): Promise<Record<string, string>[]> {
  const { rows } = await parseSpreadsheetBuffer(buffer, extension);
  return rows;
}

function parseSqliteDb(buffer: Buffer, table: string): Record<string, string>[] {
  const tmp = join(tmpdir(), `civicflow-import-${randomBytes(8).toString("hex")}.db`);
  try {
    writeFileSync(tmp, buffer);
    const db = new Database(tmp, { readonly: true });
    // SQLite doesn't support parameter binding for identifiers (table names),
    // so the table must be validated against the file's own actual table
    // list before being string-interpolated into the query.
    const actualTables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    if (!actualTables.some((t) => t.name === table)) {
      db.close();
      throw new Error("table_not_found");
    }
    const rows = db.prepare(`SELECT * FROM "${table}" LIMIT 5000`).all() as Record<string, unknown>[];
    db.close();
    return rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")]))
    );
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function getDbTables(buffer: Buffer): string[] {
  const tmp = join(tmpdir(), `civicflow-import-${randomBytes(8).toString("hex")}.db`);
  try {
    writeFileSync(tmp, buffer);
    const db = new Database(tmp, { readonly: true });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    db.close();
    return tables.map((t) => t.name);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

async function parseFile(buffer: Buffer, filename: string, table?: string): Promise<Record<string, string>[]> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "db" || ext === "sqlite") {
    if (!table) throw new Error("table_required");
    return parseSqliteDb(buffer, table);
  }
  // Security Patch A -- previously any extension other than .db/.sqlite
  // fell through to the spreadsheet parser unconditionally (a file named
  // "malicious.exe" would have been handed straight to XLSX.read()).
  // Legacy binary .xls is no longer accepted -- see
  // docs/security/spreadsheet-import-hardening.md for the removal
  // rationale; users are asked to re-save as .xlsx or .csv.
  if (ext !== "csv" && ext !== "xlsx") {
    throw new SpreadsheetValidationError("UNSUPPORTED_FORMAT", "Unsupported file type. Please upload a .csv or .xlsx file (or a .db/.sqlite export).");
  }
  return parseSpreadsheet(buffer, ext);
}

function parseMoney(val: string): number | null {
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

// ── importers ─────────────────────────────────────────────────────────────────
// importMembers lives in src/lib/member-import.ts (imported above) — Next.js's
// App Router route type-checking only permits a fixed set of exports from a
// route.ts file, so shared/testable logic can't be exported from here directly.

async function importContributions(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  organizationId: string,
  preview: boolean
) {
  const results: { row: number; status: "ok" | "error"; message?: string }[] = [];
  const getField = buildFieldGetter(mapping);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = (field: string) => getField(row, field);

    const amount = parseMoney(get("amount"));
    const date = parseDate(get("contributionDate"));

    if (!amount || amount <= 0) {
      results.push({ row: i + 2, status: "error", message: "Invalid or missing amount" });
      continue;
    }
    if (!date) {
      results.push({ row: i + 2, status: "error", message: "Invalid or missing date" });
      continue;
    }

    if (preview) {
      results.push({ row: i + 2, status: "ok" });
      continue;
    }

    try {
      const memberEmail = get("memberEmail");
      let memberId: string | null = null;
      if (memberEmail) {
        const member = await prisma.orgMember.findFirst({
          where: { organizationId, email: memberEmail },
          select: { id: true },
        });
        memberId = member?.id ?? null;
      }

      const rawMethod = get("paymentMethod").toUpperCase().replace(/\s+/g, "_");
      const validMethods = [
        "CASH", "CHECK", "CREDIT_CARD", "DEBIT_CARD", "CARD", "ACH",
        "ZELLE", "CASH_APP", "VENMO", "PAYPAL", "STRIPE", "ZEFFY", "OTHER",
      ];
      const paymentMethod = validMethods.includes(rawMethod) ? rawMethod : "OTHER";

      await prisma.contribution.create({
        data: {
          organizationId,
          memberId,
          amount,
          contributionDate: date,
          paymentMethod: paymentMethod as never,
          notes: get("notes") || null,
          source: "IMPORT",
        },
      });
      results.push({ row: i + 2, status: "ok" });
    } catch (err) {
      results.push({ row: i + 2, status: "error", message: String(err) });
    }
  }

  return results;
}

// ── route ─────────────────────────────────────────────────────────────────────

const IMPORT_TYPES = ["members", "contributions", "pta-households", "hoa-properties"] as const;
type ImportTypeValue = (typeof IMPORT_TYPES)[number];

/**
 * Permission gating is branched by import type rather than a single fixed
 * permission, since "members:write" isn't the right gate for PTA households
 * or HOA properties — those go through requirePtaAccess/requireHoaProperty*
 * (which also check the organization's actual vertical, not just an RBAC
 * permission string) so a Community-vertical org whose STAFF role happens to
 * technically hold pta:households:manage can't use this to create PTA data.
 */
async function requireImportPermission(
  importType: ImportTypeValue
): Promise<{ organizationId: string; actorUserId: string; actorEmail: string | null }> {
  if (importType === "pta-households") {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);
    return { organizationId, actorUserId: session.userId, actorEmail: session.userEmail ?? null };
  }
  if (importType === "hoa-properties") {
    const { organizationId, session } = await requireHoaPropertyWrite();
    await requireHoaResidentWrite();
    return { organizationId, actorUserId: session.userId, actorEmail: session.userEmail ?? null };
  }
  const { organizationId, session } = await requirePermission("members:write", "throw");
  return { organizationId, actorUserId: session.userId, actorEmail: session.userEmail ?? null };
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      return Response.json({ error: "File too large (max 50 MB)" }, { status: 413 });
    }

    const form = await request.formData();
    const file = form.get("file") as File | null;
    const importTypeRaw = String(form.get("type") ?? "");
    const mappingRaw = String(form.get("mapping") ?? "{}");
    const preview = form.get("preview") === "1";
    const table = form.get("table") ? String(form.get("table")) : undefined;
    const listTables = form.get("listTables") === "1";

    if (!IMPORT_TYPES.includes(importTypeRaw as ImportTypeValue)) {
      return Response.json({ error: "Invalid import type" }, { status: 400 });
    }
    const importType = importTypeRaw as ImportTypeValue;
    const { organizationId, actorUserId, actorEmail } = await requireImportPermission(importType);

    if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.toLowerCase().split(".").pop();
    const isSqlite = ext === "db" || ext === "sqlite";

    // SQLite: list available tables before requiring a type selection
    if (isSqlite && listTables) {
      const tables = getDbTables(buffer);
      return Response.json({ ok: true, tables });
    }

    let rows: Record<string, string>[];
    try {
      rows = await parseFile(buffer, file.name, table);
    } catch (err) {
      if (err instanceof SpreadsheetValidationError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      if (String(err).includes("table_required")) {
        return Response.json({ error: "Please select a table from the SQLite file." }, { status: 400 });
      }
      if (String(err).includes("table_not_found")) {
        return Response.json({ error: "That table doesn't exist in the uploaded file." }, { status: 400 });
      }
      throw err;
    }

    if (rows.length === 0) {
      return Response.json({ error: "File is empty or has no data rows" }, { status: 400 });
    }

    const mapping: Record<string, string> = JSON.parse(mappingRaw);
    const headers = Object.keys(rows[0]);

    if (preview) {
      return Response.json({
        ok: true,
        headers,
        preview: rows.slice(0, 5),
        totalRows: rows.length,
      });
    }

    let results;
    if (importType === "members") {
      results = await importMembers(rows, mapping, organizationId, false);
    } else if (importType === "contributions") {
      results = await importContributions(rows, mapping, organizationId, false);
    } else if (importType === "pta-households") {
      results = await importPtaHouseholds(rows, mapping, organizationId, actorUserId, actorEmail, false);
    } else {
      results = await importHoaProperties(rows, mapping, organizationId, actorUserId, actorEmail, false);
    }

    const imported = results.filter((r) => r.status === "ok").length;
    const errors = results.filter((r) => r.status === "error");

    return Response.json({ ok: true, imported, errors, total: rows.length });
  });
}

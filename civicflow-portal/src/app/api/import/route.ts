import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import Database from "better-sqlite3";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB (db files can be larger)

// ── helpers ───────────────────────────────────────────────────────────────────

function parseSpreadsheet(buffer: Buffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: "buffer", dateNF: "yyyy-mm-dd" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
    raw: false,
    defval: "",
  });
}

function parseSqliteDb(buffer: Buffer, table: string): Record<string, string>[] {
  const tmp = join(tmpdir(), `civicflow-import-${randomBytes(8).toString("hex")}.db`);
  try {
    writeFileSync(tmp, buffer);
    const db = new Database(tmp, { readonly: true });
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT 5000`).all() as Record<string, unknown>[];
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

function parseFile(buffer: Buffer, filename: string, table?: string): Record<string, string>[] {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "db" || ext === "sqlite") {
    if (!table) throw new Error("table_required");
    return parseSqliteDb(buffer, table);
  }
  return parseSpreadsheet(buffer);
}

function pickStr(row: Record<string, string>, key: string): string {
  return String(row[key] ?? "").trim();
}

function parseDate(val: string): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function parseMoney(val: string): number | null {
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

// ── importers ─────────────────────────────────────────────────────────────────

async function importMembers(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  organizationId: string,
  preview: boolean
) {
  const results: { row: number; status: "ok" | "error"; message?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = (field: string) => pickStr(row, mapping[field] ?? field);

    const firstName = get("firstName");
    const lastName = get("lastName");

    if (!firstName && !lastName) {
      results.push({ row: i + 2, status: "error", message: "First name and last name are both blank" });
      continue;
    }

    if (preview) {
      results.push({ row: i + 2, status: "ok" });
      continue;
    }

    try {
      const email = get("email") || null;
      const existing = email
        ? await prisma.orgMember.findFirst({ where: { organizationId, email } })
        : null;

      if (existing) {
        await prisma.orgMember.update({
          where: { id: existing.id },
          data: {
            firstName: firstName || existing.firstName,
            lastName: lastName || existing.lastName,
            phone: get("phone") || existing.phone,
            addressLine1: get("address") || existing.addressLine1,
            city: get("city") || existing.city,
            state: get("state") || existing.state,
            zipCode: get("zip") || existing.zipCode,
            joinDate: parseDate(get("joinDate")) ?? existing.joinDate,
          },
        });
      } else {
        await prisma.orgMember.create({
          data: {
            organizationId,
            firstName: firstName || "Unknown",
            lastName: lastName || "Unknown",
            email: email || null,
            phone: get("phone") || null,
            addressLine1: get("address") || null,
            city: get("city") || null,
            state: get("state") || null,
            zipCode: get("zip") || null,
            joinDate: parseDate(get("joinDate")),
          },
        });
      }
      results.push({ row: i + 2, status: "ok" });
    } catch (err) {
      results.push({ row: i + 2, status: "error", message: String(err) });
    }
  }

  return results;
}

async function importContributions(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  organizationId: string,
  preview: boolean
) {
  const results: { row: number; status: "ok" | "error"; message?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = (field: string) => pickStr(row, mapping[field] ?? field);

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

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("members:write");

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      return Response.json({ error: "File too large (max 10 MB)" }, { status: 413 });
    }

    const form = await request.formData();
    const file = form.get("file") as File | null;
    const importType = String(form.get("type") ?? "");
    const mappingRaw = String(form.get("mapping") ?? "{}");
    const preview = form.get("preview") === "1";
    const table = form.get("table") ? String(form.get("table")) : undefined;
    const listTables = form.get("listTables") === "1";

    if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.toLowerCase().split(".").pop();
    const isSqlite = ext === "db" || ext === "sqlite";

    // SQLite: list available tables before requiring a type selection
    if (isSqlite && listTables) {
      const tables = getDbTables(buffer);
      return Response.json({ ok: true, tables });
    }

    if (!["members", "contributions"].includes(importType)) {
      return Response.json({ error: "Invalid import type" }, { status: 400 });
    }

    let rows: Record<string, string>[];
    try {
      rows = parseFile(buffer, file.name, table);
    } catch (err) {
      if (String(err).includes("table_required")) {
        return Response.json({ error: "Please select a table from the SQLite file." }, { status: 400 });
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
    } else {
      results = await importContributions(rows, mapping, organizationId, false);
    }

    const imported = results.filter((r) => r.status === "ok").length;
    const errors = results.filter((r) => r.status === "error");

    return Response.json({ ok: true, imported, errors, total: rows.length });
  });
}

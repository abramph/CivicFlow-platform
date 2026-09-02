import { withApiErrorHandling } from "@/lib/api-route";
import { requireRole } from "@/lib/auth-guards";
import { ValidationError } from "@/lib/validation";
import { runMigrationImport, type DesktopExport } from "@/lib/migration-import";
import { SpreadsheetValidationError } from "@/lib/imports/spreadsheet-parser";
import { parseUploadedSpreadsheet, ParseAdmissionDeniedError } from "@/lib/imports/parse-spreadsheet-isolated";
import Database from "better-sqlite3";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

// ── SQLite .db → DesktopExport ────────────────────────────────────────────────

function readTable<T>(db: Database.Database, table: string, query: string): T[] {
  try {
    return db.prepare(query).all() as T[];
  } catch {
    return [];
  }
}

function buildExportFromSqlite(buffer: Buffer): DesktopExport {
  const tmp = join(tmpdir(), `cf-migration-${randomBytes(8).toString("hex")}.db`);
  try {
    writeFileSync(tmp, buffer);
    const db = new Database(tmp, { readonly: true });

    const members = readTable<NonNullable<DesktopExport["members"]>[number]>(
      db, "members",
      "SELECT id, first_name, last_name, email, phone, address, status, join_date, city, state, zip, dob, category_id FROM members"
    );
    const categories = readTable<NonNullable<DesktopExport["categories"]>[number]>(
      db, "categories",
      "SELECT id, name, monthly_dues_cents FROM categories"
    );
    const events = readTable<NonNullable<DesktopExport["events"]>[number]>(
      db, "events",
      "SELECT id, name, date, location, notes FROM events"
    );
    const campaigns = readTable<NonNullable<DesktopExport["campaigns"]>[number]>(
      db, "campaigns",
      "SELECT id, name, start_date, end_date, goal_amount_cents, notes FROM campaigns"
    );
    const meetings = readTable<NonNullable<DesktopExport["meetings"]>[number]>(
      db, "meetings",
      "SELECT id, title, meeting_date FROM meetings"
    );
    const attendance = readTable<NonNullable<DesktopExport["attendance"]>[number]>(
      db, "attendance",
      "SELECT member_id, meeting_id, attended FROM attendance"
    );
    const transactions = readTable<NonNullable<DesktopExport["transactions"]>[number]>(
      db, "transactions",
      "SELECT id, type, amount_cents, occurred_on, member_id, campaign_id, event_id, note, contributor_name, is_deleted FROM transactions"
    );
    const expenditures = readTable<NonNullable<DesktopExport["expenditures"]>[number]>(
      db, "expenditures",
      "SELECT id, date, amount, category, description, payment_method FROM expenditures"
    );

    const financialTransactions = (() => {
      try {
        const ftCols = (db.prepare("PRAGMA table_info(financial_transactions)").all() as { name: string }[]).map(c => c.name);
        const pick = ["id","member_id","membership_period_id","txn_type","amount","txn_date","reference","notes","campaign_id","event_id"].filter(c => ftCols.includes(c));
        const statusWhere = ftCols.includes("status") ? "WHERE COALESCE(status,'POSTED')='POSTED'" : "";
        return db.prepare(`SELECT ${pick.join(",")} FROM financial_transactions ${statusWhere}`).all() as NonNullable<DesktopExport["financialTransactions"]>;
      } catch { return []; }
    })();

    db.close();

    return {
      version: 1,
      schema: "civicflow-desktop-export",
      exportedAt: new Date().toISOString(),
      members,
      categories,
      events,
      campaigns,
      meetings,
      attendance,
      transactions,
      financialTransactions,
      expenditures,
    };
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

// ── CSV / Excel → DesktopExport (members + contributions) ────────────────────

const MEMBER_ALIASES: Record<string, keyof NonNullable<DesktopExport["members"]>[number]> = {
  "first name": "first_name", "first_name": "first_name", "firstname": "first_name",
  "last name": "last_name", "last_name": "last_name", "lastname": "last_name",
  "email": "email", "email address": "email",
  "phone": "phone", "phone number": "phone", "mobile": "phone",
  "status": "status", "membership status": "status",
  "join date": "join_date", "join_date": "join_date", "joined": "join_date",
  "city": "city", "state": "state",
  "zip": "zip", "zip code": "zip", "postal code": "zip",
};

const TXN_ALIASES: Record<string, string> = {
  "amount": "amount_cents", "donation": "amount_cents", "contribution": "amount_cents",
  "date": "occurred_on", "contribution date": "occurred_on", "donation date": "occurred_on",
  "transaction date": "occurred_on", "txn date": "occurred_on",
  "type": "type", "transaction type": "type",
  "notes": "note", "note": "note", "memo": "note",
  "member email": "member_email", "donor email": "member_email",
};

/** Security Patch A -- routes through the hardened shared parser
 * (spreadsheet-parser.ts) rather than the vulnerable `xlsx` package.
 * Worker-isolation follow-up -- now via parseUploadedSpreadsheet(), so
 * this runs in an isolated, heap-bounded worker thread behind
 * organization-scoped admission control. */
async function buildExportFromSpreadsheet(buffer: Buffer, extension: string, organizationId: string): Promise<DesktopExport> {
  const { rows } = await parseUploadedSpreadsheet(buffer, extension, organizationId);

  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase().trim());

  // Detect whether this looks like members or transactions data
  const hasMemberCols = headers.some((h) => MEMBER_ALIASES[h]);
  const hasTxnCols = headers.some((h) => TXN_ALIASES[h]);

  const members: DesktopExport["members"] = [];
  const transactions: DesktopExport["transactions"] = [];

  // Build column → field maps
  const memberMap: Record<string, string> = {};
  const txnMap: Record<string, string> = {};
  for (const header of Object.keys(rows[0])) {
    const norm = header.toLowerCase().trim();
    if (MEMBER_ALIASES[norm]) memberMap[header] = MEMBER_ALIASES[norm] as string;
    if (TXN_ALIASES[norm]) txnMap[header] = TXN_ALIASES[norm];
  }

  const get = (row: Record<string, string>, map: Record<string, string>, field: string): string => {
    const col = Object.entries(map).find(([, v]) => v === field)?.[0];
    return col ? String(row[col] ?? "").trim() : "";
  };

  let memberId = 1;
  const emailToId = new Map<string, number>();
  let txnId = 1;

  for (const row of rows) {
    if (hasMemberCols) {
      const firstName = get(row, memberMap, "first_name");
      const lastName = get(row, memberMap, "last_name");
      if (!firstName && !lastName) continue;
      const email = get(row, memberMap, "email") || null;
      const id = memberId++;
      if (email) emailToId.set(email.toLowerCase(), id);
      members.push({
        id,
        first_name: firstName || "Unknown",
        last_name: lastName || "Unknown",
        email,
        phone: get(row, memberMap, "phone") || null,
        status: get(row, memberMap, "status") || "active",
        join_date: get(row, memberMap, "join_date") || null,
        city: get(row, memberMap, "city") || null,
        state: get(row, memberMap, "state") || null,
        zip: get(row, memberMap, "zip") || null,
        category_id: null,
      });
    }

    if (hasTxnCols) {
      const amountRaw = get(row, txnMap, "amount_cents");
      const date = get(row, txnMap, "occurred_on");
      if (!amountRaw || !date) continue;
      const dollars = parseFloat(amountRaw.replace(/[^0-9.\-]/g, ""));
      if (isNaN(dollars)) continue;
      const memberEmail = get(row, txnMap, "member_email").toLowerCase();
      const linkedMemberId = emailToId.get(memberEmail) ?? null;
      transactions.push({
        id: txnId++,
        type: get(row, txnMap, "type") || "donation",
        amount_cents: Math.round(dollars * 100),
        occurred_on: date,
        member_id: linkedMemberId,
        campaign_id: null,
        event_id: null,
        note: get(row, txnMap, "note") || null,
        contributor_name: null,
        is_deleted: 0,
      });
    }
  }

  return {
    version: 1,
    schema: "civicflow-desktop-export",
    exportedAt: new Date().toISOString(),
    members,
    categories: [],
    events: [],
    campaigns: [],
    meetings: [],
    attendance: [],
    transactions,
    expenditures: [],
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireRole("ORG_ADMIN", "throw");

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      throw new ValidationError("File too large (max 100 MB)");
    }

    // Auth-ordering follow-up -- content type checked before parsing,
    // and a malformed multipart body now surfaces as a clean 400 instead
    // of falling through to the generic unhandled-error path. This
    // route's auth/content-length ordering was already correct (auth
    // runs above, before this point) -- only these two checks were
    // missing.
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return Response.json({ ok: false, error: "Unsupported content type. Expected a multipart/form-data file upload." }, { status: 415 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new ValidationError("Could not read the uploaded file. Please try again.");
    }
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw new ValidationError("No file provided");
    }
    if (file.size > MAX_BYTES) {
      throw new ValidationError("File too large (max 100 MB)");
    }

    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    const buffer = Buffer.from(await file.arrayBuffer());

    let data: DesktopExport;

    if (ext === "json") {
      try {
        data = JSON.parse(buffer.toString("utf-8")) as DesktopExport;
      } catch {
        throw new ValidationError("Invalid JSON file");
      }
      if (data.schema !== "civicflow-desktop-export") {
        throw new ValidationError(
          "Unrecognized export format. Export the file from Unestra desktop (Settings → Export for Cloud Migration)."
        );
      }
    } else if (ext === "db" || ext === "sqlite") {
      try {
        data = buildExportFromSqlite(buffer);
      } catch (err) {
        throw new ValidationError(`Could not read SQLite file: ${String(err)}`);
      }
    } else if (ext === "csv" || ext === "xlsx") {
      try {
        data = await buildExportFromSpreadsheet(buffer, ext, organizationId);
      } catch (err) {
        if (err instanceof ParseAdmissionDeniedError) {
          return Response.json(
            { ok: false, error: err.message, retryAfterSeconds: err.retryAfterSeconds },
            { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
          );
        }
        if (err instanceof ValidationError) throw err;
        if (err instanceof SpreadsheetValidationError) throw new ValidationError(err.message);
        // Never surface a raw internal exception (String(err)) to the
        // client or an audit event -- see docs/security/
        // spreadsheet-import-hardening.md's error-sanitization note.
        throw new ValidationError("Could not parse spreadsheet.");
      }
      // Legacy binary .xls is no longer accepted -- see the removal
      // rationale in docs/security/spreadsheet-import-hardening.md.
    } else if (ext === "xls") {
      throw new ValidationError("Legacy .xls files are no longer supported. Please re-save the file as .xlsx or .csv and try again.");
    } else {
      throw new ValidationError("Unsupported file type. Upload a .json, .db, .csv, or .xlsx file.");
    }

    const counts = await runMigrationImport(organizationId, data);
    return Response.json({ ok: true, counts, fileType: ext });
  });
}

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  out.push(current.trim());
  return out;
}

function normalizePlan(plan) {
  const value = String(plan || "").trim().toLowerCase();
  if (value === "elite") return "Elite";
  return "Essential";
}

function seatsForPlan(plan) {
  return normalizePlan(plan) === "Elite" ? 3 : 2;
}

function toExpiryDate(daysRaw, expiryDateRaw) {
  const explicit = String(expiryDateRaw || "").trim();
  if (explicit) return explicit;

  const daysText = String(daysRaw || "").trim();
  if (!daysText) return null;

  const days = Number(daysText);
  if (!Number.isFinite(days) || days <= 0) return null;

  const expires = new Date(Date.now() + (days * 24 * 60 * 60 * 1000));
  return expires.toISOString().slice(0, 10);
}

function generateLicenseKey(plan) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  let raw = "";
  for (let i = 0; i < 16; i += 1) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function loadRows(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function run() {
  const inputPath = process.argv[2] || path.resolve(__dirname, "..", "scripts", "licenses-example.csv");

  if (!fs.existsSync(inputPath)) {
    console.error(`CSV file not found: ${inputPath}`);
    process.exit(1);
  }

  const rows = loadRows(inputPath);
  if (rows.length === 0) {
    console.log("No rows found in CSV.");
    process.exit(0);
  }

  db.all("PRAGMA table_info(licenses)", (schemaErr, schemaRows) => {
    if (schemaErr) {
      console.error("Unable to read licenses schema:", schemaErr.message || schemaErr);
      db.close();
      process.exit(1);
      return;
    }

    const availableColumns = new Set((schemaRows || []).map((r) => String(r?.name || "").trim()));
    if (!availableColumns.has("license_key")) {
      console.error("licenses table must include license_key column.");
      db.close();
      process.exit(1);
      return;
    }

    const optionalColumns = ["plan", "org_name", "seats_allowed", "expiry_date"];
    const insertColumns = ["license_key", ...optionalColumns.filter((col) => availableColumns.has(col))];
    const placeholders = insertColumns.map(() => "?").join(", ");

    const insertSql = `INSERT OR IGNORE INTO licenses (${insertColumns.join(", ")}) VALUES (${placeholders})`;

    let inserted = 0;
    let skipped = 0;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      const stmt = db.prepare(insertSql);

      for (const row of rows) {
        const orgName = String(row.org_name || row.name || "").trim();
        if (!orgName) {
          skipped += 1;
          continue;
        }

        const plan = normalizePlan(row.plan);
        const seatsAllowed = Number(row.seats_allowed || seatsForPlan(plan));
        const expiryDate = toExpiryDate(row.days, row.expiry_date);
        const licenseKey = String(row.license_key || "").trim() || generateLicenseKey(plan);

        const valueMap = {
          license_key: licenseKey,
          plan,
          org_name: orgName,
          seats_allowed: Number.isFinite(seatsAllowed) && seatsAllowed > 0 ? seatsAllowed : seatsForPlan(plan),
          expiry_date: expiryDate,
        };

        const values = insertColumns.map((column) => valueMap[column] ?? null);

        stmt.run(values, function onRun(err) {
          if (err) {
            skipped += 1;
            return;
          }
          if (this.changes > 0) inserted += 1;
          else skipped += 1;
        });
      }

      stmt.finalize((finalizeErr) => {
        if (finalizeErr) {
          db.run("ROLLBACK", () => {
            console.error("Failed to import licenses:", finalizeErr.message || finalizeErr);
            db.close();
            process.exit(1);
          });
          return;
        }

        db.run("COMMIT", (commitErr) => {
          if (commitErr) {
            console.error("Commit failed:", commitErr.message || commitErr);
            db.close();
            process.exit(1);
            return;
          }

          console.log(`Imported licenses from: ${inputPath}`);
          console.log(`Inserted: ${inserted}`);
          console.log(`Skipped: ${skipped}`);
          console.log(`Schema columns used: ${insertColumns.join(", ")}`);
          db.close();
        });
      });
    });
  });
}

run();

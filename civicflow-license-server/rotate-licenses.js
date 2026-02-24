const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./db");

const KEY_PATTERN = /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/;

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function normalizePlan(plan) {
  const value = String(plan || "").trim().toLowerCase();
  if (value === "elite") return "Elite";
  return "Essential";
}

function buildAlphabet() {
  return "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
}

function generateKey() {
  const alphabet = buildAlphabet();
  const bytes = crypto.randomBytes(16);
  let raw = "";
  for (let i = 0; i < 16; i += 1) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function createBackup() {
  const dbPath = path.resolve(__dirname, "licenses.db");
  const backupsDir = path.resolve(__dirname, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const targetPath = path.join(backupsDir, `licenses-${timestamp()}.db`);
  fs.copyFileSync(dbPath, targetPath);
  return targetPath;
}

async function getLicenseColumns() {
  const rows = await allAsync("PRAGMA table_info(licenses)");
  return new Set((rows || []).map((r) => String(r?.name || "").trim()));
}

async function keyExists(licenseKey) {
  const rows = await allAsync("SELECT id FROM licenses WHERE license_key = ? LIMIT 1", [licenseKey]);
  return rows.length > 0;
}

async function uniqueKey() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const key = generateKey();
    if (!(await keyExists(key))) return key;
  }
  throw new Error("Unable to generate unique license key after multiple attempts");
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  try {
    const columns = await getLicenseColumns();
    if (!columns.has("license_key")) {
      throw new Error("licenses table must include license_key column");
    }

    if (columns.has("plan")) {
      await runAsync("UPDATE licenses SET plan = ? WHERE plan IS NULL OR trim(plan) = ''", ["Essential"]);
      await runAsync("UPDATE licenses SET plan = 'Elite' WHERE lower(plan) = 'elite'");
      await runAsync("UPDATE licenses SET plan = 'Essential' WHERE lower(plan) <> 'elite'");
    }

    const selectParts = [
      "id",
      "license_key",
      columns.has("org_name") ? "org_name" : "NULL AS org_name",
      columns.has("plan") ? "plan" : "'Essential' AS plan",
    ];
    const licenses = await allAsync(`SELECT ${selectParts.join(", ")} FROM licenses ORDER BY id`);

    if (!licenses.length) {
      console.log("No licenses found.");
      return;
    }

    const toRotate = licenses.filter((row) => {
      const current = String(row.license_key || "").trim();
      if (force) return true;
      return !KEY_PATTERN.test(current);
    });

    if (!toRotate.length) {
      console.log("No license keys require rotation.");
      return;
    }

    const updates = [];
    for (const row of toRotate) {
      const nextKey = await uniqueKey();
      updates.push({
        id: row.id,
        org_name: row.org_name || "",
        plan: normalizePlan(row.plan),
        oldKey: row.license_key,
        newKey: nextKey,
      });
    }

    console.log(`Found ${toRotate.length} license(s) to rotate.`);
    if (dryRun) {
      console.log("Dry run only. No DB changes applied.");
      console.table(updates.map((u) => ({
        ID: u.id,
        Org: u.org_name || "-",
        Plan: u.plan,
        OldKey: u.oldKey,
        NewKey: u.newKey,
      })));
      return;
    }

    const backupPath = createBackup();
    console.log(`Backup created: ${backupPath}`);

    await runAsync("BEGIN TRANSACTION");
    try {
      for (const update of updates) {
        await runAsync("UPDATE licenses SET license_key = ? WHERE id = ?", [update.newKey, update.id]);
      }
      await runAsync("COMMIT");
    } catch (err) {
      await runAsync("ROLLBACK");
      throw err;
    }

    console.log(`Rotated ${updates.length} license key(s).`);
    console.table(updates.map((u) => ({
      ID: u.id,
      Org: u.org_name || "-",
      Plan: u.plan,
      OldKey: u.oldKey,
      NewKey: u.newKey,
    })));
  } catch (err) {
    console.error("Failed to rotate licenses:", err?.message || err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

run();

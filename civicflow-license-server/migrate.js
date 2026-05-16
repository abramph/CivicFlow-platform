const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function normalizeSqlStatements(sql) {
  return String(sql || "")
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function shouldIgnoreMigrationError(err) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("duplicate column name")
    || message.includes("already exists")
    || message.includes("duplicate key name");
}

async function ensureMigrationsTable() {
  await runAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function listMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
}

async function getAppliedMigrationNames() {
  await ensureMigrationsTable();
  const rows = await allAsync("SELECT name FROM schema_migrations ORDER BY name ASC");
  return new Set((rows || []).map((row) => String(row?.name || "").trim()).filter(Boolean));
}

async function applyMigrationFile(fileName) {
  const absolutePath = path.join(MIGRATIONS_DIR, fileName);
  const sql = fs.readFileSync(absolutePath, "utf8");
  const statements = normalizeSqlStatements(sql);

  await runAsync("BEGIN");
  try {
    for (const statement of statements) {
      try {
        await runAsync(statement);
      } catch (err) {
        if (!shouldIgnoreMigrationError(err)) {
          throw err;
        }
      }
    }
    await runAsync("INSERT INTO schema_migrations (name) VALUES (?)", [fileName]);
    await runAsync("COMMIT");
  } catch (err) {
    try {
      await runAsync("ROLLBACK");
    } catch (_rollbackErr) {
      // noop
    }
    throw err;
  }
}

async function migrateDatabase({ log = false } = {}) {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrationNames();
  const files = listMigrationFiles();

  for (const fileName of files) {
    if (applied.has(fileName)) continue;
    await applyMigrationFile(fileName);
    if (log) {
      console.log(`Applied migration ${fileName}`);
    }
  }
}

async function getMigrationStatus() {
  await ensureMigrationsTable();
  const applied = await allAsync("SELECT name, applied_at FROM schema_migrations ORDER BY name ASC");
  return {
    directory: MIGRATIONS_DIR,
    files: listMigrationFiles(),
    applied,
  };
}

async function main() {
  try {
    await migrateDatabase({ log: true });
    const latest = await getAsync("SELECT name, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 1");
    console.log(latest ? `Latest migration: ${latest.name} at ${latest.applied_at}` : "No migrations applied.");
  } catch (err) {
    console.error("Migration failed:", err?.message || err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  MIGRATIONS_DIR,
  getMigrationStatus,
  listMigrationFiles,
  migrateDatabase,
};

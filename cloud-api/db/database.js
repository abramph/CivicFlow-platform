const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const dbDir = __dirname;
const dbPath = path.join(dbDir, 'cloud.db');
const migrationPath = path.join(dbDir, 'migrations.sql');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const migrationSql = fs.readFileSync(migrationPath, 'utf8');
db.exec(migrationSql);

function tableHasColumn(tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => String(row.name || '').toLowerCase() === String(columnName).toLowerCase());
}

function ensureColumn(tableName, columnName, sqlTypeAndDefault) {
  if (tableHasColumn(tableName, columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlTypeAndDefault}`);
}

const hasLegacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_submissions_cloud'").get();
if (hasLegacy) {
  db.exec(`
    INSERT OR IGNORE INTO payment_submissions (
      cloud_id, org_id, invoice_id, member_name, method, amount, paid_date, note, screenshot_url, status, created_at
    )
    SELECT
      cloud_id,
      'default-org',
      invoice_id,
      member_name,
      method,
      amount,
      paid_date,
      note,
      NULL,
      COALESCE(status, 'NEW'),
      created_at
    FROM payment_submissions_cloud
  `);
}

ensureColumn('payment_submissions', 'org_id', "TEXT DEFAULT 'default-org'");
ensureColumn('payment_submissions', 'screenshot_url', 'TEXT');
ensureColumn('payment_submissions', 'status', "TEXT DEFAULT 'NEW'");

const seedApiKey = 'CFLOW_SUPER_SECURE_KEY';
db.prepare(`
  INSERT OR IGNORE INTO organizations (id, name, api_key)
  VALUES ('default-org', 'Default Organization', ?)
`).run(seedApiKey);

db.prepare("UPDATE organizations SET api_key = ? WHERE id = 'default-org'").run(seedApiKey);

module.exports = db;

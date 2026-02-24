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
// eslint-disable-next-line no-console
console.log('Using DB file:', dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.prepare(`CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT,
  api_key TEXT UNIQUE,
  email_from TEXT,
  zelle_info TEXT,
  cashapp_info TEXT,
  venmo_info TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

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

ensureColumn('payment_submissions', 'org_id', "TEXT NOT NULL DEFAULT 'default-org'");
ensureColumn('payment_submissions', 'screenshot_url', 'TEXT');
ensureColumn('payment_submissions', 'status', "TEXT DEFAULT 'NEW'");

ensureColumn('organizations', 'email_from', 'TEXT');
ensureColumn('organizations', 'zelle_info', 'TEXT');
ensureColumn('organizations', 'cashapp_info', 'TEXT');
ensureColumn('organizations', 'venmo_info', 'TEXT');
ensureColumn('organizations', 'created_at', 'TEXT');

db.exec("UPDATE payment_submissions SET org_id = 'default-org' WHERE org_id IS NULL OR TRIM(org_id) = ''");
db.exec("UPDATE organizations SET created_at = datetime('now') WHERE created_at IS NULL OR TRIM(created_at) = ''");

const defaultApiKey = String(process.env.DEFAULT_ORG_API_KEY || '').trim() || 'CFLOW_SUPER_SECURE_KEY';
db.prepare(`
  INSERT OR IGNORE INTO organizations (id, name, api_key)
  VALUES ('default-org', 'Default Organization', ?)
`).run(defaultApiKey);

const existingUlab = db.prepare("SELECT * FROM organizations WHERE id = 'ulab'").get();
if (!existingUlab) {
  db.prepare(`
    INSERT INTO organizations (id, name, api_key)
    VALUES ('ulab', 'ULAB Organization', 'API_KEY_ULAB_123')
  `).run();
  // eslint-disable-next-line no-console
  console.log('Inserted default ULAB org for testing');
}

module.exports = db;

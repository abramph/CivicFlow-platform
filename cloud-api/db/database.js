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

module.exports = db;

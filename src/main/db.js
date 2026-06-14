const Database = require('better-sqlite3');
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { migrations } = require('../db/migrations.js');
const { APP_NAME } = require('../shared/appConfig.js');
const { info, error: logError } = require('./logger.js');

let db = null;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, APP_NAME);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return path.join(dbDir, 'app.db');
}

const SCHEMA_MIGRATIONS_BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

function ensureSchemaMigrationsTable(database) {
  database.exec(SCHEMA_MIGRATIONS_BOOTSTRAP);
}

function hasColumn(database, tableName, columnName) {
  try {
    const rows = database.prepare(`PRAGMA table_info(${tableName})`).all();
    return rows.some((row) => String(row?.name || "").toLowerCase() === String(columnName || "").toLowerCase());
  } catch {
    return false;
  }
}

function repairOrganizationAutoArchiveColumns(database) {
  const updateTargets = [
    {
      column: "auto_archive_enabled",
      sql: "ALTER TABLE organization ADD COLUMN auto_archive_enabled INTEGER NOT NULL DEFAULT 0;",
    },
    {
      column: "auto_archive_events_days",
      sql: "ALTER TABLE organization ADD COLUMN auto_archive_events_days INTEGER NOT NULL DEFAULT 90;",
    },
    {
      column: "auto_archive_campaigns_days",
      sql: "ALTER TABLE organization ADD COLUMN auto_archive_campaigns_days INTEGER NOT NULL DEFAULT 90;",
    },
  ];

  const runRepair = database.transaction(() => {
    for (const target of updateTargets) {
      if (!hasColumn(database, "organization", target.column)) {
        database.exec(target.sql);
      }
    }

    database.exec(`
      UPDATE organization
      SET
        auto_archive_enabled = COALESCE(auto_archive_enabled, 0),
        auto_archive_events_days = COALESCE(auto_archive_events_days, 90),
        auto_archive_campaigns_days = COALESCE(auto_archive_campaigns_days, 90),
        updated_at = datetime('now')
      WHERE
        auto_archive_enabled IS NULL
        OR auto_archive_events_days IS NULL
        OR auto_archive_campaigns_days IS NULL
    `);
  });

  runRepair();
}

function runMigrations(database) {
  ensureSchemaMigrationsTable(database);

  const insertMigration = database.prepare('INSERT INTO schema_migrations (id) VALUES (?)');
  const getMigration = database.prepare('SELECT id FROM schema_migrations WHERE id = ?');

  for (const m of migrations) {
    const existing = getMigration.get(m.id);
    if (existing) continue;

    const runOne = database.transaction(() => {
      database.exec(m.sql);
      insertMigration.run(m.id);
    });

    try {
      runOne();
      info('Applied migration:', m.id);
    } catch (err) {
      logError('Migration failed:', m.id, err);
      throw err;
    }
  }
}

function initializeDatabase() {
  if (db) return db;

  const dbPath = getDbPath();
  info('Initializing database at', dbPath);

  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    runMigrations(db);
    repairOrganizationAutoArchiveColumns(db);
    return db;
  } catch (err) {
    logError('Database initialization failed:', err);
    throw err;
  }
}

function getDatabase() {
  return db;
}

function closeDatabase() {
  if (!db) return;
  try {
    db.close();
  } catch (_err) {
  } finally {
    db = null;
  }
}

module.exports = {
  initializeDatabase,
  getDatabase,
  closeDatabase,
  getDbPath,
};

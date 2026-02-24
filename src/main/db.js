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
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    runMigrations(db);
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

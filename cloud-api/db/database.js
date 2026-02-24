const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'cloud.db');

console.log('==============================');
console.log('Using DB file:', dbPath);
console.log('==============================');

const db = new Database(dbPath);

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

module.exports = db;

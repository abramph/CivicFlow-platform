const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.resolve(
  String(process.env.LICENSE_DB_PATH || path.join(__dirname, "licenses.db"))
);
const db = new sqlite3.Database(dbPath);

module.exports = db;

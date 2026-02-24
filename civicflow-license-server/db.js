const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./licenses.db");

module.exports = db;

const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./licenses.db");

db.exec(`
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT UNIQUE,
  plan TEXT DEFAULT 'Essential',
  org_name TEXT,
  seats_allowed INTEGER,
  expiry_date TEXT
);

CREATE TABLE IF NOT EXISTS activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER,
  device_id TEXT,
  device_name TEXT,
  email TEXT,
  activation_token TEXT,
  activated_at TEXT,
  last_check_in_at TEXT,
  deactivated_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(license_id) REFERENCES licenses(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_token ON activations(activation_token);
CREATE INDEX IF NOT EXISTS idx_activations_license_active ON activations(license_id, deactivated_at);
`, (err) => {
  if (err) {
    console.error("Schema error:", err);
  } else {
    console.log("Database initialized successfully");

    db.run(`
      INSERT OR IGNORE INTO licenses
      (license_key, plan, org_name, seats_allowed, expiry_date)
      VALUES
      ("A2F9-K7M3-P4Q8-T6W1", "Essential", "CivicFlow Demo Org", 2, "2027-12-31"),
      ("Z8R5-N2X4-H7V9-B3L6", "Elite", "CivicFlow Demo Org", 3, "2027-12-31")
    `, (err) => {
      if (err) {
        console.error("Insert error:", err);
      } else {
        console.log("Sample license inserted");
      }

      db.close();
    });
  }
});

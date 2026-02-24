CREATE TABLE IF NOT EXISTS payment_submissions_cloud (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloud_id TEXT UNIQUE,
  invoice_id TEXT,
  member_name TEXT,
  method TEXT,
  amount REAL,
  paid_date TEXT,
  note TEXT,
  status TEXT DEFAULT 'NEW',
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_cloud_status
ON payment_submissions_cloud(status);

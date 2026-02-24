CREATE TABLE IF NOT EXISTS payment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloud_id TEXT UNIQUE,
  org_id TEXT,
  invoice_id TEXT,
  member_name TEXT,
  method TEXT,
  amount REAL,
  paid_date TEXT,
  note TEXT,
  screenshot_url TEXT,
  status TEXT DEFAULT 'NEW',
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_status
ON payment_submissions(status);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_org_status
ON payment_submissions(org_id, status);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT,
  api_key TEXT UNIQUE
);

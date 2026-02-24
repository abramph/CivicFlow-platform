-- Hybrid payment confirmation sync table
CREATE TABLE IF NOT EXISTS payment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER,
  invoice_id INTEGER,
  method TEXT,
  amount REAL,
  paid_date TEXT,
  note TEXT,
  screenshot_path TEXT,
  status TEXT DEFAULT 'PENDING_VERIFICATION',
  source TEXT DEFAULT 'LOCAL',
  cloud_id TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_status ON payment_submissions(status);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_member ON payment_submissions(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_submissions_cloud_id_unique ON payment_submissions(cloud_id);

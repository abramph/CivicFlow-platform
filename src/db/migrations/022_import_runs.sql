-- Import run tracking
CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT,
  total_rows INTEGER DEFAULT 0,
  inserted_rows INTEGER DEFAULT 0,
  updated_rows INTEGER DEFAULT 0,
  skipped_rows INTEGER DEFAULT 0,
  error_rows INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('PREVIEW','COMPLETED','FAILED')) DEFAULT 'PREVIEW',
  errors_json TEXT,
  created_by_user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Optional linkage for imported financial ledger entries
ALTER TABLE financial_transactions ADD COLUMN import_run_id INTEGER;

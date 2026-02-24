-- Create expenditures table for tracking organizational spending
CREATE TABLE IF NOT EXISTS expenditures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,

  payee_type TEXT,              -- 'member' or 'vendor'
  payee_member_id INTEGER,      -- nullable
  payee_name TEXT,              -- for vendors or manual entry

  source_type TEXT DEFAULT 'organization',  -- 'organization' | 'event' | 'campaign'
  source_id INTEGER,            -- nullable

  payment_method TEXT,
  status TEXT DEFAULT 'paid',

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expenditures_date ON expenditures(date);
CREATE INDEX IF NOT EXISTS idx_expenditures_category ON expenditures(category);
CREATE INDEX IF NOT EXISTS idx_expenditures_payee_member ON expenditures(payee_member_id);
CREATE INDEX IF NOT EXISTS idx_expenditures_source ON expenditures(source_type, source_id);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT UNIQUE,
  plan TEXT DEFAULT 'Essential',
  org_name TEXT,
  customer_email TEXT,
  license_type TEXT,
  status TEXT,
  issued_at TEXT,
  seats_allowed INTEGER,
  expiry_date TEXT,
  support_expiry_date TEXT,
  notes TEXT
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

CREATE TABLE IF NOT EXISTS purchase_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'stripe',
  stripe_event_id TEXT UNIQUE,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_customer_id TEXT,
  stripe_price_id TEXT,
  customer_email TEXT,
  org_name TEXT,
  license_id INTEGER,
  status TEXT NOT NULL DEFAULT 'processing',
  raw_payload TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(license_id) REFERENCES licenses(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_token ON activations(activation_token);
CREATE INDEX IF NOT EXISTS idx_activations_license_active ON activations(license_id, deactivated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_events_event_id ON purchase_events(stripe_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_events_session_id ON purchase_events(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_purchase_events_license_id ON purchase_events(license_id);

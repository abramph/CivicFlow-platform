CREATE TABLE licenses (
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
  notes TEXT,
  environment TEXT NOT NULL DEFAULT 'test'
);

CREATE TABLE activations (
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

CREATE TABLE purchase_events (
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
  environment TEXT NOT NULL DEFAULT 'test',
  purchase_kind TEXT,
  target_license_id INTEGER,
  checkout_session_id TEXT,
  price_id TEXT,
  amount_total INTEGER,
  currency TEXT,
  FOREIGN KEY(license_id) REFERENCES licenses(id)
);

CREATE TABLE license_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  activation_id INTEGER,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (license_id) REFERENCES licenses(id),
  FOREIGN KEY (activation_id) REFERENCES activations(id)
);

CREATE UNIQUE INDEX idx_activations_token ON activations(activation_token);
CREATE INDEX idx_activations_license_active ON activations(license_id, deactivated_at);
CREATE UNIQUE INDEX idx_active_activation_per_device
ON activations(license_id, device_id)
WHERE deactivated_at IS NULL;

CREATE UNIQUE INDEX idx_purchase_events_event_id ON purchase_events(stripe_event_id);
CREATE UNIQUE INDEX idx_purchase_events_session_id ON purchase_events(stripe_session_id);
CREATE INDEX idx_purchase_events_license_id ON purchase_events(license_id);
CREATE INDEX idx_purchase_events_target_license_id ON purchase_events(target_license_id);
CREATE INDEX idx_purchase_events_environment ON purchase_events(environment, status, created_at);

CREATE INDEX idx_license_events_license_id ON license_events(license_id, created_at);

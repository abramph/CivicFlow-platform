ALTER TABLE licenses ADD COLUMN environment TEXT NOT NULL DEFAULT 'test';
ALTER TABLE purchase_events ADD COLUMN environment TEXT NOT NULL DEFAULT 'test';
ALTER TABLE purchase_events ADD COLUMN purchase_kind TEXT;
ALTER TABLE purchase_events ADD COLUMN target_license_id INTEGER;
ALTER TABLE purchase_events ADD COLUMN checkout_session_id TEXT;
ALTER TABLE purchase_events ADD COLUMN customer_email TEXT;
ALTER TABLE purchase_events ADD COLUMN price_id TEXT;
ALTER TABLE purchase_events ADD COLUMN amount_total INTEGER;
ALTER TABLE purchase_events ADD COLUMN currency TEXT;

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

CREATE INDEX idx_license_events_license_id
ON license_events(license_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_activation_per_device
ON activations(license_id, device_id)
WHERE deactivated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_events_target_license_id
ON purchase_events(target_license_id);

CREATE INDEX IF NOT EXISTS idx_purchase_events_environment
ON purchase_events(environment, status, created_at);

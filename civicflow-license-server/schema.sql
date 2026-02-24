CREATE TABLE licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT UNIQUE,
  plan TEXT DEFAULT 'Essential',
  org_name TEXT,
  seats_allowed INTEGER,
  expiry_date TEXT
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

CREATE UNIQUE INDEX idx_activations_token ON activations(activation_token);
CREATE INDEX idx_activations_license_active ON activations(license_id, deactivated_at);

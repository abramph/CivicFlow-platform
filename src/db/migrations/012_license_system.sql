-- License system for TRIAL and PRO licenses
CREATE TABLE IF NOT EXISTS license (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_name TEXT NOT NULL,
  license_type TEXT NOT NULL,    -- TRIAL | PRO
  expires TEXT NOT NULL,         -- YYYY-MM-DD or PERPETUAL
  device_id TEXT NOT NULL,
  slot INTEGER NOT NULL,         -- 1 or 2
  key TEXT NOT NULL,
  activated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_license_device ON license(device_id);
CREATE INDEX IF NOT EXISTS idx_license_type ON license(license_type);
CREATE INDEX IF NOT EXISTS idx_license_org ON license(org_name);

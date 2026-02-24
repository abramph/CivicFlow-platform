-- Enable optional online payments flag on organization
ALTER TABLE organization ADD COLUMN payments_enabled INTEGER DEFAULT 0;

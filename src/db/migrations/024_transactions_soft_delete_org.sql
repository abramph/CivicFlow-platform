-- Add soft delete and organization scoping to transactions
ALTER TABLE transactions ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE transactions ADD COLUMN deleted_by TEXT;
ALTER TABLE transactions ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_transactions_org ON transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_is_deleted ON transactions(is_deleted);

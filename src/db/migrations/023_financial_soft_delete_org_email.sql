-- Soft delete fields for financial transactions
ALTER TABLE financial_transactions ADD COLUMN is_deleted INTEGER DEFAULT 0;
ALTER TABLE financial_transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE financial_transactions ADD COLUMN deleted_by TEXT;

-- Organization email sender fields
ALTER TABLE organization ADD COLUMN email_display_name TEXT;
ALTER TABLE organization ADD COLUMN email_from_address TEXT;

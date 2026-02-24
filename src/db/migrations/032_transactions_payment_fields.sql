-- Transactions: unify payment fields
ALTER TABLE transactions ADD COLUMN source TEXT;
ALTER TABLE transactions ADD COLUMN reference TEXT;

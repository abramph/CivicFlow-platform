-- Transactions: external payment verification fields
ALTER TABLE transactions ADD COLUMN payment_method TEXT;
ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'COMPLETED';
ALTER TABLE transactions ADD COLUMN proof_url TEXT;

-- Organization: external payment contacts
ALTER TABLE organization ADD COLUMN cashapp_handle TEXT;
ALTER TABLE organization ADD COLUMN zelle_contact TEXT;

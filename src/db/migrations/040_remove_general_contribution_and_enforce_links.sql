-- Cleanup legacy General Contribution records and enforce attribution integrity
CREATE TABLE IF NOT EXISTS payment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER
);

CREATE TEMP TABLE IF NOT EXISTS _gc_txn_ids AS
SELECT t.id
FROM transactions t
LEFT JOIN members m ON m.id = t.member_id
WHERE UPPER(COALESCE(t.transaction_type, '')) = 'GENERAL_CONTRIBUTION'
   OR UPPER(COALESCE(t.type, '')) = 'GENERAL_CONTRIBUTION'
   OR (
     LOWER(COALESCE(m.first_name, '')) = 'general'
     AND LOWER(COALESCE(m.last_name, '')) = 'contribution'
   );

DELETE FROM payment_submissions
WHERE invoice_id IN (SELECT id FROM _gc_txn_ids);

DELETE FROM transactions
WHERE id IN (SELECT id FROM _gc_txn_ids);

DELETE FROM members
WHERE LOWER(COALESCE(first_name, '')) = 'general'
  AND LOWER(COALESCE(last_name, '')) = 'contribution';

DELETE FROM payment_submissions
WHERE invoice_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM transactions t WHERE t.id = payment_submissions.invoice_id
  );

DROP TABLE IF EXISTS _gc_txn_ids;

DROP TRIGGER IF EXISTS trg_transactions_require_attribution_insert;
DROP TRIGGER IF EXISTS trg_transactions_require_attribution_update;

CREATE TRIGGER trg_transactions_require_attribution_insert
BEFORE INSERT ON transactions
FOR EACH ROW
WHEN COALESCE(NEW.is_deleted, 0) = 0
  AND UPPER(COALESCE(NEW.type, '')) <> 'EXPENSE'
  AND NEW.member_id IS NULL
  AND NEW.event_id IS NULL
  AND NEW.campaign_id IS NULL
  AND UPPER(COALESCE(NEW.contributor_type, '')) <> 'NON_MEMBER'
BEGIN
  SELECT RAISE(ABORT, 'Every contribution must be attributed to a Member, Non-Member, or Event.');
END;

CREATE TRIGGER trg_transactions_require_attribution_update
BEFORE UPDATE ON transactions
FOR EACH ROW
WHEN COALESCE(NEW.is_deleted, 0) = 0
  AND UPPER(COALESCE(NEW.type, '')) <> 'EXPENSE'
  AND NEW.member_id IS NULL
  AND NEW.event_id IS NULL
  AND NEW.campaign_id IS NULL
  AND UPPER(COALESCE(NEW.contributor_type, '')) <> 'NON_MEMBER'
BEGIN
  SELECT RAISE(ABORT, 'Every contribution must be attributed to a Member, Non-Member, or Event.');
END;

CREATE INDEX IF NOT EXISTS idx_transactions_attribution
ON transactions(member_id, event_id, campaign_id, contributor_type);

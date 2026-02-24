-- Transactions: standardized transaction type classification
ALTER TABLE transactions ADD COLUMN transaction_type TEXT DEFAULT 'DONATION';

UPDATE transactions
SET transaction_type = CASE
  WHEN campaign_id IS NOT NULL THEN 'CAMPAIGN_CONTRIBUTION'
  WHEN event_id IS NOT NULL THEN 'EVENT_REVENUE'
  WHEN type IN ('dues', 'dues_payment') THEN 'DUES'
  WHEN type = 'donation' THEN 'DONATION'
  ELSE 'OTHER_INCOME'
END
WHERE transaction_type IS NULL OR transaction_type = '';

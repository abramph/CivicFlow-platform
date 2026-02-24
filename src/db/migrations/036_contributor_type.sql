-- Transactions: contributor type for non-member, campaign, and event revenue
ALTER TABLE transactions ADD COLUMN contributor_type TEXT DEFAULT 'MEMBER';

UPDATE transactions
SET contributor_type = CASE
  WHEN member_id IS NOT NULL THEN 'MEMBER'
  WHEN campaign_id IS NOT NULL THEN 'CAMPAIGN_REVENUE'
  WHEN event_id IS NOT NULL THEN 'EVENT_REVENUE'
  ELSE 'NON_MEMBER'
END
WHERE contributor_type IS NULL;

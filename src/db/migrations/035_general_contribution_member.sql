-- System member for orphan transactions
INSERT INTO members (first_name, last_name, status, organization_id)
SELECT 'General', 'Contribution', 'active', 1
WHERE NOT EXISTS (
  SELECT 1 FROM members
  WHERE first_name = 'General'
    AND last_name = 'Contribution'
    AND COALESCE(organization_id, 1) = 1
);

-- Reassign orphan transactions to system member
UPDATE transactions
SET member_id = (
  SELECT id FROM members
  WHERE first_name = 'General'
    AND last_name = 'Contribution'
    AND COALESCE(organization_id, 1) = 1
  LIMIT 1
)
WHERE member_id IS NULL;

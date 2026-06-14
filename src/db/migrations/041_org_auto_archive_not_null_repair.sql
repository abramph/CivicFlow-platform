-- Backfill auto-archive organization settings for older rows
UPDATE organization
SET
  auto_archive_enabled = COALESCE(auto_archive_enabled, 0),
  auto_archive_events_days = COALESCE(auto_archive_events_days, 90),
  auto_archive_campaigns_days = COALESCE(auto_archive_campaigns_days, 90),
  updated_at = datetime('now')
WHERE
  auto_archive_enabled IS NULL
  OR auto_archive_events_days IS NULL
  OR auto_archive_campaigns_days IS NULL;

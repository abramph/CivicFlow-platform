/**
 * Embedded migrations for packaging. Kept in sync with src/db/migrations/*.sql
 */
const migrations = [
  {
    id: '001_initial_schema',
    sql: `-- Civicflow initial schema per spec
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  category_id INTEGER REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('dues', 'donation', 'expense')),
  amount_cents INTEGER NOT NULL,
  occurred_on TEXT NOT NULL,
  member_id INTEGER REFERENCES members(id),
  event_id INTEGER REFERENCES events(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_members_category ON members(category_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_transactions_occurred ON transactions(occurred_on);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_member ON transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_campaigns_dates ON campaigns(start_date, end_date);`,
  },
  {
    id: '002_seed_initial',
    sql: `INSERT OR IGNORE INTO categories (name) VALUES ('General'), ('Premium');

INSERT INTO members (first_name, last_name, email, status, category_id)
SELECT 'Sample', 'Member', 'sample@example.com', 'active', (SELECT id FROM categories LIMIT 1)
WHERE (SELECT COUNT(*) FROM members) = 0;

INSERT INTO events (name, date, location, notes)
SELECT 'Sample Event', date('now', '+7 days'), 'Main Hall', 'Welcome event'
WHERE (SELECT COUNT(*) FROM events) = 0;

INSERT INTO campaigns (name, start_date, end_date, notes)
SELECT 'Sample Campaign', date('now'), date('now', '+90 days'), 'Initial campaign'
WHERE (SELECT COUNT(*) FROM campaigns) = 0;

INSERT INTO transactions (type, amount_cents, occurred_on, member_id, note)
SELECT 'dues', 2500, date('now', '-7 days'), (SELECT id FROM members LIMIT 1), 'Sample dues'
WHERE (SELECT COUNT(*) FROM transactions) = 0;

INSERT INTO transactions (type, amount_cents, occurred_on, member_id, note)
SELECT 'donation', 5000, date('now', '-3 days'), (SELECT id FROM members LIMIT 1), 'Sample donation'
WHERE (SELECT COUNT(*) FROM transactions) = 1;

INSERT INTO transactions (type, amount_cents, occurred_on, note)
SELECT 'expense', -1500, date('now', '-1 days'), 'Sample expense'
WHERE (SELECT COUNT(*) FROM transactions) = 2;`,
  },
  {
    id: '003_dues_organization_logo',
    sql: `-- Organization (singleton) for logo_path
CREATE TABLE IF NOT EXISTS organization (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  logo_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO organization (id, name) VALUES (1, 'Civicflow');

-- Categories: monthly dues
ALTER TABLE categories ADD COLUMN monthly_dues_cents INTEGER NOT NULL DEFAULT 0;

-- Members: join date for dues accrual
ALTER TABLE members ADD COLUMN join_date TEXT;

-- Transactions: allow dues_payment type (recreate table with new CHECK)
CREATE TABLE IF NOT EXISTS transactions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('dues', 'donation', 'expense', 'dues_payment')),
  amount_cents INTEGER NOT NULL,
  occurred_on TEXT NOT NULL,
  member_id INTEGER REFERENCES members(id),
  event_id INTEGER REFERENCES events(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO transactions_new SELECT id, type, amount_cents, occurred_on, member_id, event_id, campaign_id, note, created_at, updated_at FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;
CREATE INDEX IF NOT EXISTS idx_transactions_occurred ON transactions(occurred_on);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_member ON transactions(member_id);`,
  },
  {
    id: '004_campaign_goal_members_location',
    sql: `-- Campaign goal amount
ALTER TABLE campaigns ADD COLUMN goal_amount_cents INTEGER NOT NULL DEFAULT 0;

-- Members location fields
ALTER TABLE members ADD COLUMN city TEXT;
ALTER TABLE members ADD COLUMN state TEXT;
ALTER TABLE members ADD COLUMN zip TEXT;

CREATE INDEX IF NOT EXISTS idx_members_city ON members(city);
CREATE INDEX IF NOT EXISTS idx_members_zip ON members(zip);
CREATE INDEX IF NOT EXISTS idx_members_state ON members(state);`,
  },
  {
    id: '005_organization_settings_setup',
    sql: `-- Organization settings for setup wizard and email
CREATE TABLE IF NOT EXISTS organization_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  organization_name TEXT,
  logo_path TEXT,
  email_from_name TEXT,
  email_from_address TEXT,
  setup_completed INTEGER NOT NULL DEFAULT 0,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_user TEXT,
  smtp_pass TEXT,
  smtp_secure INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO organization_settings (id, setup_completed) VALUES (1, 0);`,
  },
  {
    id: '006_contributor_fields',
    sql: `-- Non-member contributions: contributor_name, contributor_email
ALTER TABLE transactions ADD COLUMN contributor_name TEXT;
ALTER TABLE transactions ADD COLUMN contributor_email TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_campaign ON transactions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_transactions_event ON transactions(event_id);`,
  },
  {
    id: '007_issued_keys',
    sql: `-- Issued activation keys (valid keys that can be activated by users)
CREATE TABLE IF NOT EXISTS issued_keys (
  key TEXT PRIMARY KEY,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_to TEXT,
  used_at TEXT,
  activated_machine_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_issued_keys_key ON issued_keys(key);`,
  },
  {
    id: '008_license_info',
    sql: `-- Node-locked licensing: key bound to machine_id
CREATE TABLE IF NOT EXISTS license_info (
  key TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  activated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_license_info_machine ON license_info(machine_id);`,
  },
  {
    id: '009_add_dob_to_members',
    sql: `-- Add Date of Birth (DOB) as optional field to members table
ALTER TABLE members ADD COLUMN dob DATE NULL;`,
  },
  {
    id: '010_meetings_attendance',
    sql: `-- Create meetings table for general meetings
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create attendance table to track member attendance at meetings
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  attended BOOLEAN NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(member_id, meeting_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_member ON attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_meeting ON attendance(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);`,
  },
  {
    id: '011_expenditures',
    sql: `-- Create expenditures table for tracking organizational spending
CREATE TABLE IF NOT EXISTS expenditures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,

  payee_type TEXT,              -- 'member' or 'vendor'
  payee_member_id INTEGER,      -- nullable
  payee_name TEXT,              -- for vendors or manual entry

  source_type TEXT DEFAULT 'organization',  -- 'organization' | 'event' | 'campaign'
  source_id INTEGER,            -- nullable

  payment_method TEXT,
  status TEXT DEFAULT 'paid',

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expenditures_date ON expenditures(date);
CREATE INDEX IF NOT EXISTS idx_expenditures_category ON expenditures(category);
CREATE INDEX IF NOT EXISTS idx_expenditures_payee_member ON expenditures(payee_member_id);
CREATE INDEX IF NOT EXISTS idx_expenditures_source ON expenditures(source_type, source_id);`,
  },
  {
    id: '012_license_system',
    sql: `-- License system for TRIAL and PRO licenses
CREATE TABLE IF NOT EXISTS license (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_name TEXT NOT NULL,
  license_type TEXT NOT NULL,    -- TRIAL | PRO
  expires TEXT NOT NULL,         -- YYYY-MM-DD or PERPETUAL
  device_id TEXT NOT NULL,
  slot INTEGER NOT NULL,         -- 1 or 2
  key TEXT NOT NULL,
  activated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_license_device ON license(device_id);
CREATE INDEX IF NOT EXISTS idx_license_type ON license(license_type);
CREATE INDEX IF NOT EXISTS idx_license_org ON license(org_name);`,
  },
  {
    id: '013_grants',
    sql: `-- Grants module for upgrade tier
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_name TEXT NOT NULL,
  funder_name TEXT,
  amount_requested REAL,
  amount_awarded REAL,
  status TEXT CHECK (
    status IN ('Draft','Submitted','Awarded','Denied','Closed')
  ) DEFAULT 'Draft',
  start_date TEXT,
  end_date TEXT,
  reporting_due_date TEXT,
  notes TEXT,
  is_sample INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grant_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id INTEGER NOT NULL,
  report_type TEXT CHECK (
    report_type IN ('Interim','Final')
  ),
  due_date TEXT,
  submitted INTEGER DEFAULT 0,
  submitted_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grant_id) REFERENCES grants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_grants_status ON grants(status);
CREATE INDEX IF NOT EXISTS idx_grants_archived ON grants(archived);
CREATE INDEX IF NOT EXISTS idx_grants_sample ON grants(is_sample);
CREATE INDEX IF NOT EXISTS idx_grant_reports_grant ON grant_reports(grant_id);
CREATE INDEX IF NOT EXISTS idx_grant_reports_due ON grant_reports(due_date);`,
  },
  {
    id: '014_grants_seed_sample',
    sql: `-- Seed sample grants data (is_sample = 1)
INSERT INTO grants (grant_name, funder_name, amount_requested, amount_awarded, status, start_date, end_date, reporting_due_date, notes, is_sample)
SELECT 'Sample Community Grant', 'Sample Foundation', 50000.00, 45000.00, 'Awarded', date('now', '-30 days'), date('now', '+335 days'), date('now', '+60 days'), 'This is a sample grant for demonstration purposes.', 1
WHERE (SELECT COUNT(*) FROM grants WHERE is_sample = 1) = 0;

INSERT INTO grant_reports (grant_id, report_type, due_date, submitted, notes)
SELECT (SELECT id FROM grants WHERE is_sample = 1 LIMIT 1), 'Interim', date('now', '+60 days'), 0, 'Sample interim report'
WHERE (SELECT COUNT(*) FROM grant_reports WHERE grant_id = (SELECT id FROM grants WHERE is_sample = 1 LIMIT 1)) = 0
  AND (SELECT COUNT(*) FROM grants WHERE is_sample = 1) > 0;`,
  },
  {
    id: '015_membership_periods',
    sql: `-- Track each distinct membership run for a member
CREATE TABLE IF NOT EXISTS membership_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL CHECK(status IN ('Active','Inactive','Terminated','Reinstated')) DEFAULT 'Active',
  termination_reason TEXT,
  reinstated_from_period_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_membership_periods_member ON membership_periods(member_id);
CREATE INDEX IF NOT EXISTS idx_membership_periods_status ON membership_periods(status);
CREATE INDEX IF NOT EXISTS idx_membership_periods_dates ON membership_periods(start_date, end_date);`,
  },
  {
    id: '016_financial_transactions_ledger',
    sql: `-- Immutable financial ledger for all payments/dues/contributions
CREATE TABLE IF NOT EXISTS financial_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  membership_period_id INTEGER,
  txn_type TEXT NOT NULL CHECK(txn_type IN ('DUES','CONTRIBUTION','INVOICE','RECEIPT','ADJUSTMENT','REVERSAL')) DEFAULT 'DUES',
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  txn_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('POSTED','VOIDED')) DEFAULT 'POSTED',
  related_txn_id INTEGER,
  reference TEXT,
  notes TEXT,
  created_by_user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (membership_period_id) REFERENCES membership_periods(id),
  FOREIGN KEY (related_txn_id) REFERENCES financial_transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_fin_txn_member ON financial_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_fin_txn_period ON financial_transactions(membership_period_id);
CREATE INDEX IF NOT EXISTS idx_fin_txn_type ON financial_transactions(txn_type);
CREATE INDEX IF NOT EXISTS idx_fin_txn_status ON financial_transactions(status);
CREATE INDEX IF NOT EXISTS idx_fin_txn_date ON financial_transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_fin_txn_related ON financial_transactions(related_txn_id);`,
  },
  {
    id: '017_audit_logs',
    sql: `-- Record critical actions (status changes, reversals, emails)
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  metadata_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs(created_at);`,
  },
  {
    id: '018_email_system',
    sql: `-- Email settings (local config; password stored via OS keychain reference)
CREATE TABLE IF NOT EXISTS email_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL CHECK(provider IN ('SMTP')) DEFAULT 'SMTP',
  from_name TEXT,
  from_email TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure INTEGER DEFAULT 0,
  smtp_user TEXT,
  smtp_password_ref TEXT,
  enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO email_settings (id) VALUES (1);

-- Email outbox (queue + delivery logging)
CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_type TEXT NOT NULL CHECK(email_type IN ('NOTICE','INVOICE','RECEIPT','FINANCIAL_REPORT')) DEFAULT 'NOTICE',
  to_emails TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT,
  body_text TEXT,
  attachments_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('QUEUED','SENT','FAILED')) DEFAULT 'QUEUED',
  error TEXT,
  created_by_user_id INTEGER,
  sent_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_type ON email_outbox(email_type);
CREATE INDEX IF NOT EXISTS idx_email_outbox_date ON email_outbox(created_at);`,
  },
  {
    id: '019_backfill_membership_periods',
    sql: `-- Backfill: create one Active membership_period per existing member that has none
INSERT INTO membership_periods (member_id, start_date, end_date, status)
SELECT m.id,
  COALESCE(m.join_date, date('now')),
  CASE WHEN m.status = 'inactive' THEN date('now') ELSE NULL END,
  CASE WHEN m.status = 'inactive' THEN 'Inactive' ELSE 'Active' END
FROM members m
WHERE NOT EXISTS (
  SELECT 1 FROM membership_periods mp WHERE mp.member_id = m.id
);`,
  },
  {
    id: '020_app_roles',
    sql: `-- Minimal role system for admin gating
CREATE TABLE IF NOT EXISTS app_roles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_role TEXT NOT NULL DEFAULT 'Admin' CHECK(current_role IN ('Admin','Viewer')),
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO app_roles (id, current_role) VALUES (1, 'Admin');`,
  },
  {
    id: '021_import_tracking',
    sql: `-- Add is_imported flag to tables that support bulk import
ALTER TABLE financial_transactions ADD COLUMN is_imported INTEGER DEFAULT 0;
ALTER TABLE grants ADD COLUMN is_imported INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN is_imported INTEGER DEFAULT 0;
ALTER TABLE transactions ADD COLUMN is_imported INTEGER DEFAULT 0;`,
  },
  {
    id: '022_import_runs',
    sql: `-- Import run tracking
CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT,
  total_rows INTEGER DEFAULT 0,
  inserted_rows INTEGER DEFAULT 0,
  updated_rows INTEGER DEFAULT 0,
  skipped_rows INTEGER DEFAULT 0,
  error_rows INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('PREVIEW','COMPLETED','FAILED')) DEFAULT 'PREVIEW',
  errors_json TEXT,
  created_by_user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Optional linkage for imported financial ledger entries
ALTER TABLE financial_transactions ADD COLUMN import_run_id INTEGER;`,
  },
  {
    id: '023_financial_soft_delete_org_email',
    sql: `-- Soft delete fields for financial transactions
ALTER TABLE financial_transactions ADD COLUMN is_deleted INTEGER DEFAULT 0;
ALTER TABLE financial_transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE financial_transactions ADD COLUMN deleted_by TEXT;

-- Organization email sender fields
ALTER TABLE organization ADD COLUMN email_display_name TEXT;
ALTER TABLE organization ADD COLUMN email_from_address TEXT;`,
  },
  {
    id: '024_transactions_soft_delete_org',
    sql: `-- Add soft delete + organization scoping for transactions
ALTER TABLE transactions ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE transactions ADD COLUMN deleted_by TEXT;
ALTER TABLE transactions ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_transactions_org ON transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_is_deleted ON transactions(is_deleted);`,
  },
  {
    id: '025_organization_payments_enabled',
    sql: `-- Optional online payments flag
ALTER TABLE organization ADD COLUMN payments_enabled INTEGER DEFAULT 0;`,
  },
  {
    id: '026_organization_stripe_account',
    sql: `-- Organization Stripe Connect account id
ALTER TABLE organization ADD COLUMN stripe_account_id TEXT;`,
  },
  {
    id: '027_member_stripe_subscription',
    sql: `-- Members: Stripe subscription id for AutoPay management
ALTER TABLE members ADD COLUMN stripe_subscription_id TEXT;`,
  },
  {
    id: '028_member_autopay_status',
    sql: `-- Members: AutoPay status tracking
ALTER TABLE members ADD COLUMN autopay_status TEXT DEFAULT 'NONE';
ALTER TABLE members ADD COLUMN autopay_updated_at TEXT;`,
  },
  {
    id: '029_members_org_scope',
    sql: `-- Members: organization scoping for multi-org safety
ALTER TABLE members ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1;
UPDATE members SET organization_id = 1 WHERE organization_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_members_org ON members(organization_id);`,
  },
  {
    id: '030_external_payment_methods',
    sql: `-- Transactions: external payment verification fields
ALTER TABLE transactions ADD COLUMN payment_method TEXT;
ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'COMPLETED';
ALTER TABLE transactions ADD COLUMN proof_url TEXT;

-- Organization: external payment contacts
ALTER TABLE organization ADD COLUMN cashapp_handle TEXT;
ALTER TABLE organization ADD COLUMN zelle_contact TEXT;`,
  },
  {
    id: '031_add_venmo_handle',
    sql: `-- Organization: Venmo handle for external payments
ALTER TABLE organization ADD COLUMN venmo_handle TEXT;`,
  },
  {
    id: '032_transactions_payment_fields',
    sql: `-- Transactions: unify payment fields
ALTER TABLE transactions ADD COLUMN source TEXT;
ALTER TABLE transactions ADD COLUMN reference TEXT;`,
  },
  {
    id: '033_campaign_event_active',
    sql: `-- Campaigns + Events: soft archive flag
ALTER TABLE campaigns ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
UPDATE campaigns SET is_active = 1 WHERE is_active IS NULL;
UPDATE events SET is_active = 1 WHERE is_active IS NULL;`,
  },
  {
    id: '034_transactions_payment_method_backfill',
    sql: `-- Transactions: backfill legacy rows with missing payment methods
UPDATE transactions
SET payment_method = 'STRIPE'
WHERE payment_method IS NULL
  AND COALESCE(note, '') LIKE '%Stripe%';

UPDATE transactions
SET payment_method = 'CASH'
WHERE payment_method IS NULL;`,
  },
  {
    id: '035_general_contribution_member',
    sql: `-- System member for orphan transactions
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
WHERE member_id IS NULL;`,
  },
  {
    id: '036_contributor_type',
    sql: `-- Transactions: contributor type for non-member, campaign, and event revenue
ALTER TABLE transactions ADD COLUMN contributor_type TEXT DEFAULT 'MEMBER';

UPDATE transactions
SET contributor_type = CASE
  WHEN member_id IS NOT NULL THEN 'MEMBER'
  WHEN campaign_id IS NOT NULL THEN 'CAMPAIGN_REVENUE'
  WHEN event_id IS NOT NULL THEN 'EVENT_REVENUE'
  ELSE 'NON_MEMBER'
END
WHERE contributor_type IS NULL;`,
  },
  {
    id: '037_transaction_type',
    sql: `-- Transactions: standardized transaction type classification
ALTER TABLE transactions ADD COLUMN transaction_type TEXT DEFAULT 'DONATION';

UPDATE transactions
SET transaction_type = CASE
  WHEN campaign_id IS NOT NULL THEN 'CAMPAIGN_CONTRIBUTION'
  WHEN event_id IS NOT NULL THEN 'EVENT_REVENUE'
  WHEN type IN ('dues', 'dues_payment') THEN 'DUES'
  WHEN type = 'donation' THEN 'DONATION'
  ELSE 'OTHER_INCOME'
END
WHERE transaction_type IS NULL OR transaction_type = '';`,
  },
  {
    id: '038_org_auto_archive_settings',
    sql: `-- Organization: auto-archive options for completed events/campaigns
ALTER TABLE organization ADD COLUMN auto_archive_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organization ADD COLUMN auto_archive_events_days INTEGER NOT NULL DEFAULT 90;
ALTER TABLE organization ADD COLUMN auto_archive_campaigns_days INTEGER NOT NULL DEFAULT 90;`,
  },
  {
    id: '039_payment_submissions',
    sql: `-- Hybrid payment confirmation sync table
CREATE TABLE IF NOT EXISTS payment_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER,
  invoice_id INTEGER,
  method TEXT,
  amount REAL,
  paid_date TEXT,
  note TEXT,
  screenshot_path TEXT,
  status TEXT DEFAULT 'PENDING_VERIFICATION',
  source TEXT DEFAULT 'LOCAL',
  cloud_id TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_status ON payment_submissions(status);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_member ON payment_submissions(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_submissions_cloud_id_unique ON payment_submissions(cloud_id);
`,
  },
  {
    id: '040_remove_general_contribution_and_enforce_links',
    sql: `-- Cleanup legacy General Contribution records and enforce attribution integrity
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
ON transactions(member_id, event_id, campaign_id, contributor_type);`,
  },
];

module.exports = { migrations };

-- Allow DUES_REMINDER rows in email outbox
CREATE TABLE IF NOT EXISTS email_outbox_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_type TEXT NOT NULL CHECK(email_type IN ('NOTICE','INVOICE','RECEIPT','FINANCIAL_REPORT','DUES_REMINDER')) DEFAULT 'NOTICE',
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

INSERT INTO email_outbox_new (
  id, email_type, to_emails, subject, body_html, body_text,
  attachments_json, status, error, created_by_user_id, sent_at, created_at
)
SELECT
  id, email_type, to_emails, subject, body_html, body_text,
  attachments_json, status, error, created_by_user_id, sent_at, created_at
FROM email_outbox;

DROP TABLE email_outbox;
ALTER TABLE email_outbox_new RENAME TO email_outbox;

CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_type ON email_outbox(email_type);
CREATE INDEX IF NOT EXISTS idx_email_outbox_date ON email_outbox(created_at);

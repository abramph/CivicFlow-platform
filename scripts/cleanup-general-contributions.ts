/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

function resolveDefaultDbPath() {
  const appData = process.env.APPDATA || '';
  if (!appData) return null;
  return path.join(appData, 'CivicFlow', 'Civicflow', 'app.db');
}

function parseDbPathArg() {
  const explicit = process.argv.find((arg) => arg.startsWith('--db='));
  if (explicit) return explicit.slice('--db='.length).trim();
  return process.env.CIVICFLOW_DB_PATH || resolveDefaultDbPath();
}

function run() {
  const dbPath = parseDbPathArg();
  if (!dbPath) {
    throw new Error('Could not determine DB path. Pass --db=<absolute-path> or set CIVICFLOW_DB_PATH.');
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at: ${dbPath}`);
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const hasPaymentSubmissions = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_submissions'")
    .get();

  const summary = db.transaction(() => {
    const rows = db.prepare(`
      SELECT t.id, t.amount_cents
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      WHERE UPPER(COALESCE(t.transaction_type, '')) = 'GENERAL_CONTRIBUTION'
         OR UPPER(COALESCE(t.type, '')) = 'GENERAL_CONTRIBUTION'
         OR (
           LOWER(COALESCE(m.first_name, '')) = 'general'
           AND LOWER(COALESCE(m.last_name, '')) = 'contribution'
         )
    `).all();

    const ids = rows.map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0);
    const count = ids.length;
    const totalCents = rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);

    let paymentSubmissionsDeleted = 0;
    if (count > 0) {
      const placeholders = ids.map(() => '?').join(',');
      if (hasPaymentSubmissions) {
        paymentSubmissionsDeleted = db.prepare(`DELETE FROM payment_submissions WHERE invoice_id IN (${placeholders})`).run(...ids).changes;
      }
      db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);
    }

    const orphanSubmissionCleanup = hasPaymentSubmissions
      ? db.prepare(`
          DELETE FROM payment_submissions
          WHERE invoice_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = payment_submissions.invoice_id)
        `).run().changes
      : 0;

    const removedLegacyMembers = db.prepare(`
      DELETE FROM members
      WHERE LOWER(COALESCE(first_name, '')) = 'general'
        AND LOWER(COALESCE(last_name, '')) = 'contribution'
    `).run().changes;

    return {
      count,
      totalCents,
      paymentSubmissionsDeleted,
      orphanSubmissionCleanup,
      removedLegacyMembers,
    };
  })();

  const dollars = (summary.totalCents / 100).toFixed(2);
  console.log('Cleanup complete');
  console.log(`- Transactions removed: ${summary.count}`);
  console.log(`- Total value removed: $${dollars}`);
  console.log(`- Related payment submissions removed: ${summary.paymentSubmissionsDeleted}`);
  console.log(`- Orphan payment submissions removed: ${summary.orphanSubmissionCleanup}`);
  console.log(`- Legacy General Contribution members removed: ${summary.removedLegacyMembers}`);

  db.close();
}

run();

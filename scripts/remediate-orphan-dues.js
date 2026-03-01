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

function normalizeSpaces(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return normalizeSpaces(value)
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function buildMemberIndexes(members) {
  const byEmail = new Map();
  const byName = new Map();

  for (const member of members) {
    const memberId = Number(member.id || 0);
    if (!memberId) continue;

    const email = normalizeEmail(member.email);
    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(member);
    }

    const first = normalizeSpaces(member.first_name);
    const last = normalizeSpaces(member.last_name);
    const full = normalizeName(`${first} ${last}`);
    const reversed = normalizeName(`${last} ${first}`);
    const comma = normalizeName(`${last}, ${first}`);

    for (const key of [full, reversed, comma]) {
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(member);
    }
  }

  return { byEmail, byName };
}

function chooseMemberMatch(txn, indexes) {
  const contributorEmail = normalizeEmail(txn.contributor_email);
  const contributorName = normalizeName(txn.contributor_name);

  const emailCandidates = contributorEmail ? (indexes.byEmail.get(contributorEmail) || []) : [];
  if (emailCandidates.length === 1) {
    return { member: emailCandidates[0], strategy: 'email' };
  }

  const nameCandidates = contributorName ? (indexes.byName.get(contributorName) || []) : [];
  if (nameCandidates.length === 1) {
    return { member: nameCandidates[0], strategy: 'name' };
  }

  if (emailCandidates.length > 1) {
    return { member: null, strategy: 'ambiguous_email', candidates: emailCandidates };
  }
  if (nameCandidates.length > 1) {
    return { member: null, strategy: 'ambiguous_name', candidates: nameCandidates };
  }

  return { member: null, strategy: 'unmatched', candidates: [] };
}

function createBackup(dbPath) {
  const dir = path.dirname(dbPath);
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const backupPath = path.join(dir, `app-backup-before-dues-remediation-${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function run() {
  const dbPath = parseDbPathArg();
  if (!dbPath) {
    throw new Error('Could not determine DB path. Pass --db=<absolute-path> or set CIVICFLOW_DB_PATH.');
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at: ${dbPath}`);
  }

  const backupPath = createBackup(dbPath);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const members = db.prepare(`
    SELECT id, first_name, last_name, email
    FROM members
  `).all();

  const orphanDuesRows = db.prepare(`
    SELECT
      t.id,
      t.amount_cents,
      t.occurred_on,
      t.transaction_type,
      t.type,
      t.member_id,
      t.contributor_type,
      t.contributor_name,
      t.contributor_email,
      t.reference,
      t.note
    FROM transactions t
    WHERE UPPER(COALESCE(t.transaction_type, t.type, '')) = 'DUES'
      AND COALESCE(t.is_deleted, 0) = 0
      AND UPPER(COALESCE(t.status, 'COMPLETED')) = 'COMPLETED'
      AND (
        t.member_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM members m WHERE m.id = t.member_id)
      )
    ORDER BY date(COALESCE(t.occurred_on, t.created_at)) DESC, t.id DESC
  `).all();

  const indexes = buildMemberIndexes(members);

  const updates = [];
  const unresolved = [];

  for (const row of orphanDuesRows) {
    const match = chooseMemberMatch(row, indexes);
    if (match.member?.id) {
      updates.push({
        txnId: Number(row.id),
        memberId: Number(match.member.id),
        strategy: match.strategy,
        contributorName: row.contributor_name || null,
        contributorEmail: row.contributor_email || null,
      });
    } else {
      unresolved.push({
        txnId: Number(row.id),
        occurred_on: row.occurred_on || null,
        amount_cents: Number(row.amount_cents || 0),
        contributor_name: row.contributor_name || null,
        contributor_email: row.contributor_email || null,
        strategy: match.strategy,
        candidateCount: Array.isArray(match.candidates) ? match.candidates.length : 0,
      });
    }
  }

  let updatedCount = 0;
  const updateById = db.prepare(`
    UPDATE transactions
    SET member_id = ?,
        contributor_type = 'MEMBER',
        updated_at = datetime('now')
    WHERE id = ?
  `);

  const applyUpdates = db.transaction(() => {
    for (const item of updates) {
      const result = updateById.run(item.memberId, item.txnId);
      updatedCount += Number(result.changes || 0);
    }
  });

  applyUpdates();

  const totalRemediatedCents = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM transactions
    WHERE id IN (${updates.length ? updates.map(() => '?').join(',') : '0'})
  `).get(...updates.map((u) => u.txnId))?.total || 0;

  console.log('Dues orphan remediation complete');
  console.log(`- Database: ${dbPath}`);
  console.log(`- Backup created: ${backupPath}`);
  console.log(`- Orphan dues found: ${orphanDuesRows.length}`);
  console.log(`- Auto-linked dues: ${updatedCount}`);
  console.log(`- Auto-linked total: $${(Number(totalRemediatedCents || 0) / 100).toFixed(2)}`);
  console.log(`- Unresolved dues: ${unresolved.length}`);

  if (updates.length > 0) {
    const strategySummary = updates.reduce((acc, item) => {
      const key = item.strategy || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    console.log(`- Match strategies: ${JSON.stringify(strategySummary)}`);
  }

  if (unresolved.length > 0) {
    const unresolvedPath = path.join(path.dirname(dbPath), `dues-remediation-unresolved-${Date.now()}.json`);
    fs.writeFileSync(unresolvedPath, JSON.stringify(unresolved, null, 2), 'utf8');
    console.log(`- Unresolved details saved: ${unresolvedPath}`);
  }

  db.close();
}

run();

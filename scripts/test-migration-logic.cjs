// Dry-run the migration import logic against the generated export JSON.
// Validates all records parse correctly and shows exactly what would be imported.

const fs = require('fs');

const data = JSON.parse(fs.readFileSync('C:/Users/abram/Downloads/civicflow_migration_test.json', 'utf-8'));

function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const LEDGER_INCOME = new Set(['receipt', 'contribution']);
const errors = [];
let warn = 0;

console.log('=== Migration dry-run ===\n');
console.log('Schema:', data.schema);
console.log('Exported:', data.exportedAt);
console.log('Org:', data.organizationName);
console.log('');

// Members
let memberOk = 0, memberSkip = 0;
for (const m of data.members ?? []) {
  if (!m.first_name && !m.last_name) { memberSkip++; continue; }
  memberOk++;
  console.log(`  Member [${m.id}] ${m.first_name} ${m.last_name} | email=${m.email||'—'} address=${m.address||'—'} city=${m.city||'—'} status=${m.status||'—'}`);
}
console.log(`Members: ${memberOk} to import, ${memberSkip} skipped (no name)\n`);

// Transactions
let txnOk = 0, txnSkip = 0;
for (const t of data.transactions ?? []) {
  const type = String(t.type ?? '').toLowerCase().trim();
  if (type === 'expense' || t.is_deleted) { txnSkip++; continue; }
  const amount = (t.amount_cents ?? 0) / 100;
  if (amount <= 0) { errors.push('txn id=' + t.id + ': non-positive amount ' + amount); continue; }
  const date = toDate(t.occurred_on);
  if (!date) { errors.push('txn id=' + t.id + ': bad date ' + t.occurred_on); continue; }
  const tag = (type === 'dues' || type === 'dues_payment') ? '[DUES]' : '[DON]';
  console.log(`  Txn ${tag} id=${t.id} $${amount.toFixed(2)} on ${t.occurred_on} member_id=${t.member_id||'—'} note=${t.note||'—'}`);
  txnOk++;
}
console.log(`Transactions: ${txnOk} to import, ${txnSkip} skipped (expense/deleted)\n`);

// Financial transactions
let ftOk = 0;
for (const t of data.financialTransactions ?? []) {
  const type = String(t.txn_type ?? '').toLowerCase().trim();
  if (!LEDGER_INCOME.has(type)) continue;
  const amount = Number(t.amount);
  if (!isFinite(amount) || amount <= 0) continue;
  if (!toDate(t.txn_date)) continue;
  console.log(`  FT [${t.txn_type}] id=${t.id} $${amount.toFixed(2)} on ${t.txn_date}`);
  ftOk++;
}
if (ftOk > 0) console.log(`Financial ledger: ${ftOk} to import\n`);

// Categories
console.log(`Categories: ${(data.categories ?? []).filter(c => c.name?.trim()).length} to upsert`);
console.log(`Events: ${(data.events ?? []).filter(e => e.name?.trim()).length}`);
console.log(`Campaigns: ${(data.campaigns ?? []).filter(c => c.name?.trim()).length}`);
console.log(`Meetings: ${(data.meetings ?? []).filter(m => m.title?.trim() && toDate(m.meeting_date)).length}`);
console.log(`Expenditures: ${(data.expenditures ?? []).filter(e => e.description?.trim() && toDate(e.date) && Number(e.amount) > 0).length}`);

console.log('');
if (errors.length) {
  console.log('ERRORS (' + errors.length + '):');
  errors.forEach(e => console.log('  ✗ ' + e));
} else {
  console.log('No errors — export looks clean and ready to upload.');
}

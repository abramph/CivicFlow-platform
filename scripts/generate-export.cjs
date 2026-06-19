const Database = require('../civicflow-portal/node_modules/better-sqlite3');
const fs = require('fs');

const DB_PATH = process.argv[2] || 'C:/Users/abram/OneDrive/Documents/civicflow-backup-20260223-184231.db';
console.log('Source DB:', DB_PATH);

const db = new Database(DB_PATH, { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);

const get = (sql) => { try { return db.prepare(sql).all(); } catch(e) { console.warn('  skip:', e.message.split('\n')[0]); return []; } };

const org = tables.includes('organization') ? db.prepare('SELECT name FROM organization LIMIT 1').get() : null;
const members = get('SELECT * FROM members');
const categories = get('SELECT * FROM categories');
const events = get('SELECT * FROM events');
const campaigns = get('SELECT * FROM campaigns');
const meetings = get('SELECT * FROM meetings');
const attendance = get('SELECT * FROM attendance');

const transactions = (() => {
  if (!tables.includes('transactions')) return [];
  const cols = db.prepare('PRAGMA table_info(transactions)').all().map(c => c.name);
  const where = cols.includes('is_deleted') ? 'WHERE COALESCE(is_deleted,0)=0' : '';
  return get('SELECT * FROM transactions ' + where);
})();

const financialTransactions = (() => {
  if (!tables.includes('financial_transactions')) return [];
  const ftCols = db.prepare('PRAGMA table_info(financial_transactions)').all().map(c => c.name);
  const pick = ['id','member_id','membership_period_id','txn_type','amount','txn_date','reference','notes','campaign_id','event_id'].filter(c => ftCols.includes(c));
  const statusWhere = ftCols.includes('status') ? "WHERE COALESCE(status,'POSTED')='POSTED'" : '';
  return get('SELECT ' + pick.join(',') + ' FROM financial_transactions ' + statusWhere);
})();

const expenditures = tables.includes('expenditures') ? get('SELECT * FROM expenditures') : [];

db.close();

const payload = {
  version: 1,
  schema: 'civicflow-desktop-export',
  exportedAt: new Date().toISOString(),
  organizationName: org?.name || '',
  members, categories, events, campaigns, meetings, attendance,
  transactions, financialTransactions, expenditures,
};

const outPath = 'C:/Users/abram/Downloads/civicflow_migration_real.json';
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
console.log('Export written to:', outPath);
console.log('');
console.log('Summary:');
console.log('  org:', org?.name);
console.log('  members:', members.length);
console.log('  categories:', categories.length);
console.log('  events:', events.length);
console.log('  campaigns:', campaigns.length);
console.log('  meetings:', meetings.length);
console.log('  transactions:', transactions.length, JSON.stringify(transactions.reduce((a,t)=>{ a[t.type]=(a[t.type]||0)+1; return a; }, {})));
console.log('  financialTransactions:', financialTransactions.length);
console.log('  expenditures:', expenditures.length);

const Database = require('../civicflow-portal/node_modules/better-sqlite3');
const db = new Database('C:/Users/abram/AppData/Roaming/CivicFlow/Civicflow/app.db', { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);
console.log('Tables:', tables.join(', '));
console.log('');

for (const t of tables) {
  try {
    const n = db.prepare('SELECT COUNT(*) as n FROM [' + t + ']').get().n;
    console.log(t + ': ' + n + ' rows');
  } catch(e) {
    console.log(t + ': ERR ' + e.message);
  }
}

if (tables.includes('transactions')) {
  console.log('');
  const types = db.prepare('SELECT type, COUNT(*) as n FROM transactions GROUP BY type').all();
  console.log('transaction types:', JSON.stringify(types));
}
if (tables.includes('financial_transactions')) {
  const ft = db.prepare('SELECT txn_type, COUNT(*) as n FROM financial_transactions GROUP BY txn_type').all();
  console.log('financial_transaction types:', JSON.stringify(ft));
}

console.log('');
const members = db.prepare('SELECT id, first_name, last_name, email, address, city, state, zip FROM members LIMIT 5').all();
console.log('sample members:', JSON.stringify(members, null, 2));

db.close();

const Database = require('../civicflow-portal/node_modules/better-sqlite3');

const dbs = [
  'C:/Users/abram/AppData/Roaming/Electron/Civicflow/app.db',
  'C:/Users/abram/AppData/Roaming/my-cbo-app/cbo-data/cbo.db',
  'C:/Users/abram/AppData/Roaming/my-cbo-app/cbo.db',
  'C:/Users/abram/OneDrive/Documents/civicflow-backup-20260223-145354.db',
  'C:/Users/abram/OneDrive/Documents/civicflow-backup-20260223-184231.db',
  'C:/Users/abram/AppData/Local/Temp/CivicFlowDevProfile/Civicflow/app.db',
];

const TRACKED = ['members','transactions','financial_transactions','expenditures','events','campaigns','membership_periods'];

for (const p of dbs) {
  try {
    const db = new Database(p, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    const counts = {};
    for (const t of TRACKED) {
      if (tables.includes(t)) {
        try { counts[t] = db.prepare('SELECT COUNT(*) as n FROM [' + t + ']').get().n; } catch {}
      }
    }
    const org = tables.includes('organization') ? db.prepare('SELECT name FROM organization LIMIT 1').get()?.name : '?';
    db.close();
    const label = p.split('/').slice(-3).join('/');
    console.log('\n' + label);
    console.log('  org:', org);
    console.log('  counts:', JSON.stringify(counts));
  } catch(e) {
    const label = p.split('/').slice(-3).join('/');
    console.log('\n' + label + ' — ERR: ' + e.message.split('\n')[0]);
  }
}

const test = require('node:test');
const assert = require('node:assert/strict');

const { ImportService } = require('../src/main/services/importService');

class FakeDb {
  constructor() {
    this.members = [
      {
        id: 1,
        first_name: 'Taylor',
        last_name: 'Member',
        email: 'member@example.com',
      },
    ];
    this.membershipPeriods = [
      {
        id: 1,
        member_id: 1,
        start_date: '2026-01-01',
        end_date: null,
        status: 'Active',
      },
    ];
    this.campaigns = [];
    this.transactions = [];
    this.importRuns = [];
    this.auditLogs = [];
    this.ids = {
      membershipPeriods: 1,
      campaigns: 0,
      transactions: 0,
      importRuns: 0,
      auditLogs: 0,
    };
  }

  transaction(fn) {
    return () => fn();
  }

  prepare(sql) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();

    return {
      get: (...args) => this._get(normalized, args),
      run: (...args) => this._run(normalized, args),
      all: (...args) => this._all(normalized, args),
    };
  }

  _get(sql, args) {
    if (sql.includes('SELECT id FROM members WHERE id = ?')) {
      const id = Number(args[0]);
      const member = this.members.find((row) => row.id === id);
      return member ? { id: member.id } : undefined;
    }

    if (sql.includes('SELECT id FROM members WHERE email = ? COLLATE NOCASE')) {
      const email = String(args[0] || '').toLowerCase();
      const member = this.members.find((row) => String(row.email || '').toLowerCase() === email);
      return member ? { id: member.id } : undefined;
    }

    if (sql.includes('SELECT id FROM membership_periods WHERE member_id = ? AND end_date IS NULL')) {
      const memberId = Number(args[0]);
      const period = this.membershipPeriods.find((row) => row.member_id === memberId && row.end_date == null);
      return period ? { id: period.id } : undefined;
    }

    if (sql.includes('SELECT id FROM campaigns WHERE name = ? COLLATE NOCASE')) {
      const name = String(args[0] || '').toLowerCase();
      const campaign = this.campaigns.find((row) => String(row.name || '').toLowerCase() === name);
      return campaign ? { id: campaign.id } : undefined;
    }

    return undefined;
  }

  _run(sql, args) {
    if (sql.startsWith('INSERT INTO membership_periods')) {
      const id = ++this.ids.membershipPeriods;
      this.membershipPeriods.push({
        id,
        member_id: Number(args[0]),
        start_date: args[1],
        end_date: args[2] ?? null,
        status: args[3] ?? 'Active',
      });
      return { lastInsertRowid: id };
    }

    if (sql.startsWith('INSERT INTO transactions')) {
      const id = ++this.ids.transactions;
      const isCampaignInsert = sql.includes('contributor_name');
      const row = isCampaignInsert
        ? {
            id,
            type: 'donation',
            transaction_type: args[0],
            amount_cents: args[1],
            occurred_on: args[2],
            member_id: args[3],
            contributor_type: args[4],
            campaign_id: args[5],
            note: args[6],
            contributor_name: args[7],
            contributor_email: args[8],
            payment_method: args[9],
            reference: args[10],
          }
        : {
            id,
            type: args[0],
            transaction_type: args[1],
            amount_cents: args[2],
            occurred_on: args[3],
            member_id: args[4],
            contributor_type: args[5],
            note: args[6],
            payment_method: args[7],
            reference: args[8],
          };
      this.transactions.push(row);
      return { lastInsertRowid: id };
    }

    if (sql.startsWith('INSERT INTO campaigns')) {
      const id = ++this.ids.campaigns;
      this.campaigns.push({
        id,
        name: args[0],
        start_date: args[1] ?? null,
        end_date: args[2] ?? null,
      });
      return { lastInsertRowid: id };
    }

    if (sql.startsWith('INSERT INTO import_runs')) {
      const id = ++this.ids.importRuns;
      this.importRuns.push({
        id,
        import_type: args[0],
        file_name: args[1],
        status: 'PREVIEW',
      });
      return { lastInsertRowid: id };
    }

    if (sql.startsWith('UPDATE import_runs SET status =')) {
      const importRunId = Number(args[5]);
      const row = this.importRuns.find((entry) => entry.id === importRunId);
      if (row) {
        row.status = 'COMPLETED';
        row.inserted_rows = args[0];
        row.updated_rows = args[1];
        row.skipped_rows = args[2];
        row.error_rows = args[3];
      }
      return { changes: row ? 1 : 0 };
    }

    if (sql.startsWith('INSERT INTO audit_logs')) {
      const id = ++this.ids.auditLogs;
      this.auditLogs.push({ id, action: args[0], entity_type: args[1], entity_id: args[2] });
      return { lastInsertRowid: id };
    }

    throw new Error(`Unhandled SQL run: ${sql}`);
  }

  _all() {
    return [];
  }
}

test('financial transaction import preserves formatted large amounts', () => {
  const db = new FakeDb();
  const service = new ImportService(db);
  const rows = [
    {
      __rowNum: 2,
      member_email: 'member@example.com',
      amount: '313,750.00',
      txn_date: '2026-05-19',
      txn_type: 'DUES',
      reference: 'FTX-1',
      notes: 'Imported dues',
    },
  ];
  const mapping = {
    member_email: 'member_email',
    amount: 'amount',
    txn_date: 'txn_date',
    txn_type: 'txn_type',
    reference: 'reference',
    notes: 'notes',
  };

  const preview = service.previewImport('financial_transactions', mapping, rows, { fileName: 'financial.csv' });
  assert.equal(preview.summary.errorCount, 0);

  const result = service.commitImport('financial_transactions', mapping, rows, { fileName: 'financial.csv' });
  assert.equal(result.ok, true);
  assert.equal(db.transactions[0].amount_cents, 31375000);
  assert.equal(db.transactions[0].reference, 'FTX-1');
});

test('campaign import preserves formatted contribution amounts and creates campaign', () => {
  const db = new FakeDb();
  const service = new ImportService(db);
  const rows = [
    {
      __rowNum: 2,
      campaign_name: 'Spring Fund',
      member_email: 'member@example.com',
      amount: '$1,250.50',
      txn_date: '2026-05-19',
      reference: 'CMP-1',
      notes: 'Imported campaign gift',
    },
  ];
  const mapping = {
    campaign_name: 'campaign_name',
    member_email: 'member_email',
    amount: 'amount',
    txn_date: 'txn_date',
    reference: 'reference',
    notes: 'notes',
  };

  const preview = service.previewImport('campaigns', mapping, rows, { fileName: 'campaigns.csv' });
  assert.equal(preview.summary.errorCount, 0);

  const result = service.commitImport('campaigns', mapping, rows, { fileName: 'campaigns.csv' });
  assert.equal(result.ok, true);
  assert.equal(db.campaigns[0].name, 'Spring Fund');
  assert.equal(db.transactions[0].amount_cents, 125050);
  assert.equal(db.transactions[0].reference, 'CMP-1');
});

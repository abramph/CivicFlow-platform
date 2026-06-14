/**
 * Focused regression harness for PDF report scoping.
 *
 * Usage:
 *   node scripts/report-pdf-scoping-harness.cjs
 */

const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath() {
          return process.cwd();
        },
        getAppPath() {
          return process.cwd();
        },
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { buildPeriodReportPDF } = require('../src/main/pdf-service.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createMockDb() {
  const calls = [];
  const member = {
    id: 7,
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    status: 'active',
    category_name: 'General',
  };
  const event = {
    id: 9,
    name: 'Town Hall',
    date: '2026-02-15',
    location: 'Civic Center',
  };
  const campaign = {
    id: 11,
    name: 'Spring Drive',
    start_date: '2026-02-01',
    end_date: '2026-03-31',
    goal_cents: 500000,
  };

  return {
    calls,
    prepare(sql) {
      return {
        get(...params) {
          calls.push({ mode: 'get', sql, params });
          if (sql.includes('FROM members m') && sql.includes('WHERE m.id = ?')) return member;
          if (sql.includes('FROM events') && sql.includes('WHERE id = ?')) return event;
          if (sql.includes('FROM campaigns') && sql.includes('WHERE id = ?')) return campaign;
          return null;
        },
        all(...params) {
          calls.push({ mode: 'all', sql, params });
          if (sql.includes('FROM transactions t')) {
            return [
              {
                occurred_on: '2026-02-10',
                amount_cents: 2500,
                transaction_type: 'DUES',
                first_name: 'Ada',
                last_name: 'Lovelace',
                campaign_name: null,
                event_name: null,
              },
            ];
          }
          if (sql.includes('FROM members m')) return [member];
          if (sql.includes('FROM campaigns')) return [campaign];
          return [];
        },
      };
    },
  };
}

async function runCase(label, reportRequest) {
  const db = createMockDb();
  const pdf = await buildPeriodReportPDF(db, '2026-02-01', '2026-02-28', reportRequest);
  assert(Buffer.isBuffer(pdf), `${label}: expected a PDF buffer`);
  return db.calls;
}

async function expectFailure(label, reportRequest, expectedMessage) {
  let error = null;
  try {
    await runCase(label, reportRequest);
  } catch (err) {
    error = err;
  }
  assert(error, `${label}: expected failure`);
  assert(
    String(error.message || '').includes(expectedMessage),
    `${label}: expected error containing "${expectedMessage}", got "${error.message}"`
  );
}

async function main() {
  const orgCalls = await runCase('org', {
    reportType: 'org_financial',
    title: 'Organization Financial Report',
  });
  const memberCalls = await runCase('member', {
    reportType: 'member_contribution',
    title: 'Member Contribution Report',
    memberId: 7,
  });
  const monthlyCalls = await runCase('monthly', {
    reportType: 'member_monthly',
    title: 'Member Monthly Statement',
    memberId: 7,
  });
  const eventCalls = await runCase('event', {
    reportType: 'event_contribution',
    title: 'Event Financial Report',
    eventId: 9,
  });
  const campaignCalls = await runCase('campaign', {
    reportType: 'campaign_contribution',
    title: 'Campaign Financial Report',
    campaignId: 11,
  });
  const rosterCalls = await runCase('roster', {
    reportType: 'roster_active',
    title: 'Active Roster Report',
  });

  const orgTxn = orgCalls.find((call) => call.sql.includes('FROM transactions t'));
  const memberTxn = memberCalls.find((call) => call.sql.includes('FROM transactions t'));
  const monthlyTxn = monthlyCalls.find((call) => call.sql.includes('FROM transactions t'));
  const eventTxn = eventCalls.find((call) => call.sql.includes('FROM transactions t'));
  const campaignTxn = campaignCalls.find((call) => call.sql.includes('FROM transactions t'));
  const rosterTxn = rosterCalls.find((call) => call.sql.includes('FROM transactions t'));
  const rosterMembers = rosterCalls.find((call) => call.sql.includes('FROM members m'));

  assert(orgTxn, 'org: expected transactions query');
  assert(!orgTxn.sql.includes('t.member_id = ?'), 'org: should not include member filter');
  assert(!orgTxn.sql.includes('t.event_id = ?'), 'org: should not include event filter');
  assert(!orgTxn.sql.includes('t.campaign_id = ?'), 'org: should not include campaign filter');

  assert(memberTxn && memberTxn.sql.includes('t.member_id = ?'), 'member: missing member filter');
  assert(memberTxn.params.at(-1) === 7, 'member: wrong member filter parameter');

  assert(monthlyTxn && monthlyTxn.sql.includes('t.member_id = ?'), 'monthly: missing member filter');
  assert(monthlyTxn.params.at(-1) === 7, 'monthly: wrong member filter parameter');

  assert(eventTxn && eventTxn.sql.includes('t.event_id = ?'), 'event: missing event filter');
  assert(eventTxn.params.at(-1) === 9, 'event: wrong event filter parameter');

  assert(campaignTxn && campaignTxn.sql.includes('t.campaign_id = ?'), 'campaign: missing campaign filter');
  assert(campaignTxn.params.at(-1) === 11, 'campaign: wrong campaign filter parameter');

  assert(!rosterTxn, 'roster: should not query transactions');
  assert(
    rosterMembers && rosterMembers.sql.includes("LOWER(COALESCE(m.status, 'active')) = 'active'"),
    'roster: missing active roster member filter'
  );

  await expectFailure(
    'member-missing-id',
    { reportType: 'member_contribution', title: 'Member Contribution Report' },
    'memberId'
  );
  await expectFailure(
    'event-missing-id',
    { reportType: 'event_contribution', title: 'Event Financial Report' },
    'eventId'
  );
  await expectFailure(
    'campaign-missing-id',
    { reportType: 'campaign_contribution', title: 'Campaign Financial Report' },
    'campaignId'
  );

  console.log('PDF report scoping harness passed');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

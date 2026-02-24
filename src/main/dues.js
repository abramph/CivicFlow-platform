/**
 * Dues calculation: expected vs paid, balance, delinquency.
 * Delinquent = balance <= -(2 * monthly_dues)
 */
const { getDatabase } = require('./db.js');

function getJoinOrCreated(member) {
  const d = member.join_date || member.created_at;
  if (!d) return new Date();
  return new Date(d);
}

function monthsBetween(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
}

/**
 * @param {number} memberId
 * @returns {{ monthsExpected, totalDuesExpectedCents, totalPaidCents, balanceCents, monthlyDuesCents, status: 'current'|'credit'|'past_due'|'delinquent', isDelinquent }}
 */
function calculateMemberDuesStatus(memberId) {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');

  const member = db
    .prepare(
      `SELECT m.id, m.join_date, m.created_at, m.category_id, c.monthly_dues_cents
       FROM members m
       LEFT JOIN categories c ON m.category_id = c.id
       WHERE m.id = ?`
    )
    .get(memberId);

  if (!member) {
    return {
      monthsExpected: 0,
      totalDuesExpectedCents: 0,
      totalPaidCents: 0,
      balanceCents: 0,
      monthlyDuesCents: 0,
      status: 'current',
      isDelinquent: false,
    };
  }

  const monthlyDuesCents = Number(member.monthly_dues_cents ?? 0) || 0;
  const joinDate = getJoinOrCreated(member);
  const now = new Date();
  const monthsExpected = monthsBetween(joinDate, now);
  const totalDuesExpectedCents = monthsExpected * monthlyDuesCents;

  const duesPayments = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions
       WHERE member_id = ? AND transaction_type = 'DUES' AND COALESCE(is_deleted, 0) = 0 AND COALESCE(organization_id, 1) = 1 AND COALESCE(status, 'COMPLETED') = 'COMPLETED'`
    )
    .get(memberId);
  const totalPaidCents = Number(duesPayments?.total ?? 0) || 0;

  const balanceCents = totalPaidCents - totalDuesExpectedCents;

  let status = 'current';
  if (balanceCents > 0) status = 'credit';
  else if (balanceCents < 0) {
    const twoMonthsDues = 2 * monthlyDuesCents;
    status = balanceCents <= -twoMonthsDues ? 'delinquent' : 'past_due';
  }

  const isDelinquent = status === 'delinquent';

  return {
    monthsExpected,
    totalDuesExpectedCents,
    totalPaidCents,
    balanceCents,
    monthlyDuesCents,
    status,
    isDelinquent,
  };
}

module.exports = { calculateMemberDuesStatus };

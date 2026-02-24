const ALLOWED_METHODS = new Set(['ZELLE', 'CASHAPP', 'VENMO', 'CASH']);
const db = require('../db/database');

function validatePaymentSubmission(req, res, next) {
  const body = req.body || {};
  const orgId = String(body.org_id ?? 'default-org').trim();
  const invoiceId = String(body.invoice_id ?? '').trim();
  const memberName = String(body.member_name ?? '').trim();
  const method = String(body.method ?? '').trim().toUpperCase();
  const amount = Number(body.amount);

  if (!invoiceId) {
    return res.status(400).json({ success: false, error: 'invoice_id is required' });
  }
  if (!memberName) {
    return res.status(400).json({ success: false, error: 'member_name is required' });
  }
  if (!ALLOWED_METHODS.has(method)) {
    return res.status(400).json({ success: false, error: 'method must be one of: ZELLE, CASHAPP, VENMO, CASH' });
  }
  if (!Number.isFinite(amount)) {
    return res.status(400).json({ success: false, error: 'amount must be numeric' });
  }

  const org = db.prepare('SELECT id FROM organizations WHERE id = ? LIMIT 1').get(orgId);
  if (!org) {
    return res.status(400).json({ success: false, error: 'org_id is invalid' });
  }

  req.body.org_id = orgId;
  req.body.method = method;
  req.body.amount = amount;
  next();
}

function requireApiKey(req, res, next) {
  const key = String(req.headers['x-api-key'] || '').trim();
  if (!key) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const org = db.prepare('SELECT * FROM organizations WHERE api_key = ? LIMIT 1').get(key);
  if (!org) return res.status(401).json({ success: false, error: 'Unauthorized' });

  req.org_id = org.id;
  req.organization = org;
  return next();
}

module.exports = { validatePaymentSubmission, requireApiKey };

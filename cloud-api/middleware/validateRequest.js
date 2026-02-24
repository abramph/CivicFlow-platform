const ALLOWED_METHODS = new Set(['ZELLE', 'CASHAPP', 'VENMO', 'CASH']);

function validatePaymentSubmission(req, res, next) {
  const body = req.body || {};
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

  req.body.method = method;
  req.body.amount = amount;
  next();
}

module.exports = { validatePaymentSubmission };

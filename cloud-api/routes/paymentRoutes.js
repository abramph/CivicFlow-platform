const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { validatePaymentSubmission } = require('../middleware/validateRequest');

const router = express.Router();

router.post('/payment-submissions', validatePaymentSubmission, (req, res) => {
  const { invoice_id, member_name, method, amount, paid_date, note } = req.body;
  const cloudId = uuidv4();
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO payment_submissions_cloud (
      cloud_id, invoice_id, member_name, method, amount, paid_date, note, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?)
  `).run(
    String(cloudId),
    String(invoice_id),
    String(member_name).trim(),
    String(method).trim().toUpperCase(),
    Number(amount),
    String(paid_date || '').trim() || null,
    String(note || '').trim() || null,
    createdAt,
  );

  return res.json({ success: true, id: cloudId });
});

router.get('/payment-submissions', (req, res) => {
  const rows = db.prepare(`
    SELECT cloud_id, invoice_id, member_name, method, amount, paid_date, note, created_at
    FROM payment_submissions_cloud
    WHERE UPPER(COALESCE(status, 'NEW')) = 'NEW'
    ORDER BY datetime(created_at) DESC, id DESC
  `).all();

  return res.json(rows);
});

router.post('/payment-submissions/mark-synced', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id)).filter(Boolean) : [];
  if (!ids.length) {
    return res.json({ success: true, updated: 0 });
  }

  const placeholders = ids.map(() => '?').join(', ');
  const result = db.prepare(`
    UPDATE payment_submissions_cloud
    SET status = 'SYNCED'
    WHERE cloud_id IN (${placeholders})
  `).run(...ids);

  return res.json({ success: true, updated: result.changes || 0 });
});

module.exports = router;

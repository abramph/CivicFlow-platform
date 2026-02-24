const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const db = require('../db/database');
const { sendReceiptEmail } = require('../services/emailService');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      const safeExt = ext && ext.length <= 8 ? ext : '.bin';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function createPaymentRoutes() {
  const router = express.Router();

  router.post('/payment-submissions', (req, res) => {
    const { org_id, invoice_id, member_name, method, amount, paid_date, note, screenshot_url } = req.body;
    const cloudId = uuidv4();
    const createdAt = new Date().toISOString();

    db.prepare(`
    INSERT INTO payment_submissions (
      cloud_id, org_id, invoice_id, member_name, method, amount, paid_date, note, screenshot_url, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?)
  `).run(
      String(cloudId),
      String(org_id || 'default-org'),
      String(invoice_id),
      String(member_name).trim(),
      String(method).trim().toUpperCase(),
      Number(amount),
      String(paid_date || '').trim() || null,
      String(note || '').trim() || null,
      String(screenshot_url || '').trim() || null,
      createdAt,
    );

    return res.json({ success: true, id: cloudId });
  });

  router.post('/payment-submissions/upload', upload.single('screenshot'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No screenshot uploaded.' });
    }
    const publicBase = String(process.env.PUBLIC_BASE_URL || 'https://api.civicflowapp.com').replace(/\/$/, '');
    const url = `${publicBase}/uploads/${req.file.filename}`;
    return res.json({ success: true, url, filename: req.file.filename });
  });

  router.get('/payment-submissions', (req, res) => {
    const rows = db.prepare(`
    SELECT cloud_id, invoice_id, member_name, method, amount, paid_date, note, screenshot_url, created_at
    FROM payment_submissions
    WHERE UPPER(COALESCE(status, 'NEW')) = 'NEW'
      AND org_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
  `).all(req.org_id);

    return res.json(rows);
  });

  router.post('/payment-submissions/mark-synced', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id)).filter(Boolean) : [];
    if (!ids.length) {
      return res.json({ success: true, updated: 0 });
    }

    const placeholders = ids.map(() => '?').join(', ');
    const result = db.prepare(`
    UPDATE payment_submissions
    SET status = 'SYNCED'
    WHERE cloud_id IN (${placeholders})
      AND org_id = ?
  `).run(...ids, req.org_id);

    return res.json({ success: true, updated: result.changes || 0 });
  });

  router.post('/payment-submissions/send-receipt', async (req, res, next) => {
    try {
      const payload = req.body || {};
      await sendReceiptEmail(payload);
      return res.json({ success: true });
    } catch (err) {
      if (err?.code === 'RECIPIENT_REQUIRED') {
        return res.status(400).json({ success: false, error: err.message });
      }
      if (err?.code === 'SMTP_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, error: err.message });
      }
      return next(err);
    }
  });

  router.get('/analytics/summary', (req, res) => {
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS total_payments, COALESCE(SUM(amount), 0) AS total_amount
      FROM payment_submissions
      WHERE org_id = ?
    `).get(req.org_id) || { total_payments: 0, total_amount: 0 };

    const paymentsByMethod = db.prepare(`
      SELECT method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
      FROM payment_submissions
      WHERE org_id = ?
      GROUP BY method
      ORDER BY total DESC
    `).all(req.org_id);

    const monthlyTotals = db.prepare(`
      SELECT
        substr(COALESCE(NULLIF(paid_date, ''), created_at), 1, 7) AS month,
        COUNT(*) AS count,
        COALESCE(SUM(amount), 0) AS total
      FROM payment_submissions
      WHERE org_id = ?
      GROUP BY substr(COALESCE(NULLIF(paid_date, ''), created_at), 1, 7)
      ORDER BY month ASC
    `).all(req.org_id);

    return res.json({
      total_payments: Number(totalRow.total_payments || 0),
      total_amount: Number(totalRow.total_amount || 0),
      payments_by_method: paymentsByMethod,
      monthly_totals: monthlyTotals,
    });
  });

  return router;
}

module.exports = createPaymentRoutes;

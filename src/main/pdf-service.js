const PDFDocument = require('pdfkit');
const fs = require('node:fs');
const { getBranding } = require('./branding.js');
const { APP_NAME } = require('../shared/appConfig.js');
const { getInterFontPath, getInterBoldFontPath } = require('./fonts.js');

const MARGIN = 50;
const HEADER_HEIGHT = 80;

function registerFonts(doc) {
  const regular = getInterFontPath();
  const bold = getInterBoldFontPath();
  if (fs.existsSync(regular)) doc.registerFont('Inter', regular);
  if (fs.existsSync(bold)) doc.registerFont('InterBold', bold);
}

function addBrandingHeader(doc, branding = getBranding()) {
  if (!doc || typeof doc.text !== 'function') {
    throw new Error('Invalid PDF document instance');
  }
  const startY = doc.y;
  doc.y = MARGIN;
  let x = MARGIN;
  registerFonts(doc);
  if (branding.logoPath && fs.existsSync(branding.logoPath)) {
    try {
      doc.image(branding.logoPath, MARGIN, MARGIN, { height: 48 });
      x = MARGIN + 48 + 16;
    } catch (_) {}
  }
  doc.fontSize(18).font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').fillColor('#0f766e');
  doc.text(branding.cboName || APP_NAME, x, MARGIN + 8, { continued: false });
  doc.fontSize(10).font('Inter').fillColor('#334155');
  doc.text('Community-Based Organization', x, MARGIN + 32, { continued: false });
  doc.y = Math.max(startY, MARGIN + HEADER_HEIGHT);
  doc.moveDown(2);
}

function formatTxnType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (!t) return 'UNKNOWN';
  if (t === 'DUES') return 'DUES';
  if (t === 'DONATION') return 'DONATION';
  if (t === 'CAMPAIGN_CONTRIBUTION') return 'CAMPAIGN';
  if (t === 'EVENT_REVENUE') return 'EVENT';
  if (t === 'OTHER_INCOME') return 'OTHER INCOME';
  return t.replace(/_/g, ' ');
}

function formatTxnTypeWithContext(txn) {
  const txnType = String(txn?.transaction_type || txn?.type || '').trim().toUpperCase();
  if (txnType === 'CAMPAIGN_CONTRIBUTION' && txn?.campaign_name) return `Campaign: ${txn.campaign_name}`;
  if (txnType === 'EVENT_REVENUE' && txn?.event_name) return `Event: ${txn.event_name}`;
  return formatTxnType(txnType || txn?.type);
}

function txnContributorLabel(txn) {
  const memberName = [txn?.first_name, txn?.last_name].map((part) => String(part || '').trim()).filter(Boolean).join(' ').trim();
  if (memberName) return memberName;
  const contributorName = String(txn?.contributor_name || '').trim();
  if (contributorName) return contributorName;
  return 'Unattributed Contributor';
}

function formatReceiptTxnType(txnType, campaignName, eventName) {
  const type = String(txnType || '').trim().toUpperCase();
  if (type === 'CAMPAIGN_CONTRIBUTION') return campaignName ? `Campaign Contribution (${campaignName})` : 'Campaign Contribution';
  if (type === 'EVENT_REVENUE') return eventName ? `Event Revenue (${eventName})` : 'Event Revenue';
  if (type === 'DUES') return 'Dues Payment';
  if (type === 'DONATION') return 'Donation';
  if (type === 'OTHER_INCOME') return 'Other Income';
  if (type) return type.replace(/_/g, ' ');
  return 'Payment';
}

function formatPaymentMethodLabel(method) {
  const key = String(method || '').trim().toUpperCase();
  if (!key) return 'Manual';
  if (key === 'CASHAPP') return 'Cash App';
  return key.replace(/_/g, ' ');
}

function buildPeriodReportPDF(db, startDate, endDate, reportType) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN });
    if (!doc || typeof doc.text !== 'function') {
      reject(new Error('Invalid PDF document instance'));
      return;
    }
    registerFonts(doc);
    if (fs.existsSync(getInterFontPath())) doc.font('Inter');
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const branding = getBranding();
    addBrandingHeader(doc, branding);

    doc.fontSize(14).font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').fillColor('#0f172a');
    doc.text(`Period Report (${reportType}) — ${startDate} to ${endDate}`, { align: 'left' });
    doc.moveDown(1);
    doc.fontSize(10).font('Inter').fillColor('#475569');

    const members = db
      .prepare(
        `SELECT m.id, m.first_name, m.last_name, m.email, m.status, c.name as category_name
         FROM members m LEFT JOIN categories c ON m.category_id = c.id
         WHERE m.status = 'active'
         ORDER BY m.last_name, m.first_name`
      )
      .all();

    doc.font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').text('Members', { underline: true });
    doc.font('Inter');
    doc.text(`Total active: ${members.length}`);
    doc.moveDown(0.5);
    if (members.length > 0) {
      const memberLines = members.slice(0, 50).map(
        (m) =>
          `${m.last_name}, ${m.first_name} — ${m.email || '—'} | ${m.category_name || '—'}`
      );
      doc.text(memberLines.join('\n'), { lineGap: 2 });
      if (members.length > 50) {
        doc.text(`… and ${members.length - 50} more.`);
      }
    }
    doc.moveDown(1);

    const transactions = db
      .prepare(
        `SELECT t.*, m.first_name, m.last_name, c.name AS campaign_name, e.name AS event_name FROM transactions t
         LEFT JOIN members m ON t.member_id = m.id
         LEFT JOIN campaigns c ON c.id = t.campaign_id
         LEFT JOIN events e ON e.id = t.event_id
         WHERE COALESCE(t.is_deleted, 0) = 0 AND COALESCE(t.status, 'COMPLETED') = 'COMPLETED' AND date(t.occurred_on) BETWEEN date(?) AND date(?)
         ORDER BY t.occurred_on DESC`
      )
      .all(startDate, endDate);

    const incomeCents = transactions
      .filter((t) => (t.amount_cents ?? 0) > 0)
      .reduce((s, t) => s + t.amount_cents, 0);
    const expenseCents = transactions
      .filter((t) => (t.amount_cents ?? 0) < 0)
      .reduce((s, t) => s + Math.abs(t.amount_cents), 0);

    doc.font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').text('Transactions Summary', { underline: true });
    doc.font('Inter');
    doc.text(`Records in period: ${transactions.length}`);
    doc.text(`Income: $${(incomeCents / 100).toFixed(2)}`);
    doc.text(`Expenses: $${(expenseCents / 100).toFixed(2)}`);
    doc.moveDown(0.5);
    if (transactions.length > 0) {
      const lines = transactions.slice(0, 30).map(
        (t) =>
          `${t.occurred_on} — ${txnContributorLabel(t)} — $${(t.amount_cents / 100).toFixed(2)} — ${formatTxnTypeWithContext(t)}`
      );
      doc.text(lines.join('\n'), { lineGap: 2 });
    }
    doc.moveDown(1);

    const campaigns = db
      .prepare(
        `SELECT * FROM campaigns
         WHERE (start_date IS NULL OR date(start_date) <= date(?))
           AND (end_date IS NULL OR date(end_date) >= date(?))
         ORDER BY start_date DESC`
      )
      .all(endDate, startDate);

    doc.font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').text('Campaigns', { underline: true });
    doc.font('Inter');
    doc.text(`Active in period: ${campaigns.length}`);
    campaigns.forEach((c) => {
      doc.text(`${c.name} — ${c.start_date || '—'} to ${c.end_date || '—'}`);
    });

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#94a3b8');
    doc.text(`Report generated on ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC.`);
    doc.end();
  });
}

function buildReceiptPDF(db, transactionId) {
  return new Promise((resolve, reject) => {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ? AND COALESCE(is_deleted, 0) = 0').get(transactionId);
    if (!txn) {
      reject(new Error('Transaction not found'));
      return;
    }
    let member = null;
    if (txn.member_id) {
      member = db.prepare('SELECT first_name, last_name, email FROM members WHERE id = ?').get(txn.member_id);
    }
    let eventName = null;
    if (txn.event_id) {
      const row = db.prepare('SELECT name FROM events WHERE id = ?').get(txn.event_id);
      eventName = row?.name ?? null;
    }
    let campaignName = null;
    if (txn.campaign_id) {
      const row = db.prepare('SELECT name FROM campaigns WHERE id = ?').get(txn.campaign_id);
      campaignName = row?.name ?? null;
    }

    const contributorName = String(txn.contributor_name || '').trim() || null;
    const memberDisplayName = member ? `${member.first_name || ''} ${member.last_name || ''}`.trim() : '';
    const payerLabel = memberDisplayName || contributorName || 'Unattributed Contributor';
    const receiptTypeLabel = formatReceiptTxnType(txn.transaction_type || txn.type, campaignName, eventName);
    const paymentMethodLabel = formatPaymentMethodLabel(txn.payment_method);
    const statusLabel = String(txn.status || 'COMPLETED').replace(/_/g, ' ');
    const signedAmount = Number(txn.amount_cents || 0);
    const amountLabel = `${signedAmount < 0 ? '-' : ''}$${(Math.abs(signedAmount) / 100).toFixed(2)}`;

    const doc = new PDFDocument({ margin: MARGIN, size: 'A5' });
    if (!doc || typeof doc.text !== 'function') {
      reject(new Error('Invalid PDF document instance'));
      return;
    }
    registerFonts(doc);
    if (fs.existsSync(getInterFontPath())) doc.font('Inter');
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const branding = getBranding();
    addBrandingHeader(doc, branding);

    doc.fontSize(14).font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').fillColor('#0f172a');
    doc.text('Payment Receipt', { align: 'left' });
    doc.moveDown(1);
    doc.fontSize(10).font('Inter').fillColor('#475569');

    doc.text(`Receipt ID: ${txn.id}`);
    doc.text(`Date: ${txn.occurred_on || '—'}`);
    doc.text(`Transaction: ${receiptTypeLabel}`);
    doc.text(`Payer/Contributor: ${payerLabel}`);
    doc.text(`Amount: ${amountLabel}`);
    doc.text(`Payment method: ${paymentMethodLabel}`);
    doc.text(`Status: ${statusLabel}`);
    if (txn.reference) doc.text(`Reference: ${txn.reference}`);
    doc.moveDown(0.5);
    if (member) {
      doc.font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').text('Member', { underline: true });
      doc.font('Inter');
      doc.text(`${member.first_name} ${member.last_name}`);
      if (member.email) doc.text(member.email);
      doc.moveDown(0.5);
    }
    doc.font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').text('Transaction', { underline: true });
    doc.font('Inter');
    if (eventName) doc.text(`Event: ${eventName}`);
    if (campaignName) doc.text(`Campaign: ${campaignName}`);
    if (txn.note) doc.text(`Note: ${txn.note}`);
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#94a3b8');
    doc.text(`Generated on ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC.`);
    doc.text(`Generated by ${APP_NAME}.`);
    doc.end();
  });
}

module.exports = {
  addBrandingHeader,
  buildPeriodReportPDF,
  buildReceiptPDF,
};

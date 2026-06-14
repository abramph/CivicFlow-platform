const PDFDocument = require('pdfkit');
const fs = require('node:fs');
const { getBranding } = require('./branding.js');
const { APP_NAME } = require('../shared/appConfig.js');
const { formatMoneyFromCents } = require('../shared/money.cjs');
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
  return 'Unattributed external donor';
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

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeReportRequest(reportRequest = {}) {
  if (typeof reportRequest === 'string') {
    return {
      id: '',
      title: String(reportRequest || 'Report').trim() || 'Report',
      memberId: null,
      eventId: null,
      campaignId: null,
    };
  }

  return {
    id: String(reportRequest.reportType || reportRequest.id || '').trim(),
    title:
      String(
        reportRequest.title ||
          reportRequest.label ||
          reportRequest.reportType ||
          reportRequest.id ||
          'Report'
      ).trim() || 'Report',
    memberId: toPositiveInteger(reportRequest.memberId ?? reportRequest.params?.memberId),
    eventId: toPositiveInteger(reportRequest.eventId ?? reportRequest.params?.eventId),
    campaignId: toPositiveInteger(reportRequest.campaignId ?? reportRequest.params?.campaignId),
  };
}

function writeSectionHeading(doc, title) {
  doc
    .font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter')
    .text(title, { underline: true });
  doc.font('Inter');
}

function buildPeriodReportPDF(db, startDate, endDate, reportRequest) {
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

    const report = normalizeReportRequest(reportRequest);
    const reportId = report.id;
    const isMemberReport = reportId === 'member_contribution' || reportId === 'member_monthly';
    const isEventReport = reportId === 'event_contribution';
    const isCampaignReport = reportId === 'campaign_contribution';
    const isRosterActive = reportId === 'roster_active';
    const isRosterInactive = reportId === 'roster_inactive';
    const isRosterCombined = reportId === 'roster_combined';
    const isRosterReport = isRosterActive || isRosterInactive || isRosterCombined;

    let scopedMember = null;
    let scopedEvent = null;
    let scopedCampaign = null;

    if (isMemberReport) {
      if (!report.memberId) {
        reject(new Error('Member report requires a memberId.'));
        return;
      }
      scopedMember = db
        .prepare(
          `SELECT m.id, m.first_name, m.last_name, m.email, m.status, c.name AS category_name
           FROM members m
           LEFT JOIN categories c ON c.id = m.category_id
           WHERE m.id = ?`
        )
        .get(report.memberId);
      if (!scopedMember) {
        reject(new Error(`Member ${report.memberId} not found.`));
        return;
      }
    }

    if (isEventReport) {
      if (!report.eventId) {
        reject(new Error('Event report requires an eventId.'));
        return;
      }
      scopedEvent = db
        .prepare('SELECT id, name, date, location FROM events WHERE id = ?')
        .get(report.eventId);
      if (!scopedEvent) {
        reject(new Error(`Event ${report.eventId} not found.`));
        return;
      }
    }

    if (isCampaignReport) {
      if (!report.campaignId) {
        reject(new Error('Campaign report requires a campaignId.'));
        return;
      }
      scopedCampaign = db
        .prepare('SELECT id, name, start_date, end_date, goal_cents FROM campaigns WHERE id = ?')
        .get(report.campaignId);
      if (!scopedCampaign) {
        reject(new Error(`Campaign ${report.campaignId} not found.`));
        return;
      }
    }

    doc.fontSize(14).font(fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter').fillColor('#0f172a');
    doc.text(`${report.title} — ${startDate} to ${endDate}`, { align: 'left' });
    doc.moveDown(1);
    doc.fontSize(10).font('Inter').fillColor('#475569');

    if (isMemberReport && scopedMember) {
      writeSectionHeading(doc, 'Member');
      doc.text(`${scopedMember.last_name || ''}, ${scopedMember.first_name || ''}`.replace(/^,\s*/, '').trim());
      doc.text(`Email: ${scopedMember.email || '—'}`);
      doc.text(`Status: ${scopedMember.status || '—'}`);
      doc.text(`Category: ${scopedMember.category_name || '—'}`);
      doc.moveDown(1);
    } else if (isEventReport && scopedEvent) {
      writeSectionHeading(doc, 'Event');
      doc.text(`Name: ${scopedEvent.name || '—'}`);
      doc.text(`Date: ${scopedEvent.date || '—'}`);
      doc.text(`Location: ${scopedEvent.location || '—'}`);
      doc.moveDown(1);
    } else if (isCampaignReport && scopedCampaign) {
      writeSectionHeading(doc, 'Campaign');
      doc.text(`Name: ${scopedCampaign.name || '—'}`);
      doc.text(`Start date: ${scopedCampaign.start_date || '—'}`);
      doc.text(`End date: ${scopedCampaign.end_date || '—'}`);
      if (scopedCampaign.goal_cents != null) {
        doc.text(`Goal: ${formatMoneyFromCents(scopedCampaign.goal_cents || 0)}`);
      }
      doc.moveDown(1);
    } else {
      let memberWhereSql = "WHERE LOWER(COALESCE(m.status, 'active')) = 'active'";
      if (isRosterInactive) {
        memberWhereSql = "WHERE LOWER(COALESCE(m.status, 'inactive')) = 'inactive'";
      } else if (isRosterCombined) {
        memberWhereSql = '';
      }

      const members = db
        .prepare(
          `SELECT m.id, m.first_name, m.last_name, m.email, m.status, c.name AS category_name
           FROM members m
           LEFT JOIN categories c ON m.category_id = c.id
           ${memberWhereSql}
           ORDER BY m.last_name, m.first_name`
        )
        .all();

      writeSectionHeading(doc, 'Members');
      if (isRosterCombined) {
        doc.text(`Total members: ${members.length}`);
      } else if (isRosterInactive) {
        doc.text(`Total inactive: ${members.length}`);
      } else {
        doc.text(`Total active: ${members.length}`);
      }
      doc.moveDown(0.5);
      if (members.length > 0) {
        const memberLines = members.slice(0, 50).map((member) => {
          const parts = [
            `${member.last_name || ''}, ${member.first_name || ''}`.replace(/^,\s*/, '').trim(),
            member.email || '—',
            member.category_name || '—',
          ];
          if (isRosterCombined) parts.push(member.status || '—');
          return parts.join(' | ');
        });
        doc.text(memberLines.join('\n'), { lineGap: 2 });
        if (members.length > 50) {
          doc.text(`… and ${members.length - 50} more.`);
        }
      }
      doc.moveDown(1);
    }

    if (!isRosterReport) {
      const transactionFilters = [
        'COALESCE(t.is_deleted, 0) = 0',
        "COALESCE(t.status, 'COMPLETED') = 'COMPLETED'",
        'date(t.occurred_on) BETWEEN date(?) AND date(?)',
      ];
      const transactionParams = [startDate, endDate];
      if (isMemberReport) {
        transactionFilters.push('t.member_id = ?');
        transactionParams.push(report.memberId);
      } else if (isEventReport) {
        transactionFilters.push('t.event_id = ?');
        transactionParams.push(report.eventId);
      } else if (isCampaignReport) {
        transactionFilters.push('t.campaign_id = ?');
        transactionParams.push(report.campaignId);
      }

      const transactions = db
        .prepare(
          `SELECT t.*, m.first_name, m.last_name, c.name AS campaign_name, e.name AS event_name
           FROM transactions t
           LEFT JOIN members m ON t.member_id = m.id
           LEFT JOIN campaigns c ON c.id = t.campaign_id
           LEFT JOIN events e ON e.id = t.event_id
           WHERE ${transactionFilters.join(' AND ')}
           ORDER BY t.occurred_on DESC`
        )
        .all(...transactionParams);

      const incomeCents = transactions
        .filter((t) => (t.amount_cents ?? 0) > 0)
        .reduce((sum, txn) => sum + txn.amount_cents, 0);
      const expenseCents = transactions
        .filter((t) => (t.amount_cents ?? 0) < 0)
        .reduce((sum, txn) => sum + Math.abs(txn.amount_cents), 0);

      let transactionHeading = 'Transactions Summary';
      if (isMemberReport) transactionHeading = 'Member Transactions';
      else if (isEventReport) transactionHeading = 'Event Transactions';
      else if (isCampaignReport) transactionHeading = 'Campaign Transactions';

      writeSectionHeading(doc, transactionHeading);
      doc.text(`Records in scope: ${transactions.length}`);
      doc.text(`Income: ${formatMoneyFromCents(incomeCents)}`);
      doc.text(`Expenses: ${formatMoneyFromCents(expenseCents)}`);
      doc.moveDown(0.5);
      if (transactions.length > 0) {
        const lines = transactions.slice(0, 30).map(
          (txn) =>
            `${txn.occurred_on} — ${txnContributorLabel(txn)} — ${formatMoneyFromCents(txn.amount_cents)} — ${formatTxnTypeWithContext(txn)}`
        );
        doc.text(lines.join('\n'), { lineGap: 2 });
      }
      doc.moveDown(1);
    }

    if (!isRosterReport && !isMemberReport && !isEventReport && !isCampaignReport) {
      const campaigns = db
        .prepare(
          `SELECT * FROM campaigns
           WHERE (start_date IS NULL OR date(start_date) <= date(?))
             AND (end_date IS NULL OR date(end_date) >= date(?))
           ORDER BY start_date DESC`
        )
        .all(endDate, startDate);

      writeSectionHeading(doc, 'Campaigns');
      doc.text(`Active in period: ${campaigns.length}`);
      campaigns.forEach((campaign) => {
        doc.text(`${campaign.name} — ${campaign.start_date || '—'} to ${campaign.end_date || '—'}`);
      });
      doc.moveDown(1);
    }

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
    const payerLabel = memberDisplayName || contributorName || 'Unattributed external donor';
    const receiptTypeLabel = formatReceiptTxnType(txn.transaction_type || txn.type, campaignName, eventName);
    const paymentMethodLabel = formatPaymentMethodLabel(txn.payment_method);
    const statusLabel = String(txn.status || 'COMPLETED').replace(/_/g, ' ');
    const signedAmount = Number(txn.amount_cents || 0);
    const amountLabel = `${signedAmount < 0 ? '-' : ''}${formatMoneyFromCents(Math.abs(signedAmount))}`;

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

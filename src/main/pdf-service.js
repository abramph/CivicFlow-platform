const PDFDocument = require('pdfkit');
const fs = require('node:fs');
const { getBranding } = require('./branding.js');
const { APP_NAME } = require('../shared/appConfig.js');
const { formatMoneyFromCents } = require('../shared/money.cjs');
const { getInterFontPath, getInterBoldFontPath } = require('./fonts.js');

const MARGIN = 50;
const HEADER_HEIGHT = 80;
const PAGE_WIDTH = 612; // US Letter, points
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2; // 512 points

function bFont() {
  return fs.existsSync(getInterBoldFontPath()) ? 'InterBold' : 'Inter';
}

function registerFonts(doc) {
  const regular = getInterFontPath();
  const bold = getInterBoldFontPath();
  if (fs.existsSync(regular)) doc.registerFont('Inter', regular);
  if (fs.existsSync(bold)) doc.registerFont('InterBold', bold);
}

function addBrandingHeader(doc, branding = getBranding()) {
  if (!doc || typeof doc.text !== 'function') throw new Error('Invalid PDF document instance');
  doc.y = MARGIN;
  let x = MARGIN;
  registerFonts(doc);
  if (branding.logoPath && fs.existsSync(branding.logoPath)) {
    try {
      doc.image(branding.logoPath, MARGIN, MARGIN, { height: 48 });
      x = MARGIN + 48 + 16;
    } catch (_) {}
  }
  doc.fontSize(18).font(bFont()).fillColor('#0f766e');
  doc.text(branding.cboName || APP_NAME, x, MARGIN + 8, { continued: false });
  doc.fontSize(9.5).font('Inter').fillColor('#64748b');
  doc.text('Community-Based Organization', x, MARGIN + 32, { continued: false });

  const ruleY = MARGIN + HEADER_HEIGHT - 6;
  doc.save()
    .moveTo(MARGIN, ruleY)
    .lineTo(PAGE_WIDTH - MARGIN, ruleY)
    .strokeColor('#e2e8f0')
    .lineWidth(1)
    .stroke()
    .restore();

  doc.y = MARGIN + HEADER_HEIGHT;
  doc.moveDown(0.75);
}

// Horizontal rule at current doc.y
function drawRule(doc, { color = '#e2e8f0', thickness = 0.5, before = 0, after = 8 } = {}) {
  if (before > 0) doc.y += before;
  const y = doc.y;
  doc.save()
    .moveTo(MARGIN, y)
    .lineTo(PAGE_WIDTH - MARGIN, y)
    .strokeColor(color)
    .lineWidth(thickness)
    .stroke()
    .restore();
  doc.y = y + after;
}

function writeSectionHeading(doc, title) {
  doc.moveDown(0.75);
  doc.fontSize(10).font(bFont()).fillColor('#0f766e').text(title.toUpperCase(), { characterSpacing: 0.3 });
  drawRule(doc, { color: '#0f766e', thickness: 1, after: 8 });
  doc.fontSize(10).font('Inter').fillColor('#1e293b');
}

// Compact key-value summary block
function writeSummaryBlock(doc, items) {
  // items: [{ label, value }]
  const PAD = 10;
  const LINE_H = 16;
  const startY = doc.y;
  const boxH = items.length * LINE_H + PAD * 2;

  doc.save().rect(MARGIN, startY, USABLE_WIDTH, boxH).fill('#f8fafc').restore();
  doc.save().rect(MARGIN, startY, USABLE_WIDTH, boxH).strokeColor('#e2e8f0').lineWidth(0.5).stroke().restore();

  let y = startY + PAD;
  const colW = USABLE_WIDTH / 2;
  const leftCol = [];
  const rightCol = [];
  items.forEach((it, i) => (i % 2 === 0 ? leftCol : rightCol).push(it));

  const maxRows = Math.max(leftCol.length, rightCol.length);
  for (let row = 0; row < maxRows; row++) {
    const renderItem = (col, x) => {
      if (!col[row]) return;
      const { label, value } = col[row];
      doc.fontSize(9).font(bFont()).fillColor('#64748b')
        .text(label + ': ', x + PAD, y + row * LINE_H, { continued: true, width: 110, lineBreak: false });
      doc.fontSize(9).font('Inter').fillColor('#1e293b').text(String(value ?? '—'), { continued: false, lineBreak: false });
    };
    renderItem(leftCol, MARGIN);
    renderItem(rightCol, MARGIN + colW);
  }

  doc.y = startY + boxH + 12;
}

// Generic table renderer
// columns: [{ key, header, width, align? }]
function drawTable(doc, branding, { columns, rows }) {
  const ROW_H = 18;
  const HEADER_H = 20;
  const tableW = columns.reduce((s, c) => s + c.width, 0);

  const paintHeader = (y) => {
    doc.save().rect(MARGIN, y, tableW, HEADER_H).fill('#f1f5f9').restore();
    let x = MARGIN;
    columns.forEach((col) => {
      doc.fontSize(8.5).font(bFont()).fillColor('#475569')
        .text(col.header, x + 3, y + 6, { width: col.width - 6, align: col.align || 'left', lineBreak: false });
      x += col.width;
    });
    const lineY = y + HEADER_H;
    doc.save().moveTo(MARGIN, lineY).lineTo(MARGIN + tableW, lineY).strokeColor('#cbd5e1').lineWidth(0.5).stroke().restore();
    return lineY;
  };

  let y = doc.y;
  y = paintHeader(y);

  rows.forEach((row, i) => {
    if (y + ROW_H > doc.page.height - MARGIN - 30) {
      doc.addPage();
      addBrandingHeader(doc, branding);
      y = doc.y;
      y = paintHeader(y);
    }

    if (i % 2 === 0) {
      doc.save().rect(MARGIN, y, tableW, ROW_H).fill('#f8fafc').restore();
    }

    let x = MARGIN;
    columns.forEach((col) => {
      const val = row[col.key];
      const text = val == null || val === '' ? '—' : String(val);
      doc.fontSize(9).font('Inter').fillColor('#334155')
        .text(text, x + 3, y + 4, { width: col.width - 6, align: col.align || 'left', lineBreak: false, ellipsis: true });
      x += col.width;
    });
    y += ROW_H;
  });

  doc.save().moveTo(MARGIN, y).lineTo(MARGIN + tableW, y).strokeColor('#cbd5e1').lineWidth(0.5).stroke().restore();
  doc.y = y + 14;
}

// ── Column presets ────────────────────────────────────────────────────────────

const ROSTER_COLS = [
  { key: '_name',         header: 'Name',         width: 140 },
  { key: 'email',         header: 'Email',         width: 160 },
  { key: 'phone',         header: 'Phone',         width: 80  },
  { key: '_cityzip',      header: 'City / ZIP',    width: 75  },
  { key: 'category_name', header: 'Category',      width: 57  },
];

const ROSTER_COMBINED_COLS = [
  { key: '_name',         header: 'Name',          width: 125 },
  { key: 'email',         header: 'Email',         width: 145 },
  { key: 'phone',         header: 'Phone',         width: 75  },
  { key: '_cityzip',      header: 'City / ZIP',    width: 72  },
  { key: 'category_name', header: 'Category',      width: 60  },
  { key: 'status',        header: 'Status',        width: 35  },
];

const DUES_CURRENT_COLS = [
  { key: '_name',         header: 'Name',          width: 130 },
  { key: 'email',         header: 'Email',         width: 145 },
  { key: 'phone',         header: 'Phone',         width: 75  },
  { key: '_cityzip',      header: 'City / ZIP',    width: 70  },
  { key: 'category_name', header: 'Category',      width: 57  },
  { key: '_balance',      header: 'Balance',       width: 35, align: 'right' },
];

const CONTRIBUTORS_COLS = [
  { key: '_name',          header: 'Name',          width: 140 },
  { key: 'email',          header: 'Email',         width: 155 },
  { key: 'phone',          header: 'Phone',         width: 75  },
  { key: '_cityzip',       header: 'City / ZIP',    width: 72  },
  { key: '_total_paid',    header: 'Total Paid',    width: 70, align: 'right' },
];

const DUES_FULL_YEAR_COLS = [
  { key: '_name',          header: 'Name',          width: 145 },
  { key: 'email',          header: 'Email',         width: 155 },
  { key: 'phone',          header: 'Phone',         width: 75  },
  { key: 'category_name',  header: 'Category',      width: 70  },
  { key: '_year_paid',     header: 'Paid in Year',  width: 67, align: 'right' },
];

const TXN_COLS = [
  { key: 'occurred_on',    header: 'Date',          width: 65  },
  { key: '_contributor',   header: 'Contributor',   width: 150 },
  { key: '_type',          header: 'Type',          width: 115 },
  { key: '_amount',        header: 'Amount',        width: 85, align: 'right' },
  { key: 'payment_method', header: 'Method',        width: 97  },
];

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtTxnType(txn) {
  const t = String(txn?.transaction_type || txn?.type || '').trim().toUpperCase();
  if (t === 'CAMPAIGN_CONTRIBUTION' && txn?.campaign_name) return `Campaign: ${txn.campaign_name}`;
  if (t === 'EVENT_REVENUE' && txn?.event_name) return `Event: ${txn.event_name}`;
  if (t === 'DUES') return 'Dues';
  if (t === 'DONATION') return 'Donation';
  if (t === 'OTHER_INCOME') return 'Other Income';
  return t.replace(/_/g, ' ') || '—';
}

function fmtContributor(txn) {
  const member = [txn?.first_name, txn?.last_name].map((p) => String(p || '').trim()).filter(Boolean).join(' ');
  if (member) return member;
  const ext = String(txn?.contributor_name || '').trim();
  if (ext) return ext;
  return 'External / Unattributed';
}

function fmtBalance(cents) {
  const c = Number(cents) || 0;
  if (c > 0) return '+' + formatMoneyFromCents(c);
  if (c === 0) return 'Current';
  return '−' + formatMoneyFromCents(Math.abs(c));
}

function fmtCityZip(row) {
  const parts = [row.city, row.zip].map((v) => String(v || '').trim()).filter(Boolean);
  return parts.join(' ') || '—';
}

function enrichRosterRows(rows, { showStatus = false } = {}) {
  return rows.map((r) => ({
    ...r,
    _name: [`${r.last_name || ''}`, `${r.first_name || ''}`].filter(Boolean).join(', ').replace(/^,\s*/, '').trim() || '—',
    _cityzip: fmtCityZip(r),
  }));
}

function enrichTxnRows(rows) {
  return rows.map((r) => ({
    ...r,
    _contributor: fmtContributor(r),
    _type: fmtTxnType(r),
    _amount: formatMoneyFromCents(r.amount_cents ?? 0),
  }));
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

// ── normalizeReportRequest ────────────────────────────────────────────────────

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeReportRequest(reportRequest = {}) {
  if (typeof reportRequest === 'string') {
    return { id: '', title: String(reportRequest || 'Report').trim() || 'Report', memberId: null, eventId: null, campaignId: null, city: null, zip: null, year: null };
  }
  return {
    id: String(reportRequest.reportType || reportRequest.id || '').trim(),
    title: String(reportRequest.title || reportRequest.label || reportRequest.reportType || reportRequest.id || 'Report').trim() || 'Report',
    memberId: toPositiveInteger(reportRequest.memberId ?? reportRequest.params?.memberId),
    eventId: toPositiveInteger(reportRequest.eventId ?? reportRequest.params?.eventId),
    campaignId: toPositiveInteger(reportRequest.campaignId ?? reportRequest.params?.campaignId),
    city: String(reportRequest.city || reportRequest.params?.city || '').trim() || null,
    zip: String(reportRequest.zip || reportRequest.params?.zip || '').trim() || null,
    year: String(reportRequest.year || reportRequest.params?.year || '').trim() || null,
  };
}

// ── Main report builder ───────────────────────────────────────────────────────

const DUES_TXN_WHERE = `(
  LOWER(COALESCE(type,'')) IN ('dues','dues_payment','invoice','receipt')
  OR UPPER(COALESCE(transaction_type,'')) = 'DUES'
) AND COALESCE(is_deleted, 0) = 0
  AND UPPER(COALESCE(status,'COMPLETED')) = 'COMPLETED'
  AND date(COALESCE(occurred_on, created_at)) <= date('now')`;

function buildPeriodReportPDF(db, startDate, endDate, reportRequest) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, autoFirstPage: true });
    if (!doc || typeof doc.text !== 'function') { reject(new Error('Invalid PDF document instance')); return; }
    registerFonts(doc);
    if (fs.existsSync(getInterFontPath())) doc.font('Inter');
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const branding = getBranding();
    addBrandingHeader(doc, branding);

    const report = normalizeReportRequest(reportRequest);
    const id = report.id;

    const isRosterActive   = id === 'roster_active';
    const isRosterInactive = id === 'roster_inactive';
    const isRosterCombined = id === 'roster_combined';
    const isRosterByCity   = id === 'roster_by_city';
    const isRosterByZip    = id === 'roster_by_zip';
    const isRosterReport   = isRosterActive || isRosterInactive || isRosterCombined || isRosterByCity || isRosterByZip;

    const isDuesCurrent    = id === 'dues_current';
    const isDuesFullYear   = id === 'dues_paid_full_year';

    const isEventContrib       = id === 'event_contribution';
    const isCampaignContrib    = id === 'campaign_contribution';
    const isEventContribRoster = id === 'event_contributors_roster';
    const isCampaignContribRoster = id === 'campaign_contributors_roster';
    const isMemberReport       = id === 'member_contribution' || id === 'member_monthly';

    // ── Report title ─────────────────────────────────────────────────────────
    doc.fontSize(14).font(bFont()).fillColor('#0f172a').text(report.title, { align: 'left' });
    if (!isRosterReport && !isDuesCurrent && !isDuesFullYear && !isEventContribRoster && !isCampaignContribRoster) {
      doc.fontSize(10).font('Inter').fillColor('#64748b').text(`Period: ${startDate} to ${endDate}`);
    }
    doc.moveDown(0.5);
    drawRule(doc);

    // ══════════════════════════════════════════════════════════════════════════
    // ROSTER REPORTS
    // ══════════════════════════════════════════════════════════════════════════
    if (isRosterReport) {
      let whereClause = "WHERE LOWER(COALESCE(m.status,'active')) = 'active'";
      if (isRosterInactive) whereClause = "WHERE LOWER(COALESCE(m.status,'inactive')) = 'inactive'";
      else if (isRosterCombined) whereClause = '';
      else if (isRosterByCity && report.city) whereClause += ` AND LOWER(TRIM(COALESCE(m.city,''))) = LOWER(TRIM(?))`;
      else if (isRosterByZip && report.zip) whereClause += ` AND TRIM(COALESCE(m.zip,'')) = TRIM(?)`;

      const params = [];
      if ((isRosterByCity && report.city) || (isRosterByZip && report.zip)) {
        params.push(isRosterByCity ? report.city : report.zip);
      }

      const members = db.prepare(`
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.city, m.state, m.zip,
               m.status, m.join_date, c.name AS category_name
        FROM members m
        LEFT JOIN categories c ON c.id = m.category_id
        ${whereClause}
        ORDER BY m.last_name, m.first_name
      `).all(...params);

      const summaryItems = [
        { label: 'Generated', value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
        { label: 'Total members', value: members.length },
      ];
      if (isRosterByCity && report.city) summaryItems.push({ label: 'City', value: report.city });
      if (isRosterByZip && report.zip) summaryItems.push({ label: 'ZIP Code', value: report.zip });
      writeSummaryBlock(doc, summaryItems);

      writeSectionHeading(doc, 'Members');

      const rows = enrichRosterRows(members);
      const cols = isRosterCombined ? ROSTER_COMBINED_COLS : ROSTER_COLS;
      drawTable(doc, branding, { columns: cols, rows });

    // ══════════════════════════════════════════════════════════════════════════
    // DUES CURRENT
    // ══════════════════════════════════════════════════════════════════════════
    } else if (isDuesCurrent) {
      const rows = db.prepare(`
        WITH dues_paid AS (
          SELECT member_id, COALESCE(SUM(amount_cents), 0) AS paid_cents
          FROM transactions
          WHERE ${DUES_TXN_WHERE}
          GROUP BY member_id
        ),
        join_info AS (
          SELECT m.id,
            CASE
              WHEN ((CAST(strftime('%Y','now') AS INTEGER) - CAST(strftime('%Y', COALESCE(m.join_date, m.created_at, date('now'))) AS INTEGER)) * 12 +
                    (CAST(strftime('%m','now') AS INTEGER) - CAST(strftime('%m', COALESCE(m.join_date, m.created_at, date('now'))) AS INTEGER))) > 0
              THEN ((CAST(strftime('%Y','now') AS INTEGER) - CAST(strftime('%Y', COALESCE(m.join_date, m.created_at, date('now'))) AS INTEGER)) * 12 +
                    (CAST(strftime('%m','now') AS INTEGER) - CAST(strftime('%m', COALESCE(m.join_date, m.created_at, date('now'))) AS INTEGER))) * COALESCE(c.monthly_dues_cents, 0)
              ELSE 0
            END AS expected_cents,
            COALESCE(c.monthly_dues_cents, 0) AS monthly_cents
          FROM members m
          LEFT JOIN categories c ON c.id = m.category_id
          WHERE LOWER(COALESCE(m.status,'active')) = 'active'
        )
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.city, m.state, m.zip,
               m.join_date, c.name AS category_name,
               ji.monthly_cents AS monthly_dues_cents,
               COALESCE(dp.paid_cents, 0) AS total_paid_cents,
               ji.expected_cents AS total_expected_cents,
               COALESCE(dp.paid_cents, 0) - ji.expected_cents AS balance_cents
        FROM members m
        LEFT JOIN categories c ON c.id = m.category_id
        JOIN join_info ji ON ji.id = m.id
        LEFT JOIN dues_paid dp ON dp.member_id = m.id
        WHERE LOWER(COALESCE(m.status,'active')) = 'active'
          AND COALESCE(dp.paid_cents, 0) >= ji.expected_cents
        ORDER BY m.last_name, m.first_name
      `).all();

      const totalActive = db.prepare("SELECT COUNT(*) AS cnt FROM members WHERE LOWER(COALESCE(status,'active')) = 'active'").get()?.cnt || 0;

      writeSummaryBlock(doc, [
        { label: 'Generated', value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
        { label: 'Total active members', value: totalActive },
        { label: 'Members current on dues', value: rows.length },
        { label: 'Percentage current', value: totalActive > 0 ? Math.round((rows.length / totalActive) * 100) + '%' : '—' },
      ]);

      writeSectionHeading(doc, 'Members Current on Dues');

      const tableRows = rows.map((r) => ({
        ...r,
        _name: [`${r.last_name || ''}`, `${r.first_name || ''}`].filter(Boolean).join(', ').replace(/^,\s*/, '').trim() || '—',
        _cityzip: fmtCityZip(r),
        _balance: fmtBalance(r.balance_cents),
      }));
      drawTable(doc, branding, { columns: DUES_CURRENT_COLS, rows: tableRows });

    // ══════════════════════════════════════════════════════════════════════════
    // DUES PAID FULL YEAR
    // ══════════════════════════════════════════════════════════════════════════
    } else if (isDuesFullYear) {
      const year = report.year || String(new Date().getFullYear());

      const rows = db.prepare(`
        WITH year_dues AS (
          SELECT member_id, COALESCE(SUM(amount_cents), 0) AS year_paid_cents
          FROM transactions
          WHERE ${DUES_TXN_WHERE.replace("date(COALESCE(occurred_on, created_at)) <= date('now')", `strftime('%Y', COALESCE(occurred_on, created_at)) = ?`)}
          GROUP BY member_id
        )
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.city, m.state, m.zip,
               m.join_date, c.name AS category_name,
               COALESCE(c.monthly_dues_cents, 0) AS monthly_dues_cents,
               COALESCE(c.monthly_dues_cents, 0) * 12 AS annual_dues_cents,
               COALESCE(yd.year_paid_cents, 0) AS year_paid_cents
        FROM members m
        LEFT JOIN categories c ON c.id = m.category_id
        LEFT JOIN year_dues yd ON yd.member_id = m.id
        WHERE COALESCE(yd.year_paid_cents, 0) >= COALESCE(c.monthly_dues_cents, 0) * 12
          AND COALESCE(c.monthly_dues_cents, 0) > 0
        ORDER BY m.last_name, m.first_name
      `).all(year);

      writeSummaryBlock(doc, [
        { label: 'Year', value: year },
        { label: 'Generated', value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
        { label: 'Members fully paid', value: rows.length },
      ]);

      writeSectionHeading(doc, `Full Year Dues Paid — ${year}`);

      const tableRows = rows.map((r) => ({
        ...r,
        _name: [`${r.last_name || ''}`, `${r.first_name || ''}`].filter(Boolean).join(', ').replace(/^,\s*/, '').trim() || '—',
        _year_paid: formatMoneyFromCents(r.year_paid_cents),
      }));
      drawTable(doc, branding, { columns: DUES_FULL_YEAR_COLS, rows: tableRows });

    // ══════════════════════════════════════════════════════════════════════════
    // EVENT / CAMPAIGN CONTRIBUTORS ROSTER
    // ══════════════════════════════════════════════════════════════════════════
    } else if (isEventContribRoster || isCampaignContribRoster) {
      let scopedEntity = null;
      let entityLabel = '';
      let entityDetails = [];

      if (isEventContribRoster) {
        if (!report.eventId) { reject(new Error('Event contributors report requires an eventId.')); return; }
        scopedEntity = db.prepare('SELECT id, name, date, location FROM events WHERE id = ?').get(report.eventId);
        if (!scopedEntity) { reject(new Error(`Event ${report.eventId} not found.`)); return; }
        entityLabel = scopedEntity.name || 'Event';
        entityDetails = [
          { label: 'Event', value: scopedEntity.name || '—' },
          { label: 'Date', value: scopedEntity.date || '—' },
          { label: 'Location', value: scopedEntity.location || '—' },
        ];
      } else {
        if (!report.campaignId) { reject(new Error('Campaign contributors report requires a campaignId.')); return; }
        scopedEntity = db.prepare('SELECT id, name, start_date, end_date FROM campaigns WHERE id = ?').get(report.campaignId);
        if (!scopedEntity) { reject(new Error(`Campaign ${report.campaignId} not found.`)); return; }
        entityLabel = scopedEntity.name || 'Campaign';
        entityDetails = [
          { label: 'Campaign', value: scopedEntity.name || '—' },
          { label: 'Start date', value: scopedEntity.start_date || '—' },
          { label: 'End date', value: scopedEntity.end_date || '—' },
        ];
      }

      const whereField = isEventContribRoster ? 't.event_id = ?' : 't.campaign_id = ?';
      const entityId = isEventContribRoster ? report.eventId : report.campaignId;

      const rows = db.prepare(`
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.city, m.state, m.zip,
               m.join_date, c.name AS category_name,
               COUNT(t.id) AS contribution_count,
               COALESCE(SUM(t.amount_cents), 0) AS total_amount_cents
        FROM members m
        LEFT JOIN categories c ON c.id = m.category_id
        JOIN transactions t ON t.member_id = m.id
          AND ${whereField}
          AND COALESCE(t.is_deleted, 0) = 0
          AND UPPER(COALESCE(t.status,'COMPLETED')) = 'COMPLETED'
        GROUP BY m.id
        ORDER BY m.last_name, m.first_name
      `).all(entityId);

      const totalRaised = rows.reduce((s, r) => s + (r.total_amount_cents || 0), 0);

      writeSummaryBlock(doc, [
        ...entityDetails,
        { label: 'Total contributors', value: rows.length },
        { label: 'Total raised', value: formatMoneyFromCents(totalRaised) },
      ]);

      writeSectionHeading(doc, `Contributors — ${entityLabel}`);

      const tableRows = rows.map((r) => ({
        ...r,
        _name: [`${r.last_name || ''}`, `${r.first_name || ''}`].filter(Boolean).join(', ').replace(/^,\s*/, '').trim() || '—',
        _cityzip: fmtCityZip(r),
        _total_paid: formatMoneyFromCents(r.total_amount_cents),
      }));
      drawTable(doc, branding, { columns: CONTRIBUTORS_COLS, rows: tableRows });

    // ══════════════════════════════════════════════════════════════════════════
    // MEMBER-SCOPED REPORTS (monthly / contribution)
    // ══════════════════════════════════════════════════════════════════════════
    } else if (isMemberReport) {
      if (!report.memberId) { reject(new Error('Member report requires a memberId.')); return; }
      const member = db.prepare(`
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.city, m.state, m.zip,
               m.status, m.join_date, c.name AS category_name
        FROM members m
        LEFT JOIN categories c ON c.id = m.category_id
        WHERE m.id = ?
      `).get(report.memberId);
      if (!member) { reject(new Error(`Member ${report.memberId} not found.`)); return; }

      writeSummaryBlock(doc, [
        { label: 'Member', value: `${member.last_name || ''}, ${member.first_name || ''}`.replace(/^,\s*/, '').trim() || '—' },
        { label: 'Email', value: member.email || '—' },
        { label: 'Status', value: member.status || '—' },
        { label: 'Category', value: member.category_name || '—' },
        { label: 'City', value: [member.city, member.state, member.zip].filter(Boolean).join(', ') || '—' },
        { label: 'Period', value: `${startDate} to ${endDate}` },
      ]);

      const txns = db.prepare(`
        SELECT t.*, m.first_name, m.last_name, c.name AS campaign_name, e.name AS event_name
        FROM transactions t
        LEFT JOIN members m ON m.id = t.member_id
        LEFT JOIN campaigns c ON c.id = t.campaign_id
        LEFT JOIN events e ON e.id = t.event_id
        WHERE COALESCE(t.is_deleted,0) = 0
          AND UPPER(COALESCE(t.status,'COMPLETED')) = 'COMPLETED'
          AND t.member_id = ?
          AND date(t.occurred_on) BETWEEN date(?) AND date(?)
        ORDER BY t.occurred_on DESC
      `).all(report.memberId, startDate, endDate);

      const income  = txns.filter((t) => (t.amount_cents ?? 0) > 0).reduce((s, t) => s + t.amount_cents, 0);
      const expense = txns.filter((t) => (t.amount_cents ?? 0) < 0).reduce((s, t) => s + Math.abs(t.amount_cents), 0);

      writeSectionHeading(doc, 'Transactions');
      writeSummaryBlock(doc, [
        { label: 'Records', value: txns.length },
        { label: 'Income', value: formatMoneyFromCents(income) },
        { label: 'Expenses', value: formatMoneyFromCents(expense) },
        { label: 'Net', value: formatMoneyFromCents(income - expense) },
      ]);

      drawTable(doc, branding, { columns: TXN_COLS, rows: enrichTxnRows(txns) });

    // ══════════════════════════════════════════════════════════════════════════
    // EVENT / CAMPAIGN FINANCIAL (transactions)
    // ══════════════════════════════════════════════════════════════════════════
    } else if (isEventContrib || isCampaignContrib) {
      let scopedEntity = null;
      let summaryItems = [];

      if (isEventContrib) {
        if (!report.eventId) { reject(new Error('Event report requires an eventId.')); return; }
        scopedEntity = db.prepare('SELECT id, name, date, location FROM events WHERE id = ?').get(report.eventId);
        if (!scopedEntity) { reject(new Error(`Event ${report.eventId} not found.`)); return; }
        summaryItems = [
          { label: 'Event', value: scopedEntity.name || '—' },
          { label: 'Date', value: scopedEntity.date || '—' },
          { label: 'Location', value: scopedEntity.location || '—' },
          { label: 'Period', value: `${startDate} to ${endDate}` },
        ];
      } else {
        if (!report.campaignId) { reject(new Error('Campaign report requires a campaignId.')); return; }
        scopedEntity = db.prepare('SELECT id, name, start_date, end_date, goal_cents FROM campaigns WHERE id = ?').get(report.campaignId);
        if (!scopedEntity) { reject(new Error(`Campaign ${report.campaignId} not found.`)); return; }
        summaryItems = [
          { label: 'Campaign', value: scopedEntity.name || '—' },
          { label: 'Start date', value: scopedEntity.start_date || '—' },
          { label: 'End date', value: scopedEntity.end_date || '—' },
          { label: 'Goal', value: scopedEntity.goal_cents != null ? formatMoneyFromCents(scopedEntity.goal_cents) : '—' },
        ];
      }

      const whereFilter = isEventContrib ? 'AND t.event_id = ?' : 'AND t.campaign_id = ?';
      const entityId = isEventContrib ? report.eventId : report.campaignId;

      const txns = db.prepare(`
        SELECT t.*, m.first_name, m.last_name, c.name AS campaign_name, e.name AS event_name
        FROM transactions t
        LEFT JOIN members m ON m.id = t.member_id
        LEFT JOIN campaigns c ON c.id = t.campaign_id
        LEFT JOIN events e ON e.id = t.event_id
        WHERE COALESCE(t.is_deleted,0) = 0
          AND UPPER(COALESCE(t.status,'COMPLETED')) = 'COMPLETED'
          AND date(t.occurred_on) BETWEEN date(?) AND date(?)
          ${whereFilter}
        ORDER BY t.occurred_on DESC
      `).all(startDate, endDate, entityId);

      const income  = txns.filter((t) => (t.amount_cents ?? 0) > 0).reduce((s, t) => s + t.amount_cents, 0);
      const expense = txns.filter((t) => (t.amount_cents ?? 0) < 0).reduce((s, t) => s + Math.abs(t.amount_cents), 0);

      writeSummaryBlock(doc, [
        ...summaryItems,
        { label: 'Transactions', value: txns.length },
        { label: 'Income', value: formatMoneyFromCents(income) },
        { label: 'Expenses', value: formatMoneyFromCents(expense) },
        { label: 'Net', value: formatMoneyFromCents(income - expense) },
      ]);

      writeSectionHeading(doc, 'Transactions');
      drawTable(doc, branding, { columns: TXN_COLS, rows: enrichTxnRows(txns) });

    // ══════════════════════════════════════════════════════════════════════════
    // ORG FINANCIAL
    // ══════════════════════════════════════════════════════════════════════════
    } else {
      const txns = db.prepare(`
        SELECT t.*, m.first_name, m.last_name, c.name AS campaign_name, e.name AS event_name
        FROM transactions t
        LEFT JOIN members m ON m.id = t.member_id
        LEFT JOIN campaigns c ON c.id = t.campaign_id
        LEFT JOIN events e ON e.id = t.event_id
        WHERE COALESCE(t.is_deleted,0) = 0
          AND UPPER(COALESCE(t.status,'COMPLETED')) = 'COMPLETED'
          AND date(t.occurred_on) BETWEEN date(?) AND date(?)
        ORDER BY t.occurred_on DESC
      `).all(startDate, endDate);

      const income  = txns.filter((t) => (t.amount_cents ?? 0) > 0).reduce((s, t) => s + t.amount_cents, 0);
      const expense = txns.filter((t) => (t.amount_cents ?? 0) < 0).reduce((s, t) => s + Math.abs(t.amount_cents), 0);

      const activeCampaigns = db.prepare(`
        SELECT * FROM campaigns
        WHERE (start_date IS NULL OR date(start_date) <= date(?))
          AND (end_date IS NULL OR date(end_date) >= date(?))
        ORDER BY start_date DESC
      `).all(endDate, startDate);

      writeSummaryBlock(doc, [
        { label: 'Period', value: `${startDate} to ${endDate}` },
        { label: 'Transactions', value: txns.length },
        { label: 'Income', value: formatMoneyFromCents(income) },
        { label: 'Expenses', value: formatMoneyFromCents(expense) },
        { label: 'Net', value: formatMoneyFromCents(income - expense) },
        { label: 'Active campaigns', value: activeCampaigns.length },
      ]);

      writeSectionHeading(doc, 'Transactions');
      drawTable(doc, branding, { columns: TXN_COLS, rows: enrichTxnRows(txns) });

      if (activeCampaigns.length > 0) {
        writeSectionHeading(doc, 'Campaigns in Period');
        activeCampaigns.forEach((camp) => {
          doc.fontSize(9.5).font(bFont()).fillColor('#334155').text(`${camp.name || '—'}`, { continued: true });
          doc.font('Inter').fillColor('#64748b').text(`  ${camp.start_date || '—'} → ${camp.end_date || '—'}`);
        });
        doc.moveDown(0.5);
      }
    }

    // ── Footer ──────────────────────────────────────────────────────────────
    doc.moveDown(1.5);
    drawRule(doc, { color: '#e2e8f0', thickness: 0.5, after: 6 });
    doc.fontSize(8.5).font('Inter').fillColor('#94a3b8');
    doc.text(
      `Report generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC  ·  ${APP_NAME}`,
      { align: 'center' }
    );

    doc.end();
  });
}

// ── Receipt PDF ───────────────────────────────────────────────────────────────

function buildReceiptPDF(db, transactionId) {
  return new Promise((resolve, reject) => {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ? AND COALESCE(is_deleted, 0) = 0').get(transactionId);
    if (!txn) { reject(new Error('Transaction not found')); return; }

    let member = null;
    if (txn.member_id) member = db.prepare('SELECT first_name, last_name, email FROM members WHERE id = ?').get(txn.member_id);
    let eventName = null;
    if (txn.event_id) eventName = db.prepare('SELECT name FROM events WHERE id = ?').get(txn.event_id)?.name ?? null;
    let campaignName = null;
    if (txn.campaign_id) campaignName = db.prepare('SELECT name FROM campaigns WHERE id = ?').get(txn.campaign_id)?.name ?? null;

    const memberDisplayName = member ? `${member.first_name || ''} ${member.last_name || ''}`.trim() : '';
    const payerLabel = memberDisplayName || String(txn.contributor_name || '').trim() || 'Unattributed external donor';
    const receiptTypeLabel = formatReceiptTxnType(txn.transaction_type || txn.type, campaignName, eventName);
    const paymentMethodLabel = formatPaymentMethodLabel(txn.payment_method);
    const signedAmount = Number(txn.amount_cents || 0);
    const amountLabel = `${signedAmount < 0 ? '-' : ''}${formatMoneyFromCents(Math.abs(signedAmount))}`;

    const doc = new PDFDocument({ margin: MARGIN, size: 'A5' });
    if (!doc || typeof doc.text !== 'function') { reject(new Error('Invalid PDF document instance')); return; }
    registerFonts(doc);
    if (fs.existsSync(getInterFontPath())) doc.font('Inter');
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const branding = getBranding();
    addBrandingHeader(doc, branding);

    doc.fontSize(14).font(bFont()).fillColor('#0f172a').text('Payment Receipt');
    doc.moveDown(0.5);
    drawRule(doc);

    writeSummaryBlock(doc, [
      { label: 'Receipt ID', value: txn.id },
      { label: 'Date', value: txn.occurred_on || '—' },
      { label: 'Type', value: receiptTypeLabel },
      { label: 'Payer', value: payerLabel },
      { label: 'Amount', value: amountLabel },
      { label: 'Payment method', value: paymentMethodLabel },
      { label: 'Status', value: String(txn.status || 'COMPLETED').replace(/_/g, ' ') },
      { label: 'Reference', value: txn.reference || '—' },
    ]);

    if (member || eventName || campaignName || txn.note) {
      writeSectionHeading(doc, 'Details');
      if (member) {
        doc.fontSize(9.5).font(bFont()).fillColor('#475569').text('Member: ', { continued: true });
        doc.font('Inter').fillColor('#1e293b').text(`${member.first_name} ${member.last_name}${member.email ? ' · ' + member.email : ''}`);
      }
      if (eventName) {
        doc.fontSize(9.5).font(bFont()).fillColor('#475569').text('Event: ', { continued: true });
        doc.font('Inter').fillColor('#1e293b').text(eventName);
      }
      if (campaignName) {
        doc.fontSize(9.5).font(bFont()).fillColor('#475569').text('Campaign: ', { continued: true });
        doc.font('Inter').fillColor('#1e293b').text(campaignName);
      }
      if (txn.note) {
        doc.fontSize(9.5).font(bFont()).fillColor('#475569').text('Note: ', { continued: true });
        doc.font('Inter').fillColor('#1e293b').text(txn.note);
      }
    }

    doc.moveDown(1);
    drawRule(doc, { color: '#e2e8f0', after: 6 });
    doc.fontSize(8.5).font('Inter').fillColor('#94a3b8')
       .text(`Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC  ·  ${APP_NAME}`, { align: 'center' });

    doc.end();
  });
}

module.exports = { addBrandingHeader, buildPeriodReportPDF, buildReceiptPDF };

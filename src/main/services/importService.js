const crypto = require('node:crypto');
const XLSX = require('xlsx');
const Papa = require('papaparse');
const { z } = require('zod');

const MEMBERSHIP_STATUSES = ['Active', 'Inactive', 'Terminated', 'Reinstated'];
const GRANT_STATUSES = ['Draft', 'Submitted', 'Awarded', 'Denied', 'Closed'];
const REPORT_TYPES = ['Interim', 'Final'];
const TXN_TYPES = ['DUES', 'CONTRIBUTION'];
const TRANSACTION_TYPES = ['DUES', 'DONATION', 'CAMPAIGN_CONTRIBUTION', 'EVENT_REVENUE', 'OTHER_INCOME'];

function mapLedgerTypeToTxnType(ledgerType) {
  const t = String(ledgerType || '').trim().toUpperCase();
  if (t === 'DUES') return 'dues';
  if (t === 'CONTRIBUTION') return 'donation';
  if (t === 'RECEIPT') return 'dues_payment';
  if (t === 'INVOICE') return 'dues';
  return 'donation';
}

function normalizeTransactionType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (!t) return 'DONATION';
  if (t === 'DUES' || t === 'DUES_PAYMENT' || t === 'RECEIPT' || t === 'INVOICE') return 'DUES';
  if (t === 'DONATION' || t === 'CONTRIBUTION') return 'DONATION';
  if (t === 'CAMPAIGN_CONTRIBUTION' || t === 'CAMPAIGN_REVENUE') return 'CAMPAIGN_CONTRIBUTION';
  if (t === 'EVENT_REVENUE') return 'EVENT_REVENUE';
  if (t === 'OTHER_INCOME') return 'OTHER_INCOME';
  return TRANSACTION_TYPES.includes(t) ? t : 'DONATION';
}

function resolveTransactionType({ memberId, campaignId, eventId, inputType }) {
  if (campaignId) return 'CAMPAIGN_CONTRIBUTION';
  if (eventId) return 'EVENT_REVENUE';
  const normalized = normalizeTransactionType(inputType);
  if (memberId) {
    return normalized === 'DUES' ? 'DUES' : 'DONATION';
  }
  return normalized;
}

function buildLedgerNote(reference, notes) {
  const ref = (reference && String(reference).trim()) || '';
  const note = (notes && String(notes).trim()) || '';
  if (ref && note) return `Ref: ${ref} | ${note}`;
  if (ref) return `Ref: ${ref}`;
  if (note) return note;
  return null;
}

function getGeneralContributionMemberId(db, orgId = 1) {
  const row = db
    .prepare("SELECT id FROM members WHERE first_name = 'General' AND last_name = 'Contribution' AND COALESCE(organization_id, 1) = ? LIMIT 1")
    .get(orgId);
  if (row?.id) return row.id;
  const result = db
    .prepare("INSERT INTO members (first_name, last_name, status, organization_id) VALUES ('General', 'Contribution', 'active', ?)")
    .run(orgId);
  return result.lastInsertRowid;
}

function ensureMemberId(db, memberId, orgId = 1, { allowNull = false } = {}) {
  if (memberId !== undefined && memberId !== null && memberId !== '') {
    const normalized = Number(memberId);
    if (Number.isFinite(normalized) && normalized > 0) return normalized;
  }
  if (allowNull) return null;
  return getGeneralContributionMemberId(db, orgId);
}

function resolveContributorType({ memberId, campaignId, eventId }) {
  if (memberId) return 'MEMBER';
  if (campaignId) return 'CAMPAIGN_REVENUE';
  if (eventId) return 'EVENT_REVENUE';
  return 'NON_MEMBER';
}

const TEMPLATE_FIELDS = {
  members: [
    'first_name',
    'last_name',
    'email',
    'phone',
    'address',
    'city',
    'state',
    'zip',
    'join_date',
    'member_id',
  ],
  membership_periods: [
    'member_id',
    'member_email',
    'start_date',
    'end_date',
    'status',
    'termination_reason',
    'reinstated_from_period_id',
  ],
  financial_transactions: [
    'member_id',
    'member_email',
    'amount',
    'txn_date',
    'txn_type',
    'reference',
    'notes',
  ],
  campaigns: [
    'campaign_name',
    'campaign_start_date',
    'campaign_end_date',
    'member_id',
    'member_email',
    'amount',
    'txn_date',
    'contributor_name',
    'contributor_email',
    'reference',
    'notes',
  ],
  grants: [
    'grant_name',
    'funder_name',
    'status',
    'amount_requested',
    'amount_awarded',
    'start_date',
    'end_date',
    'reporting_due_date',
    'notes',
    'report_type',
    'report_due_date',
    'report_submitted',
    'report_submitted_date',
    'report_notes',
  ],
};

function escapeCsvVal(v) {
  const s = String(v ?? '');
  const q = '"';
  return (s.includes(',') || s.includes(q) || s.includes('\n'))
    ? (q + s.replace(new RegExp(q, 'g'), q + q) + q)
    : s;
}

function toDateParts(d) {
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTodayIso() {
  return toDateParts(new Date());
}

function normalizeString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function normalizeEmail(v) {
  const s = normalizeString(v);
  return s ? s.toLowerCase() : undefined;
}

function parseExcelDate(n) {
  const d = XLSX.SSF.parse_date_code(n);
  if (!d) return null;
  const jsDate = new Date(Date.UTC(d.y, d.m - 1, d.d));
  if (Number.isNaN(jsDate.getTime())) return null;
  return toDateParts(jsDate);
}

function normalizeDate(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (v instanceof Date) return toDateParts(v);
  if (typeof v === 'number') return parseExcelDate(v) || undefined;
  const s = String(v).trim();
  if (!s) return undefined;

  // ISO format already correct
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // Format YYYY/MM/DD → convert to ISO
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
    return s.replace(/\//g, '-');
  }

  // Format M/D/YYYY or MM/DD/YYYY → convert to ISO
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [mm, dd, yyyy] = s.split('/');
    const paddedMonth = mm.padStart(2, '0');
    const paddedDay = dd.padStart(2, '0');
    return `${yyyy}-${paddedMonth}-${paddedDay}`;
  }

  // If none of the above matched, return undefined
  return undefined;
}

function normalizeAmount(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,]/g, '').trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeBoolean(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return undefined;
}

function normalizeEnumValue(value, allowed) {
  if (!value) return undefined;
  const upper = String(value).trim().toUpperCase();
  const match = allowed.find((a) => a.toUpperCase() === upper);
  return match || value;
}

function buildErrorCsv(errors) {
  const lines = ['Row,Field,Message'];
  for (const e of errors) {
    lines.push(`${e.rowNum},${escapeCsvVal(e.field)},${escapeCsvVal(e.message)}`);
  }
  return lines.join('\\n');
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function toRowArray(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  if (!rows.length) return { headers: [], data: [] };
  const headers = rows[0].map((h) => String(h || '').trim()).filter(Boolean);
  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const rowArr = rows[i];
    if (!rowArr || rowArr.every((v) => v === null || v === undefined || String(v).trim() === '')) {
      continue;
    }
    const row = { __rowNum: i + 1 };
    headers.forEach((h, idx) => {
      row[h] = rowArr[idx] ?? '';
    });
    data.push(row);
  }
  return { headers, data };
}

class ImportService {
  constructor(db) {
    this.db = db;
  }

  parseFileToRows({ buffer, filename, sheetName, maxRows }) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const text = buffer.toString('utf8');
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
      if (parsed.errors?.length) {
        throw new Error(parsed.errors[0]?.message || 'CSV parse failed');
      }
      const headers = parsed.meta?.fields || Object.keys(parsed.data?.[0] || {});
      const rows = parsed.data.map((row, idx) => ({ __rowNum: idx + 2, ...row }));
      const limited = typeof maxRows === 'number' ? rows.slice(0, maxRows) : rows;
      return {
        headers,
        rows: limited,
        totalRows: rows.length,
        sheetNames: [],
        sheetName: null,
      };
    }

    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, dateNF: 'yyyy-mm-dd' });
    const sheetNames = wb.SheetNames || [];
    const targetSheet = sheetName || sheetNames[0];
    if (!targetSheet) {
      throw new Error('No sheets found in file.');
    }
    const sheet = wb.Sheets[targetSheet];
    const { headers, data } = toRowArray(sheet);
    const limited = typeof maxRows === 'number' ? data.slice(0, maxRows) : data;
    return {
      headers,
      rows: limited,
      totalRows: data.length,
      sheetNames,
      sheetName: targetSheet,
    };
  }

  buildTemplate(importType) {
    const fields = TEMPLATE_FIELDS[importType] || [];
    const headerLine = fields.join(',');
    const sampleLine = fields.map(() => '').join(',');
    const csv = `${headerLine}\\n${sampleLine}`;
    return {
      filename: `civicflow_${importType}_template.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    };
  }

  previewImport(importType, mapping, rows, options = {}) {
    const { sheetName, fileName } = options;
    const todayIso = getTodayIso();
    const previewRows = [];
    const errors = [];
    const warnings = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errorCount = 0;
    let warningCount = 0;

    const addError = (rowNum, field, message) => {
      errors.push({ rowNum, field, message });
    };
    const addWarning = (rowNum, field, message) => {
      warnings.push({ rowNum, field, message });
    };

    const getVal = (row, key) => {
      const col = mapping?.[key];
      if (!col) return undefined;
      return row[col];
    };

    const requireGrantsTables = () => {
      const grantsTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='grants'").get();
      const reportsTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='grant_reports'").get();
      return { grantsTable: !!grantsTable, reportsTable: !!reportsTable };
    };

    const classifyMembers = (row, rowNum) => {
      const data = {
        first_name: normalizeString(getVal(row, 'first_name')),
        last_name: normalizeString(getVal(row, 'last_name')),
        email: normalizeEmail(getVal(row, 'email')),
        phone: normalizeString(getVal(row, 'phone')),
        address: normalizeString(getVal(row, 'address')),
        city: normalizeString(getVal(row, 'city')),
        state: normalizeString(getVal(row, 'state')),
        zip: normalizeString(getVal(row, 'zip')),
        join_date: normalizeDate(getVal(row, 'join_date')),
        member_id: normalizeString(getVal(row, 'member_id')),
      };

      const schema = z.object({
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        email: z.string().email().optional(),
        member_id: z.string().optional(),
      });

      const result = schema.safeParse({
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        email: data.email,
        member_id: data.member_id,
      });

      if (!result.success) {
        for (const issue of result.error.issues) {
          addError(rowNum, issue.path[0] || 'row', issue.message);
        }
      }

      if (!data.email && !data.member_id) {
        addError(rowNum, 'email/member_id', 'Email or Member ID is required for matching.');
      }

      let existing = null;
      if (data.member_id) {
        existing = this.db.prepare('SELECT * FROM members WHERE id = ?').get(Number(data.member_id));
        if (existing && data.email && existing.email && existing.email.toLowerCase() !== data.email.toLowerCase()) {
          addError(rowNum, 'email', 'Email does not match existing member ID.');
        }
      }
      if (!existing && data.email) {
        existing = this.db.prepare('SELECT * FROM members WHERE email = ? COLLATE NOCASE').get(data.email);
      }

      const updateFields = ['email', 'phone', 'address', 'city', 'state', 'zip', 'join_date'];
      const hasUpdate = updateFields.some((f) => data[f] !== undefined && data[f] !== null && data[f] !== '');

      if (errors.some((e) => e.rowNum === rowNum)) {
        return { action: 'ERROR', data };
      }

      if (existing) {
        if (!hasUpdate) {
          addWarning(rowNum, 'row', 'No updatable fields provided; row will be skipped.');
          return { action: 'SKIP', data };
        }
        return { action: 'UPDATE', data, existingId: existing.id };
      }

      return { action: 'INSERT', data };
    };

    const classifyMembershipPeriods = (row, rowNum) => {
      const data = {
        member_id: normalizeString(getVal(row, 'member_id')),
        member_email: normalizeEmail(getVal(row, 'member_email')),
        start_date: normalizeDate(getVal(row, 'start_date')),
        end_date: normalizeDate(getVal(row, 'end_date')),
        status: normalizeEnumValue(normalizeString(getVal(row, 'status')), MEMBERSHIP_STATUSES) || 'Active',
        termination_reason: normalizeString(getVal(row, 'termination_reason')),
        reinstated_from_period_id: normalizeString(getVal(row, 'reinstated_from_period_id')),
      };

      if (!data.member_id && !data.member_email) {
        addError(rowNum, 'member_id/member_email', 'Member ID or email is required.');
      }
      if (!data.start_date) {
        addError(rowNum, 'start_date', 'Start date is required.');
      }
      if (data.status && !MEMBERSHIP_STATUSES.includes(data.status)) {
        addError(rowNum, 'status', `Status must be one of ${MEMBERSHIP_STATUSES.join(', ')}`);
      }
      if (data.end_date && data.status !== 'Terminated') {
        addError(rowNum, 'end_date', 'End date requires status Terminated.');
      }
      if (data.start_date && data.end_date && data.end_date < data.start_date) {
        addError(rowNum, 'end_date', 'End date cannot be before start date.');
      }

      let memberId = null;
      if (data.member_id) {
        const member = this.db.prepare('SELECT id FROM members WHERE id = ?').get(Number(data.member_id));
        if (!member) addError(rowNum, 'member_id', 'Member ID not found.');
        else memberId = member.id;
      } else if (data.member_email) {
        const member = this.db.prepare('SELECT id FROM members WHERE email = ? COLLATE NOCASE').get(data.member_email);
        if (!member) addError(rowNum, 'member_email', 'Member email not found.');
        else memberId = member.id;
      }

      if (!data.end_date && memberId) {
        const open = this.db.prepare('SELECT id FROM membership_periods WHERE member_id = ? AND end_date IS NULL').get(memberId);
        if (open) addError(rowNum, 'start_date', 'Member already has an open membership period.');
      }

      if (errors.some((e) => e.rowNum === rowNum)) {
        return { action: 'ERROR', data, memberId: memberId || null };
      }

      return { action: 'INSERT', data, memberId };
    };

    const classifyFinancialTransactions = (row, rowNum) => {
      const data = {
        member_id: normalizeString(getVal(row, 'member_id')),
        member_email: normalizeEmail(getVal(row, 'member_email')),
        amount: normalizeAmount(getVal(row, 'amount')),
        txn_date: normalizeDate(getVal(row, 'txn_date')),
        txn_type: normalizeString(getVal(row, 'txn_type'))?.toUpperCase() || 'DUES',
        reference: normalizeString(getVal(row, 'reference')),
        notes: normalizeString(getVal(row, 'notes')),
      };

      if (!data.member_id && !data.member_email) addError(rowNum, 'member_id/member_email', 'Member ID or email is required.');
      if (data.amount === undefined) addError(rowNum, 'amount', 'Amount is required.');
      if (data.amount !== undefined && data.amount <= 0) addError(rowNum, 'amount', 'Amount must be positive.');
      if (!data.txn_date) addError(rowNum, 'txn_date', 'Transaction date is required.');
      if (data.txn_date && data.txn_date > todayIso) addError(rowNum, 'txn_date', 'Transaction date cannot be in the future.');
      if (!TXN_TYPES.includes(data.txn_type)) addError(rowNum, 'txn_type', `Type must be one of ${TXN_TYPES.join(', ')}`);

      let memberId = null;
      if (data.member_id) {
        const member = this.db.prepare('SELECT id FROM members WHERE id = ?').get(Number(data.member_id));
        if (!member) addError(rowNum, 'member_id', 'Member ID not found.');
        else memberId = member.id;
      } else if (data.member_email) {
        const member = this.db.prepare('SELECT id FROM members WHERE email = ? COLLATE NOCASE').get(data.member_email);
        if (!member) addError(rowNum, 'member_email', 'Member email not found.');
        else memberId = member.id;
      }

      let periodId = null;
      if (memberId) {
        const period = this.db.prepare('SELECT id FROM membership_periods WHERE member_id = ? AND end_date IS NULL ORDER BY start_date DESC LIMIT 1').get(memberId);
        if (!period) addError(rowNum, 'member_id', 'No open membership period found for member.');
        else periodId = period.id;
      }

      if (errors.some((e) => e.rowNum === rowNum)) {
        return { action: 'ERROR', data, memberId, periodId };
      }

      return { action: 'INSERT', data, memberId, periodId };
    };

    const classifyCampaigns = (row, rowNum) => {
      const data = {
        campaign_name: normalizeString(getVal(row, 'campaign_name')),
        campaign_start_date: normalizeDate(getVal(row, 'campaign_start_date')),
        campaign_end_date: normalizeDate(getVal(row, 'campaign_end_date')),
        member_id: normalizeString(getVal(row, 'member_id')),
        member_email: normalizeEmail(getVal(row, 'member_email')),
        amount: normalizeAmount(getVal(row, 'amount')),
        txn_date: normalizeDate(getVal(row, 'txn_date')),
        contributor_name: normalizeString(getVal(row, 'contributor_name')),
        contributor_email: normalizeEmail(getVal(row, 'contributor_email')),
        reference: normalizeString(getVal(row, 'reference')),
        notes: normalizeString(getVal(row, 'notes')),
      };

      const hasContribution = data.amount !== undefined || !!data.txn_date;

      if (!data.campaign_name && !hasContribution) {
        addError(rowNum, 'campaign_name', 'Campaign name is required for campaign rows.');
      }

      if (hasContribution) {
        if (!data.member_id && !data.member_email) {
          addError(rowNum, 'member_id/member_email', 'Member ID or email is required for contributions.');
        }
        if (data.amount === undefined) addError(rowNum, 'amount', 'Contribution amount is required.');
        if (data.amount !== undefined && data.amount <= 0) addError(rowNum, 'amount', 'Amount must be positive.');
        if (!data.txn_date) addError(rowNum, 'txn_date', 'Contribution date is required.');
        if (data.txn_date && data.txn_date > todayIso) addError(rowNum, 'txn_date', 'Contribution date cannot be in the future.');
      }

      let memberId = null;
      if (data.member_id) {
        const member = this.db.prepare('SELECT id FROM members WHERE id = ?').get(Number(data.member_id));
        if (!member) addError(rowNum, 'member_id', 'Member ID not found.');
        else memberId = member.id;
      } else if (data.member_email) {
        const member = this.db.prepare('SELECT id FROM members WHERE email = ? COLLATE NOCASE').get(data.member_email);
        if (!member) addError(rowNum, 'member_email', 'Member email not found.');
        else memberId = member.id;
      }

      let campaignId = null;
      if (data.campaign_name) {
        const campaign = this.db.prepare('SELECT id FROM campaigns WHERE name = ? COLLATE NOCASE').get(data.campaign_name);
        if (campaign) campaignId = campaign.id;
      }

      if (errors.some((e) => e.rowNum === rowNum)) {
        return { action: 'ERROR', data, memberId, campaignId };
      }

      if (data.campaign_name && !campaignId) {
        return { action: 'INSERT', data, memberId, campaignId: null };
      }

      if (data.campaign_name && campaignId && !hasContribution) {
        addWarning(rowNum, 'campaign_name', 'Campaign already exists; row will be skipped.');
        return { action: 'SKIP', data, memberId, campaignId };
      }

      return { action: 'INSERT', data, memberId, campaignId };
    };

    const classifyGrants = (row, rowNum) => {
      const data = {
        grant_name: normalizeString(getVal(row, 'grant_name')),
        funder_name: normalizeString(getVal(row, 'funder_name')),
        status: normalizeEnumValue(normalizeString(getVal(row, 'status')), GRANT_STATUSES) || 'Draft',
        amount_requested: normalizeAmount(getVal(row, 'amount_requested')),
        amount_awarded: normalizeAmount(getVal(row, 'amount_awarded')),
        start_date: normalizeDate(getVal(row, 'start_date')),
        end_date: normalizeDate(getVal(row, 'end_date')),
        reporting_due_date: normalizeDate(getVal(row, 'reporting_due_date')),
        notes: normalizeString(getVal(row, 'notes')),
        report_type: normalizeEnumValue(normalizeString(getVal(row, 'report_type')), REPORT_TYPES),
        report_due_date: normalizeDate(getVal(row, 'report_due_date')),
        report_submitted: normalizeBoolean(getVal(row, 'report_submitted')),
        report_submitted_date: normalizeDate(getVal(row, 'report_submitted_date')),
        report_notes: normalizeString(getVal(row, 'report_notes')),
      };

      if (!data.grant_name) addError(rowNum, 'grant_name', 'Grant name is required.');
      if (data.status && !GRANT_STATUSES.includes(data.status)) {
        addError(rowNum, 'status', `Status must be one of ${GRANT_STATUSES.join(', ')}`);
      }
      if (data.report_type && !REPORT_TYPES.includes(data.report_type)) {
        addError(rowNum, 'report_type', `Report type must be one of ${REPORT_TYPES.join(', ')}`);
      }

      const { grantsTable, reportsTable } = requireGrantsTables();
      if (!grantsTable) {
        addError(rowNum, 'grants', 'Grants module is not installed.');
      }

      let existing = null;
      if (data.grant_name && grantsTable) {
        if (data.funder_name) {
          existing = this.db.prepare('SELECT * FROM grants WHERE grant_name = ? COLLATE NOCASE AND funder_name = ? COLLATE NOCASE').get(
            data.grant_name,
            data.funder_name
          );
        }
        if (!existing) {
          existing = this.db.prepare('SELECT * FROM grants WHERE grant_name = ? COLLATE NOCASE').get(data.grant_name);
        }
      }

      if (errors.some((e) => e.rowNum === rowNum)) {
        return { action: 'ERROR', data, existing, reportsTable };
      }

      if (existing && existing.status === 'Closed') {
        const criticalFields = ['amount_requested', 'amount_awarded', 'status', 'start_date', 'end_date', 'reporting_due_date'];
        const hasCritical = criticalFields.some((f) => data[f] !== undefined && data[f] !== null && data[f] !== '');
        if (hasCritical) {
          addWarning(rowNum, 'grant_name', 'Closed grants will not be overwritten; row skipped.');
          return { action: 'SKIP', data, existing, reportsTable };
        }
      }

      if (existing) {
        const updatable = ['notes', 'amount_awarded', 'status', 'reporting_due_date', 'end_date'];
        const hasUpdate = updatable.some((f) => data[f] !== undefined && data[f] !== null && data[f] !== '');
        if (!hasUpdate && !data.report_type && !data.report_due_date) {
          addWarning(rowNum, 'grant_name', 'No updatable fields provided; row will be skipped.');
          return { action: 'SKIP', data, existing, reportsTable };
        }
        return { action: 'UPDATE', data, existing, reportsTable };
      }

      return { action: 'INSERT', data, existing: null, reportsTable };
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = row.__rowNum || i + 2;
      let classification = null;

      if (importType === 'members') {
        classification = classifyMembers(row, rowNum);
      } else if (importType === 'membership_periods') {
        classification = classifyMembershipPeriods(row, rowNum);
      } else if (importType === 'financial_transactions') {
        classification = classifyFinancialTransactions(row, rowNum);
      } else if (importType === 'campaigns') {
        classification = classifyCampaigns(row, rowNum);
      } else if (importType === 'grants') {
        classification = classifyGrants(row, rowNum);
      } else {
        addError(rowNum, 'import_type', `Unknown import type: ${importType}`);
        classification = { action: 'ERROR', data: {} };
      }

      const rowErrors = errors.filter((e) => e.rowNum === rowNum);
      const rowWarnings = warnings.filter((w) => w.rowNum === rowNum);

      let action = classification.action;
      const baseAction = action;
      if (rowErrors.length > 0) action = 'ERROR';
      else if (rowWarnings.length > 0 && action === 'INSERT') action = 'WARNING';

      if (baseAction === 'INSERT') inserted++;
      else if (baseAction === 'UPDATE') updated++;
      else if (baseAction === 'SKIP') skipped++;
      if (action === 'ERROR') errorCount++;
      if (rowWarnings.length) warningCount++;

      previewRows.push({
        rowNum,
        action,
        data: classification.data,
        errors: rowErrors.map((e) => e.message),
        warnings: rowWarnings.map((w) => w.message),
      });
    }

    return {
      ok: true,
      fileName: fileName || null,
      sheetName: sheetName || null,
      summary: {
        totalRows: rows.length,
        inserted,
        updated,
        skipped,
        errorCount,
        warningCount,
      },
      previewRows: previewRows.slice(0, 50),
      errors,
      warnings,
      errorCsv: buildErrorCsv(errors),
    };
  }

  commitImport(importType, mapping, rows, options = {}) {
    const preview = this.previewImport(importType, mapping, rows, options);
    if (!preview.ok) return preview;
    if (preview.summary.errorCount > 0) {
      const failedId = this._recordFailedImport(importType, options, preview);
      return { ok: false, error: 'Import blocked due to validation errors.', importRunId: failedId, preview };
    }

    const fileHash = options.fileHash || null;
    const fileName = options.fileName || 'import';
    const now = new Date().toISOString();
    const counts = preview.summary;

    const txn = this.db.transaction(() => {
      const runResult = this.db.prepare(`
        INSERT INTO import_runs (import_type, file_name, file_hash, total_rows, inserted_rows, updated_rows, skipped_rows, error_rows, status, errors_json, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PREVIEW', ?, ?, ?)
      `).run(
        importType,
        fileName,
        fileHash,
        counts.totalRows,
        counts.inserted,
        counts.updated,
        counts.skipped,
        counts.errorCount,
        preview.errors?.length ? JSON.stringify(preview.errors) : null,
        options.createdByUserId || null,
        now
      );

      const importRunId = runResult.lastInsertRowid;

      if (importType === 'members') {
        for (const row of rows) {
          const rowPreview = this.previewImport(importType, mapping, [row], options);
          const entry = rowPreview.previewRows?.[0];
          if (!entry || entry.action === 'ERROR' || entry.action === 'SKIP') continue;
          const data = entry.data;
          let existing = null;
          if (data.member_id) {
            existing = this.db.prepare('SELECT * FROM members WHERE id = ?').get(Number(data.member_id));
          }
          if (!existing && data.email) {
            existing = this.db.prepare('SELECT * FROM members WHERE email = ? COLLATE NOCASE').get(data.email);
          }
          if (existing) {
            this.db.prepare(`
              UPDATE members SET
                email = COALESCE(?, email),
                phone = COALESCE(?, phone),
                address = COALESCE(?, address),
                city = COALESCE(?, city),
                state = COALESCE(?, state),
                zip = COALESCE(?, zip),
                join_date = COALESCE(?, join_date),
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              data.email || null,
              data.phone || null,
              data.address || null,
              data.city || null,
              data.state || null,
              data.zip || null,
              data.join_date || null,
              existing.id
            );
          } else {
            const joinDate = data.join_date || getTodayIso();
            const result = this.db.prepare(`
              INSERT INTO members (first_name, last_name, email, phone, address, city, state, zip, join_date, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
            `).run(
              data.first_name,
              data.last_name,
              data.email || null,
              data.phone || null,
              data.address || null,
              data.city || null,
              data.state || null,
              data.zip || null,
              joinDate
            );
            this.db.prepare(`
              INSERT INTO membership_periods (member_id, start_date, status)
              VALUES (?, ?, 'Active')
            `).run(result.lastInsertRowid, joinDate);
          }
        }
      } else if (importType === 'membership_periods') {
        for (const row of rows) {
          const rowPreview = this.previewImport(importType, mapping, [row], options);
          const entry = rowPreview.previewRows?.[0];
          if (!entry || entry.action === 'ERROR' || entry.action === 'SKIP') continue;
          const data = entry.data;
          let memberId = null;
          if (data.member_id) {
            const m = this.db.prepare('SELECT id FROM members WHERE id = ?').get(Number(data.member_id));
            memberId = m?.id || null;
          } else if (data.member_email) {
            const m = this.db.prepare('SELECT id FROM members WHERE email = ? COLLATE NOCASE').get(data.member_email);
            memberId = m?.id || null;
          }
          if (!memberId) continue;

          this.db.prepare(`
            INSERT INTO membership_periods (member_id, start_date, end_date, status, termination_reason, reinstated_from_period_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            memberId,
            data.start_date,
            data.end_date || null,
            data.status || 'Active',
            data.termination_reason || null,
            data.reinstated_from_period_id ? Number(data.reinstated_from_period_id) : null
          );
        }
      } else if (importType === 'financial_transactions') {
        for (const row of rows) {
          const rowPreview = this.previewImport(importType, mapping, [row], options);
          const entry = rowPreview.previewRows?.[0];
          if (!entry || entry.action === 'ERROR' || entry.action === 'SKIP') continue;
          const data = entry.data;
          let memberId = null;
          if (data.member_id) {
            const m = this.db.prepare('SELECT id FROM members WHERE id = ?').get(Number(data.member_id));
            memberId = m?.id || null;
          } else if (data.member_email) {
            const m = this.db.prepare('SELECT id FROM members WHERE email = ? COLLATE NOCASE').get(data.member_email);
            memberId = m?.id || null;
          }
          memberId = ensureMemberId(this.db, memberId, 1);
          const contributorType = resolveContributorType({ memberId, campaignId: null, eventId: null });
          let period = this.db.prepare('SELECT id FROM membership_periods WHERE member_id = ? AND end_date IS NULL ORDER BY start_date DESC LIMIT 1').get(memberId);
          if (!period) {
            const startDate = data.txn_date || getTodayIso();
            const result = this.db.prepare(
              "INSERT INTO membership_periods (member_id, start_date, status) VALUES (?, ?, 'Active')"
            ).run(memberId, startDate);
            period = { id: result.lastInsertRowid };
          }
          this.db.prepare(`
            INSERT INTO transactions (type, transaction_type, amount_cents, occurred_on, member_id, contributor_type, event_id, campaign_id, note, is_imported, organization_id, payment_method, status, source, reference, is_deleted)
            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, 1, ?, 'COMPLETED', 'IMPORT', ?, 0)
          `).run(
            mapLedgerTypeToTxnType(data.txn_type),
            normalizeTransactionType(data.txn_type),
            Math.round(Number(data.amount) * 100),
            data.txn_date,
            memberId,
            contributorType,
            buildLedgerNote(data.reference, data.notes),
            'IMPORT',
            data.reference || null
          );
        }
      } else if (importType === 'campaigns') {
        for (const row of rows) {
          const rowPreview = this.previewImport(importType, mapping, [row], options);
          const entry = rowPreview.previewRows?.[0];
          if (!entry || entry.action === 'ERROR' || entry.action === 'SKIP') continue;
          const data = entry.data;
          let campaignId = null;
          if (data.campaign_name) {
            const existing = this.db.prepare('SELECT id FROM campaigns WHERE name = ? COLLATE NOCASE').get(data.campaign_name);
            if (existing) {
              campaignId = existing.id;
            } else {
              const result = this.db.prepare(`
                INSERT INTO campaigns (name, start_date, end_date, is_imported)
                VALUES (?, ?, ?, 1)
              `).run(
                data.campaign_name,
                data.campaign_start_date || null,
                data.campaign_end_date || null
              );
              campaignId = result.lastInsertRowid;
            }
          }

          if (data.amount !== undefined) {
            let memberId = null;
            if (data.member_id) {
              const m = this.db.prepare('SELECT id FROM members WHERE id = ?').get(Number(data.member_id));
              memberId = m?.id || null;
            } else if (data.member_email) {
              const m = this.db.prepare('SELECT id FROM members WHERE email = ? COLLATE NOCASE').get(data.member_email);
              memberId = m?.id || null;
            }
            memberId = ensureMemberId(this.db, memberId, 1, { allowNull: true });
            const noteVal = data.reference
              ? (data.notes ? `${data.notes} (Ref: ${data.reference})` : `Ref: ${data.reference}`)
              : (data.notes || null);
            const contributorType = resolveContributorType({ memberId, campaignId: campaignId || null, eventId: null });
            const transactionType = resolveTransactionType({ memberId, campaignId: campaignId || null, eventId: null, inputType: 'CAMPAIGN_CONTRIBUTION' });
            this.db.prepare(`
              INSERT INTO transactions (type, transaction_type, amount_cents, occurred_on, member_id, contributor_type, event_id, campaign_id, note, contributor_name, contributor_email, is_imported, payment_method, status, source, reference)
              VALUES ('donation', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, 'COMPLETED', 'IMPORT', ?)
            `).run(
              transactionType,
              Math.round(Number(data.amount) * 100),
              data.txn_date,
              memberId,
              contributorType,
              campaignId || null,
              noteVal,
              data.contributor_name || null,
              data.contributor_email || null,
              'IMPORT',
              data.reference || null
            );
          }
        }
      } else if (importType === 'grants') {
        const grantsTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='grants'").get();
        if (!grantsTable) throw new Error('Grants module not installed.');
        const reportsTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='grant_reports'").get();

        for (const row of rows) {
          const rowPreview = this.previewImport(importType, mapping, [row], options);
          const entry = rowPreview.previewRows?.[0];
          if (!entry || entry.action === 'ERROR' || entry.action === 'SKIP') continue;
          const data = entry.data;

          let existing = null;
          if (data.funder_name) {
            existing = this.db.prepare('SELECT * FROM grants WHERE grant_name = ? COLLATE NOCASE AND funder_name = ? COLLATE NOCASE').get(
              data.grant_name,
              data.funder_name
            );
          }
          if (!existing) {
            existing = this.db.prepare('SELECT * FROM grants WHERE grant_name = ? COLLATE NOCASE').get(data.grant_name);
          }

          let grantId = null;
          if (existing) {
            grantId = existing.id;
            this.db.prepare(`
              UPDATE grants SET
                notes = COALESCE(?, notes),
                amount_awarded = COALESCE(?, amount_awarded),
                status = COALESCE(?, status),
                reporting_due_date = COALESCE(?, reporting_due_date),
                end_date = COALESCE(?, end_date),
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              data.notes || null,
              data.amount_awarded || null,
              data.status || null,
              data.reporting_due_date || null,
              data.end_date || null,
              grantId
            );
          } else {
            const result = this.db.prepare(`
              INSERT INTO grants (grant_name, funder_name, amount_requested, amount_awarded, status, start_date, end_date, reporting_due_date, notes, is_imported)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `).run(
              data.grant_name,
              data.funder_name || null,
              data.amount_requested || null,
              data.amount_awarded || null,
              data.status || 'Draft',
              data.start_date || null,
              data.end_date || null,
              data.reporting_due_date || null,
              data.notes || null
            );
            grantId = result.lastInsertRowid;
          }

          if (reportsTable && data.report_type) {
            this.db.prepare(`
              INSERT INTO grant_reports (grant_id, report_type, due_date, submitted, submitted_date, notes)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              grantId,
              data.report_type,
              data.report_due_date || null,
              data.report_submitted ? 1 : 0,
              data.report_submitted_date || null,
              data.report_notes || null
            );
          }
        }
      } else {
        throw new Error(`Unknown import type: ${importType}`);
      }

      this.db.prepare(`
        UPDATE import_runs
        SET status = 'COMPLETED',
            inserted_rows = ?,
            updated_rows = ?,
            skipped_rows = ?,
            error_rows = ?,
            errors_json = ?
        WHERE id = ?
      `).run(
        counts.inserted,
        counts.updated,
        counts.skipped,
        counts.errorCount,
        preview.errors?.length ? JSON.stringify(preview.errors) : null,
        importRunId
      );

      this._writeAuditLog(`IMPORT_${String(importType).toUpperCase()}`, 'import_run', importRunId, {
        importType,
        fileName,
        fileHash,
        counts,
      });

      return { importRunId };
    });

    try {
      const result = txn();
      return {
        ok: true,
        importRunId: result.importRunId,
        counts,
      };
    } catch (err) {
      const failedId = this._recordFailedImport(importType, { ...options, fileHash }, preview, err);
      return { ok: false, error: err?.message || 'Import failed. All changes were rolled back.', importRunId: failedId };
    }
  }

  _recordFailedImport(importType, options, preview, err) {
    try {
      const result = this.db.prepare(`
        INSERT INTO import_runs (import_type, file_name, file_hash, total_rows, inserted_rows, updated_rows, skipped_rows, error_rows, status, errors_json, created_by_user_id)
        VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'FAILED', ?, ?)
      `).run(
        importType,
        options?.fileName || 'import',
        options?.fileHash || null,
        preview?.summary?.totalRows || 0,
        preview?.summary?.errorCount || 0,
        JSON.stringify({
          errors: preview?.errors || [],
          message: err?.message || null,
        }),
        options?.createdByUserId || null
      );
      return result.lastInsertRowid;
    } catch {
      return null;
    }
  }

  _writeAuditLog(action, entityType, entityId, metadata) {
    try {
      this.db.prepare(`
        INSERT INTO audit_logs (action, entity_type, entity_id, metadata_json)
        VALUES (?, ?, ?, ?)
      `).run(action, entityType, entityId, metadata ? JSON.stringify(metadata) : null);
    } catch {
      // Swallow audit errors
    }
  }
}

function buildFileHash(buffer) {
  return sha256Hex(buffer);
}

module.exports = {
  ImportService,
  buildFileHash,
};

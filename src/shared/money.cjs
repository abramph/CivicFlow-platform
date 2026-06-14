function stripCurrencyDecorators(value) {
  return value
    .replace(/[\s$€£¥]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
}

function detectDecimalSeparator(value) {
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    return lastDot > lastComma ? '.' : ',';
  }

  if (lastComma >= 0) {
    const digitsAfter = value.length - lastComma - 1;
    return digitsAfter > 0 && digitsAfter <= 2 ? ',' : null;
  }

  if (lastDot >= 0) {
    const digitsAfter = value.length - lastDot - 1;
    return digitsAfter > 0 && digitsAfter <= 2 ? '.' : null;
  }

  return null;
}

function normalizeMoneyString(rawValue) {
  if (rawValue === undefined || rawValue === null) return null;
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? String(rawValue) : null;
  }

  const trimmed = stripCurrencyDecorators(String(rawValue).trim());
  if (!trimmed) return null;
  if (/[^0-9,.-]/.test(trimmed)) return null;

  let sign = '';
  let unsigned = trimmed;
  if (unsigned.startsWith('-')) {
    sign = '-';
    unsigned = unsigned.slice(1);
  } else if (unsigned.startsWith('+')) {
    unsigned = unsigned.slice(1);
  }

  if (!unsigned || /[+-]/.test(unsigned)) return null;

  const decimalSeparator = detectDecimalSeparator(unsigned);
  let normalized = unsigned;

  if (decimalSeparator) {
    const thousandsSeparator = decimalSeparator === '.' ? ',' : '.';
    normalized = normalized.replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '');
    const decimalCount = normalized.split(decimalSeparator).length - 1;
    if (decimalCount > 1) return null;
    normalized = normalized.replace(decimalSeparator, '.');
  } else {
    normalized = normalized.replace(/[.,]/g, '');
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return `${sign}${normalized}`;
}

function parseMoneyValue(value) {
  const normalized = normalizeMoneyString(value);
  if (normalized == null) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseMoneyToCents(value) {
  const amount = parseMoneyValue(value);
  return amount == null ? null : Math.round(amount * 100);
}

function amountFromCents(value) {
  const cents = Number(value ?? 0);
  return Number.isFinite(cents) ? cents / 100 : 0;
}

function formatMoneyFromCents(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amountFromCents(value));
}

function formatMoneyValue(value) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}

function formatMoneyInputFromCents(value) {
  return amountFromCents(value).toFixed(2);
}

function parseCentsValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  const amount = parseMoneyValue(value);
  return amount == null ? null : Math.round(amount);
}

function resolveAmountCents(amountCentsValue, amountValue) {
  if (amountCentsValue !== undefined && amountCentsValue !== null && amountCentsValue !== '') {
    return parseCentsValue(amountCentsValue);
  }
  return parseMoneyToCents(amountValue);
}

module.exports = {
  amountFromCents,
  formatMoneyFromCents,
  formatMoneyInputFromCents,
  formatMoneyValue,
  normalizeMoneyString,
  parseMoneyValue,
  parseMoneyToCents,
  parseCentsValue,
  resolveAmountCents,
};

module.exports.default = module.exports;
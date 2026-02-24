const PREFIX = 'CFLOW1';

function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(b64url) {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return padded + '='.repeat(padLen);
}

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return toBase64Url(buf.toString('base64'));
}

function base64urlDecodeToString(input) {
  const b64 = fromBase64Url(String(input || ''));
  return Buffer.from(b64, 'base64').toString('utf8');
}

function createActivationKey(payload, sigB64) {
  const payloadString = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(payloadString);
  if (!sigB64) throw new Error('Signature required to create activation key');
  return `${PREFIX}.${payloadB64}.${sigB64}`;
}

function makeParseError(reason) {
  const err = new Error(reason);
  err.code = reason;
  return err;
}

function isBase64UrlSegment(value) {
  return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}

function normalizeKey(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, '')
    .replace(/\s+/g, '');
}

function isValidActivationKeyFormat(key) {
  const normalized = normalizeKey(key);
  // Accept 16-character keys, or 15-character keys starting with CF (generator format)
  return /^[A-Z0-9]{16}$/.test(normalized) || /^CF[A-Z0-9]{13}$/.test(normalized);
}

function parseActivationKey(rawKey) {
  const trimmed = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!trimmed) throw makeParseError('malformed');
  
  // Check if it's the new 16-character format
  const normalized = normalizeKey(trimmed);
  if (isValidActivationKeyFormat(normalized)) {
    // New format: return a simple structure
    return {
      format: 'simple',
      normalizedKey: normalized,
    };
  }
  
  // Old format: parse the CFLOW1.payload.sig structure
  const normalizedOld = trimmed.replace(/\s+/g, '');
  const parts = normalizedOld.split('.');
  if (parts.length !== 3) throw makeParseError('malformed');
  const [prefix, payloadB64, sigB64] = parts;
  if (prefix !== PREFIX) throw makeParseError('bad_prefix');
  if (!isBase64UrlSegment(payloadB64) || !isBase64UrlSegment(sigB64)) throw makeParseError('malformed');

  let payloadString = '';
  let payloadObject = null;
  try {
    payloadString = base64urlDecodeToString(payloadB64);
    payloadObject = JSON.parse(payloadString);
  } catch (_) {
    throw makeParseError('bad_payload');
  }
  if (!payloadObject || typeof payloadObject !== 'object') {
    throw makeParseError('bad_payload');
  }

  return {
    format: 'legacy',
    payloadObject,
    payloadString,
    payloadB64,
    sigB64,
  };
}

module.exports = {
  base64urlEncode,
  base64urlDecodeToString,
  createActivationKey,
  normalizeKey,
  isValidActivationKeyFormat,
  parseActivationKey,
};

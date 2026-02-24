const crypto = require('node:crypto');

/**
 * PUBLIC salt for license verification (embedded in app)
 * This is used to verify license keys on the client side
 */
const PUBLIC_SALT = 'CF-LICENSE-V1';

/**
 * Verify a license key against a payload
 * @param {string} payload - Canonical license payload string
 * @param {string} key - License key to verify (format: XXXX-XXXX-XXXX-XXXX)
 * @returns {boolean} True if key is valid for the payload
 */
function verifyLicense(payload, key) {
  try {
    if (!payload || !key) return false;
    
    // Normalize key (remove spaces, convert to uppercase)
    const normalizedKey = String(key || '').trim().toUpperCase().replace(/\s+/g, '');
    
    // Generate expected key from payload
    const hash = crypto
      .createHash('sha256')
      .update(payload + PUBLIC_SALT)
      .digest('hex')
      .toUpperCase();
    
    // Format as XXXX-XXXX-XXXX-XXXX
    const expected = hash.slice(0, 16).match(/.{1,4}/g).join('-');
    
    return expected === normalizedKey;
  } catch (err) {
    console.error('License verification error:', err);
    return false;
  }
}

/**
 * Build canonical license payload string
 * Format: CIVICFLOW|ORG={ORG}|TYPE={TRIAL|PRO}|EXP={YYYY-MM-DD|PERPETUAL}|DEVICE={DEVICE_ID}|SLOT={1|2}
 * @param {object} params - License parameters
 * @param {string} params.org - Organization name
 * @param {string} params.type - License type (TRIAL or PRO)
 * @param {string} params.expires - Expiration date (YYYY-MM-DD) or PERPETUAL
 * @param {string} params.deviceId - Device ID
 * @param {number} params.slot - Slot number (1 or 2)
 * @returns {string} Canonical payload string
 */
function buildLicensePayload({ org, type, expires, deviceId, slot }) {
  const normalizedOrg = (org || '').trim().toUpperCase();
  const normalizedType = (type || 'TRIAL').trim().toUpperCase();
  const normalizedExp = (expires || 'PERPETUAL').trim().toUpperCase();
  const normalizedDevice = (deviceId || '').trim();
  const slotNum = String(slot || 1).trim();
  
  return `CIVICFLOW|ORG=${normalizedOrg}|TYPE=${normalizedType}|EXP=${normalizedExp}|DEVICE=${normalizedDevice}|SLOT=${slotNum}`;
}

module.exports = {
  verifyLicense,
  buildLicensePayload,
};

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { APP_NAME } = require('../shared/appConfig.js');

const FILENAME = 'civicflow-branding.json';

function getBrandingPath() {
  const userData = app.getPath('userData');
  return path.join(userData, FILENAME);
}

const defaults = {
  cboName: APP_NAME,
  logoPath: null,
  smtp: null, // { host, port, secure, user, pass, from }
};

/**
 * Load CBO branding (name, logo path) and optional SMTP config.
 * @returns {{ cboName: string, logoPath: string|null, smtp: object|null }}
 */
function getBranding() {
  try {
    const p = getBrandingPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw);
      return { ...defaults, ...data };
    }
  } catch (_) {
    // ignore
  }
  return { ...defaults };
}

/**
 * Save CBO branding and/or SMTP config.
 * @param {{ cboName?: string, logoPath?: string|null, smtp?: object|null }} data
 */
function setBranding(data) {
  const current = getBranding();
  const next = { ...current, ...data };
  const p = getBrandingPath();
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  getBranding,
  setBranding,
};

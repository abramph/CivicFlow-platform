const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const LICENSE_FILENAME = 'license.json';

function getLicensePath() {
  return path.join(app.getPath('userData'), LICENSE_FILENAME);
}

function loadStoredLicense() {
  try {
    const p = getLicensePath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

function saveStoredLicense(record) {
  const p = getLicensePath();
  fs.writeFileSync(p, JSON.stringify(record, null, 2), 'utf8');
}

function clearStoredLicense() {
  try {
    const p = getLicensePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
}

module.exports = {
  getLicensePath,
  loadStoredLicense,
  saveStoredLicense,
  clearStoredLicense,
};

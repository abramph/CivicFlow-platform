/**
 * Single source of truth for Civicflow app identity.
 * Import this in configs to avoid drift.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

let version = '1.0.0';
try {
  const roots = [
    path.resolve(__dirname, '../../package.json'),
    path.join(process.cwd(), 'package.json'),
  ];
  for (const pkgPath of roots) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      version = pkg.version || version;
      break;
    } catch (_) {}
  }
} catch (_) {}

const APP_NAME = 'Civicflow';
const APP_ID = 'com.civicflow.app';
const APP_SLUG = 'civicflow';
const APP_VERSION = version;

module.exports = {
  APP_NAME,
  APP_ID,
  APP_SLUG,
  APP_VERSION,
};

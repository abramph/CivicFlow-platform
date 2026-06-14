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

/** Display / Electron product name — must match package.json productName and build.productName */
const APP_PRODUCT_NAME = 'CivicFlow';
/** Legacy DB subdirectory under userData (kept for existing installs) */
const APP_NAME = 'Civicflow';
const APP_ID = 'com.civicflow.app';
const APP_SLUG = 'civicflow';
const APP_VERSION = version;

/** Prior Electron userData folder names to scan when migrating license.json */
const LEGACY_USER_DATA_FOLDER_NAMES = [
  APP_PRODUCT_NAME,
  APP_NAME,
  APP_SLUG,
  'my-cbo-app',
  'my-cbo-app-dev',
  'CivicFlow Desktop',
  'Civicflow Desktop',
  'CivicFlow Dev',
  'CivicFlowDevProfile',
  'Electron',
];

module.exports = {
  APP_NAME,
  APP_PRODUCT_NAME,
  APP_ID,
  APP_SLUG,
  APP_VERSION,
  LEGACY_USER_DATA_FOLDER_NAMES,
};

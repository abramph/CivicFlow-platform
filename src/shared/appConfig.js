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

/**
 * Internal identity — DO NOT change. This drives app.setName() (see main.js),
 * which determines the OS userData folder Electron resolves to. Existing
 * installs' local SQLite DB and license.json live under a path derived from
 * this value; changing it orphans that data for already-installed users.
 * The product was originally called CivicFlow and is now marketed as
 * Unestra — that rename is display-only (see APP_DISPLAY_NAME below).
 */
const APP_PRODUCT_NAME = 'CivicFlow';
/** Legacy DB subdirectory under userData (kept for existing installs) */
const APP_NAME = 'Civicflow';
const APP_ID = 'com.civicflow.app';
const APP_SLUG = 'civicflow';
const APP_VERSION = version;

/** Customer-facing product identity — safe to change freely, does not affect storage/updater identity. */
const APP_DISPLAY_NAME = 'Unestra';
const APP_TAGLINE = 'One organization. Fully connected.';
const APP_ATTRIBUTION = 'An APH Technologies product';
/** Prior public name, for one-time transition messaging only. */
const APP_LEGACY_DISPLAY_NAME = 'CivicFlow';

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

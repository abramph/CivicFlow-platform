#!/usr/bin/env node
import { createActivationKey } from '../../src/main/licensing/token.js';
import { signPayloadString } from '../../src/main/licensing/validate.js';

const args = process.argv.slice(2);
const [name, email, licenseType = 'standard', daysStr] = args;

if (!name) {
  console.log(`
Usage:
  node scripts/private/generate-cflow1-key.mjs "Customer Name" [email] [licenseType] [validity_days]

Notes:
  - Omit validity_days for a perpetual license.
  - This script is private and should not be shipped.
`);
  process.exit(1);
}

const now = new Date();
const days = daysStr ? parseInt(daysStr, 10) : null;
const expiresAt = days ? new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString() : null;

const payload = {
  licenseId: `cflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  product: 'Civicflow',
  issuedToName: name,
  issuedToEmail: email || null,
  issuedAt: now.toISOString(),
  expiresAt,
  licenseType,
  features: {},
};

const payloadString = JSON.stringify(payload);
const sigB64 = signPayloadString(payloadString);
const key = createActivationKey(payload, sigB64);

console.log('\n=== CFLOW1 Activation Key ===\n');
console.log(key);
console.log('\n============================\n');

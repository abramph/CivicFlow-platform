#!/usr/bin/env node
"use strict";

const crypto = require("crypto");

// ==================================================
// CONFIGURATION (NEVER SHIP THIS FILE WITH THE APP)
// ==================================================
// Must match src/main/licensing/verify.js
const PUBLIC_SALT = "CF-LICENSE-V1";

// ==================================================
// ARGUMENTS
// Usage:
// node scripts/generate-license-key.cjs "ORG_NAME" "DEVICE_ID" SLOT
// ==================================================
const [, , orgName, deviceId, slot] = process.argv;

if (!orgName || !deviceId || !slot) {
  console.error(
    '\nUsage:\n  node scripts/generate-license-key.cjs "ORG_NAME" "DEVICE_ID" SLOT\n'
  );
  process.exit(1);
}

if (slot !== "1" && slot !== "2") {
  console.error("\nError: SLOT must be 1 or 2\n");
  process.exit(1);
}

// ==================================================
// CANONICAL PAYLOAD (DO NOT CHANGE FORMAT)
// ==================================================
const payload =
  `CIVICFLOW|ORG=${String(orgName).trim().toUpperCase()}|TYPE=PRO|EXP=PERPETUAL|DEVICE=${String(deviceId).trim()}|SLOT=${String(slot).trim()}`;

// ==================================================
// LICENSE KEY GENERATION
// ==================================================
const hash = crypto
  .createHash("sha256")
  .update(payload + PUBLIC_SALT)
  .digest("hex")
  .toUpperCase();

const licenseKey = hash
  .slice(0, 16)
  .match(/.{1,4}/g)
  .join("-");

// ==================================================
// OUTPUT
// ==================================================
console.log("\n======================================");
console.log(" CIVICFLOW PRO LICENSE KEY");
console.log("======================================");
console.log("Organization:", orgName);
console.log("Device ID:   ", deviceId);
console.log("Slot:        ", slot);
console.log("Payload:     ", payload);
console.log("Key:         ", licenseKey);
console.log("======================================\n");

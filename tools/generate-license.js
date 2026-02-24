const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PRIVATE_KEY_PATH = path.join(__dirname, "private.pem");

function randomSuffix(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function buildPayload() {
  return {
    licenseId: `CF-TEST-${randomSuffix(6)}`,
    plan: "ELITE",
    issuedAt: new Date().toISOString(),
    expiresAt: null,
    deviceId: "ANY",
  };
}

function signPayload(payloadJson, privateKeyPem) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(payloadJson, "utf8");
  signer.end();
  return signer.sign(privateKeyPem).toString("base64");
}

function main() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error(`Missing private key at ${PRIVATE_KEY_PATH}`);
    process.exit(1);
  }

  const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
  const payload = buildPayload();
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64");
  const signatureB64 = signPayload(payloadJson, privateKeyPem);
  const licenseKey = `${payloadB64}.${signatureB64}`;

  console.log("Generated License Key:");
  console.log(licenseKey);
}

main();

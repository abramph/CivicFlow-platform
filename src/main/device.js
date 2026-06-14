const os = require("os");
const crypto = require("crypto");
const { machineIdSync } = require("node-machine-id");

const DEVICE_SALT = process.env.CIVICFLOW_DEVICE_SALT || "civicflow-device-v1";

function safeMachineId() {
  try {
    return machineIdSync({ original: false });
  } catch {
    return "unknown-machine";
  }
}

function buildFingerprintMaterial() {
  return [
    safeMachineId(),
    os.platform(),
    os.arch(),
    DEVICE_SALT,
  ].join("|");
}

function getDeviceId() {
  return crypto.createHash("sha256").update(buildFingerprintMaterial()).digest("hex");
}

function getDeviceFingerprint() {
  return getDeviceId();
}

function getDeviceName() {
  return os.hostname();
}

module.exports = {
  getDeviceId,
  getDeviceFingerprint,
  getDeviceName,
  buildFingerprintMaterial,
};

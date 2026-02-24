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
    os.platform(),
    os.arch(),
    os.hostname(),
    safeMachineId(),
    DEVICE_SALT,
  ].join("|");
}

function getDeviceId() {
  return crypto.createHash("sha256").update(buildFingerprintMaterial()).digest("hex");
}

function getDeviceName() {
  return os.hostname();
}

module.exports = { getDeviceId, getDeviceName };

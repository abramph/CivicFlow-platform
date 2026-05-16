const path = require("node:path");

let loaded = false;

function loadEnv() {
  if (loaded) return;
  loaded = true;

  try {
    // Keep the license server self-contained when deployed from this folder.
    require("dotenv").config({ path: path.join(__dirname, ".env") });
  } catch (_err) {
    // dotenv is optional if the process environment is already populated.
  }
}

function envFlag(name, fallback = false) {
  loadEnv();
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function envNumber(name, fallback) {
  loadEnv();
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

loadEnv();

module.exports = {
  loadEnv,
  envFlag,
  envNumber,
};

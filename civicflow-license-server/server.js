const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const OFFLINE_GRACE_DAYS = Number(process.env.OFFLINE_GRACE_DAYS || 37);
const WARN_AFTER_DAYS = Number(process.env.WARN_AFTER_DAYS || 30);
const PORT = Number(process.env.PORT || 4000);

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function getColumns(table) {
  const rows = await allAsync(`PRAGMA table_info(${table})`);
  return new Set((rows || []).map((r) => String(r?.name || "").trim()));
}

async function ensureSchema() {
  await runAsync(`
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT UNIQUE,
      plan TEXT DEFAULT 'Essential',
      org_name TEXT,
      seats_allowed INTEGER,
      expiry_date TEXT
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS activations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER,
      device_id TEXT,
      device_name TEXT,
      email TEXT,
      activation_token TEXT,
      activated_at TEXT,
      last_check_in_at TEXT,
      deactivated_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY(license_id) REFERENCES licenses(id)
    )
  `);

  const licenseColumns = await getColumns("licenses");
  if (!licenseColumns.has("plan")) await runAsync("ALTER TABLE licenses ADD COLUMN plan TEXT DEFAULT 'Essential'");
  if (!licenseColumns.has("org_name")) await runAsync("ALTER TABLE licenses ADD COLUMN org_name TEXT");
  if (!licenseColumns.has("seats_allowed")) await runAsync("ALTER TABLE licenses ADD COLUMN seats_allowed INTEGER");
  if (!licenseColumns.has("expiry_date")) await runAsync("ALTER TABLE licenses ADD COLUMN expiry_date TEXT");

  const activationColumns = await getColumns("activations");
  if (!activationColumns.has("license_id")) await runAsync("ALTER TABLE activations ADD COLUMN license_id INTEGER");
  if (!activationColumns.has("device_id")) await runAsync("ALTER TABLE activations ADD COLUMN device_id TEXT");
  if (!activationColumns.has("device_name")) await runAsync("ALTER TABLE activations ADD COLUMN device_name TEXT");
  if (!activationColumns.has("email")) await runAsync("ALTER TABLE activations ADD COLUMN email TEXT");
  if (!activationColumns.has("activation_token")) await runAsync("ALTER TABLE activations ADD COLUMN activation_token TEXT");
  if (!activationColumns.has("activated_at")) await runAsync("ALTER TABLE activations ADD COLUMN activated_at TEXT");
  if (!activationColumns.has("last_check_in_at")) await runAsync("ALTER TABLE activations ADD COLUMN last_check_in_at TEXT");
  if (!activationColumns.has("deactivated_at")) await runAsync("ALTER TABLE activations ADD COLUMN deactivated_at TEXT");
  if (!activationColumns.has("created_at")) await runAsync("ALTER TABLE activations ADD COLUMN created_at TEXT");
  if (!activationColumns.has("updated_at")) await runAsync("ALTER TABLE activations ADD COLUMN updated_at TEXT");

  await runAsync("CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_token ON activations(activation_token)");
  await runAsync("CREATE INDEX IF NOT EXISTS idx_activations_license_active ON activations(license_id, deactivated_at)");
}

function normalizePlan(plan) {
  const value = String(plan || "").trim().toLowerCase();
  if (value === "elite") return "Elite";
  return "Essential";
}

function seatsForPlan(plan) {
  return normalizePlan(plan) === "Elite" ? 3 : 2;
}

function isLicenseExpired(license) {
  if (!license?.expiry_date) return false;
  return new Date(license.expiry_date).getTime() < Date.now();
}

function normalizeActivationBody(req, _res, next) {
  if (req.body && req.body.licenseKey && !req.body.key) {
    req.body.key = req.body.licenseKey;
  }
  if (req.body && req.body.key && !req.body.licenseKey) {
    req.body.licenseKey = req.body.key;
  }
  next();
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function activationHandler(req, res) {
  try {
    const licenseKey = String(req.body.licenseKey || req.body.key || "").trim();
    const deviceId = String(req.body.deviceId || "").trim();
    const deviceName = String(req.body.deviceName || "unknown-device").trim();
    const email = String(req.body.email || "").trim() || null;

    if (!licenseKey || !deviceId) {
      return res.status(400).json({ success: false, valid: false, error: "Missing licenseKey or deviceId" });
    }

    const license = await getAsync("SELECT * FROM licenses WHERE license_key = ?", [licenseKey]);
    if (!license) {
      return res.json({ success: false, valid: false, reason: "Invalid license" });
    }
    if (isLicenseExpired(license)) {
      return res.json({ success: false, valid: false, reason: "License expired" });
    }

    const plan = normalizePlan(license.plan);
    const seatLimit = Number(license.seats_allowed || seatsForPlan(plan));

    const existingActivation = await getAsync(
      "SELECT * FROM activations WHERE license_id = ? AND device_id = ? AND deactivated_at IS NULL",
      [license.id, deviceId]
    );

    if (existingActivation) {
      await runAsync(
        "UPDATE activations SET device_name = ?, last_check_in_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [deviceName, existingActivation.id]
      );
      return res.json({
        success: true,
        valid: true,
        activated: true,
        plan,
        activationToken: existingActivation.activation_token,
        offlineGraceDays: OFFLINE_GRACE_DAYS,
        warnAfterDays: WARN_AFTER_DAYS,
      });
    }

    const activeRows = await allAsync(
      "SELECT id FROM activations WHERE license_id = ? AND deactivated_at IS NULL",
      [license.id]
    );
    if (activeRows.length >= seatLimit) {
      return res.json({
        success: false,
        valid: false,
        reason: `Activation limit reached for plan ${plan} (${seatLimit} devices).`,
      });
    }

    const activationToken = generateToken();
    await runAsync(
      "INSERT INTO activations (license_id, device_id, device_name, email, activation_token, activated_at, last_check_in_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))",
      [license.id, deviceId, deviceName, email, activationToken]
    );

    return res.json({
      success: true,
      valid: true,
      activated: true,
      plan,
      activationToken,
      offlineGraceDays: OFFLINE_GRACE_DAYS,
      warnAfterDays: WARN_AFTER_DAYS,
      licenseId: license.id,
    });
  } catch (err) {
    return res.status(500).json({ success: false, valid: false, error: err?.message || "DB error" });
  }
}

app.post("/api/license/activate", normalizeActivationBody, activationHandler);
app.post("/api/license/refresh", async (req, res) => {
  try {
    const licenseKey = String(req.body.licenseKey || "").trim();
    const activationToken = String(req.body.activationToken || "").trim();
    const deviceId = String(req.body.deviceId || "").trim();

    if (!licenseKey || !activationToken || !deviceId) {
      return res.status(400).json({ success: false, valid: false, error: "Missing refresh payload" });
    }

    const license = await getAsync("SELECT * FROM licenses WHERE license_key = ?", [licenseKey]);
    if (!license || isLicenseExpired(license)) {
      return res.json({ success: false, valid: false, reason: "License invalid or expired" });
    }

    const activation = await getAsync(
      "SELECT * FROM activations WHERE license_id = ? AND device_id = ? AND activation_token = ? AND deactivated_at IS NULL",
      [license.id, deviceId, activationToken]
    );
    if (!activation) {
      return res.json({ success: false, valid: false, reason: "Activation not found for this device" });
    }

    await runAsync(
      "UPDATE activations SET last_check_in_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [activation.id]
    );

    return res.json({
      success: true,
      valid: true,
      activated: true,
      plan: normalizePlan(license.plan),
      activationToken,
      offlineGraceDays: OFFLINE_GRACE_DAYS,
      warnAfterDays: WARN_AFTER_DAYS,
    });
  } catch (err) {
    return res.status(500).json({ success: false, valid: false, error: err?.message || "Refresh failed" });
  }
});

app.post("/api/license/deactivate", async (req, res) => {
  try {
    const licenseKey = String(req.body.licenseKey || "").trim();
    const activationToken = String(req.body.activationToken || "").trim();
    const deviceId = String(req.body.deviceId || "").trim();

    const license = await getAsync("SELECT id FROM licenses WHERE license_key = ?", [licenseKey]);
    if (!license) {
      return res.json({ success: true });
    }

    await runAsync(
      "UPDATE activations SET deactivated_at = datetime('now'), updated_at = datetime('now') WHERE license_id = ? AND device_id = ? AND activation_token = ? AND deactivated_at IS NULL",
      [license.id, deviceId, activationToken]
    );

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || "Deactivate failed" });
  }
});

app.get("/", (_req, res) => {
  res.send("CivicFlow License Server is running");
});
app.get("/health", (_req, res) => {
  res.json({ ok: true, offlineGraceDays: OFFLINE_GRACE_DAYS, warnAfterDays: WARN_AFTER_DAYS });
});

async function start() {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`CivicFlow License Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to initialize license server schema:", err?.message || err);
    process.exit(1);
  }
}

start();



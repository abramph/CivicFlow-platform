const crypto = require("crypto");
const db = require("./db");
const { envFlag } = require("./config");
const { migrateDatabase } = require("./migrate");

const LICENSE_KEY_PATTERN = /^CF(?:-[A-Z0-9]{3,8}){4}$/;
const ALLOW_SERVER_TRIAL_LICENSES = envFlag("ALLOW_SERVER_TRIAL_LICENSES", false);

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

async function withImmediateTransaction(work) {
  await runAsync("BEGIN IMMEDIATE");
  try {
    const result = await work();
    await runAsync("COMMIT");
    return result;
  } catch (err) {
    try {
      await runAsync("ROLLBACK");
    } catch (_rollbackErr) {
      // noop
    }
    throw err;
  }
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return null;
  }
}

function stringifyJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return null;
  }
}

async function ensureSchema() {
  await migrateDatabase();

  await runAsync("UPDATE licenses SET status = 'active' WHERE status IS NULL OR trim(status) = ''");
  await runAsync("UPDATE licenses SET environment = 'test' WHERE environment IS NULL OR trim(environment) = ''");
  await runAsync("UPDATE purchase_events SET environment = 'test' WHERE environment IS NULL OR trim(environment) = ''");
  await runAsync(`
    UPDATE licenses
    SET license_type = CASE
      WHEN expiry_date IS NULL OR trim(COALESCE(expiry_date, '')) = '' THEN 'perpetual'
      ELSE 'annual'
    END
    WHERE license_type IS NULL OR trim(license_type) = ''
  `);
  await runAsync("CREATE UNIQUE INDEX IF NOT EXISTS idx_activations_token ON activations(activation_token)");
  await runAsync("CREATE INDEX IF NOT EXISTS idx_activations_license_active ON activations(license_id, deactivated_at)");
  await runAsync("CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_events_event_id ON purchase_events(stripe_event_id)");
  await runAsync("CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_events_session_id ON purchase_events(stripe_session_id)");
  await runAsync("CREATE INDEX IF NOT EXISTS idx_purchase_events_license_id ON purchase_events(license_id)");
}

function normalizeEnvironment(value, fallback = "test") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "prod" || normalized === "production" || normalized === "live") return "prod";
  return "test";
}

function parseEnvironmentArg(value, fallback = "test") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "test" || normalized === "prod") return normalized;
  if (normalized === "production" || normalized === "live") return "prod";
  throw new Error("Environment must be test or prod");
}

function normalizePlan(plan) {
  const value = String(plan || "").trim().toLowerCase();
  if (value === "professional") return "Professional";
  if (value === "elite") return "Elite";
  return "Essential";
}

function parsePlanArg(plan) {
  const value = String(plan || "").trim().toLowerCase();
  if (value === "professional") return "Professional";
  if (value === "essential") return "Essential";
  if (value === "elite") return "Elite";
  throw new Error("Plan must be Professional, Essential, or Elite");
}

function seatsForPlan(plan) {
  if (normalizePlan(plan) === "Professional") return 5;
  return normalizePlan(plan) === "Elite" ? 3 : 2;
}

function normalizeLicenseType(licenseType, expiryDate = null) {
  const value = String(licenseType || "").trim().toLowerCase();
  if (value === "trial") return "trial";
  if (value === "perpetual" || value === "lifetime") return "perpetual";
  if (value === "annual" || value === "yearly" || value === "subscription") return "annual";
  return expiryDate ? "annual" : "perpetual";
}

function parseLicenseTypeArg(licenseType) {
  const value = String(licenseType || "").trim().toLowerCase();
  if (!value) return "annual";
  if (value === "trial") return "trial";
  if (value === "perpetual" || value === "lifetime") return "perpetual";
  if (value === "annual" || value === "yearly" || value === "subscription") return "annual";
  throw new Error("License type must be trial, annual, or perpetual");
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "revoked" || value === "disabled") return "revoked";
  if (value === "superseded") return "superseded";
  return "active";
}

function normalizePurchaseKind(purchaseKind) {
  const value = String(purchaseKind || "").trim().toLowerCase();
  if (value === "annual_renewal" || value === "maintenance_renewal" || value === "seat_addon") return value;
  return "new_purchase";
}

function parsePurchaseKindArg(purchaseKind) {
  const value = String(purchaseKind || "").trim().toLowerCase();
  if (!value || value === "new_purchase") return "new_purchase";
  if (value === "annual_renewal" || value === "maintenance_renewal" || value === "seat_addon") return value;
  throw new Error("purchaseKind must be new_purchase, annual_renewal, maintenance_renewal, or seat_addon");
}

function normalizeNullableString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeLicenseKey(value, label = "key") {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return null;
  if (!LICENSE_KEY_PATTERN.test(text)) {
    throw new Error(`${label} must match a valid CivicFlow license key format`);
  }
  return text;
}

function resolveSeatLimit(license) {
  const rawSeats = Number(license?.seats_allowed ?? license?.seatsAllowed);
  if (Number.isFinite(rawSeats) && rawSeats > 0) return rawSeats;
  return seatsForPlan(license?.plan);
}

function isValidDateValue(value) {
  if (!value) return false;
  return Number.isFinite(new Date(value).getTime());
}

function toIsoString(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function dateOnlyFromValue(value, label = "date") {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return parsed.toISOString().slice(0, 10);
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(baseDate, days) {
  const base = baseDate
    ? new Date(`${baseDate}T00:00:00.000Z`)
    : new Date(`${todayDateOnly()}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function maxDateOnly(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function parsePositiveInt(value, label) {
  if (value == null || value === false || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.floor(numeric);
}

function validateLicenseShape({ licenseType, expiryDate, supportExpiryDate = null }) {
  if (licenseType === "trial" && !ALLOW_SERVER_TRIAL_LICENSES) {
    throw new Error("Server trial licenses are disabled. Use the local 30-day trial unless ALLOW_SERVER_TRIAL_LICENSES=1.");
  }

  if ((licenseType === "trial" || licenseType === "annual") && !expiryDate) {
    throw new Error(`${licenseType} licenses must include an expiry date`);
  }

  if (licenseType === "perpetual" && expiryDate) {
    throw new Error("Perpetual licenses must not include an expiry date");
  }

  if (expiryDate && !isValidDateValue(expiryDate)) {
    throw new Error("License expiry date is invalid");
  }

  if (supportExpiryDate && !isValidDateValue(supportExpiryDate)) {
    throw new Error("Support expiry date is invalid");
  }
}

function validateLicenseRecord(license) {
  if (!license) {
    return { ok: false, reason: "Invalid license" };
  }

  const normalized = {
    ...license,
    plan: normalizePlan(license.plan),
    license_type: normalizeLicenseType(license.license_type, license.expiry_date),
    status: normalizeStatus(license.status),
    seats_allowed: resolveSeatLimit(license),
    environment: normalizeEnvironment(license.environment),
  };

  try {
    validateLicenseShape({
      licenseType: normalized.license_type,
      expiryDate: normalized.expiry_date,
      supportExpiryDate: normalized.support_expiry_date,
    });
  } catch (err) {
    return { ok: false, reason: err?.message || "Invalid license" };
  }

  return { ok: true, license: normalized };
}

function isLicenseExpired(license) {
  if (!license?.expiry_date) return false;
  return String(license.expiry_date).trim() < todayDateOnly();
}

function buildAlphabet() {
  return "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function generateLicenseKey() {
  const alphabet = buildAlphabet();
  const bytes = crypto.randomBytes(16);
  let raw = "";
  for (let index = 0; index < 16; index += 1) {
    raw += alphabet[bytes[index] % alphabet.length];
  }
  return `CF-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

async function keyExists(licenseKey) {
  const row = await getAsync("SELECT id FROM licenses WHERE license_key = ? LIMIT 1", [licenseKey]);
  return !!row;
}

async function uniqueKey(preferredKey = null) {
  if (preferredKey) {
    const normalizedKey = normalizeLicenseKey(preferredKey);
    if (await keyExists(normalizedKey)) {
      throw new Error(`License key already exists: ${normalizedKey}`);
    }
    return normalizedKey;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = generateLicenseKey();
    if (!(await keyExists(candidate))) return candidate;
  }

  throw new Error("Unable to generate a unique license key");
}

function mapLicenseEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    licenseId: row.license_id,
    activationId: row.activation_id || null,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id || null,
    metadata: safeJsonParse(row.metadata_json),
    createdAt: row.created_at || null,
  };
}

function mapPurchaseRow(row) {
  if (!row) return null;
  const rawPayload = safeJsonParse(row.raw_payload);
  const metadata = rawPayload?.data?.object?.metadata || rawPayload?.metadata || rawPayload?.session?.metadata || null;

  return {
    id: row.id,
    provider: row.provider || "stripe",
    stripeEventId: row.stripe_event_id || null,
    stripeSessionId: row.stripe_session_id || null,
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    stripeCustomerId: row.stripe_customer_id || null,
    stripePriceId: row.stripe_price_id || row.price_id || null,
    priceId: row.price_id || row.stripe_price_id || null,
    customerEmail: row.customer_email || null,
    orgName: row.org_name || null,
    licenseId: row.license_id || null,
    targetLicenseId: row.target_license_id || null,
    purchaseKind: normalizePurchaseKind(row.purchase_kind),
    checkoutSessionId: row.checkout_session_id || row.stripe_session_id || null,
    environment: normalizeEnvironment(row.environment),
    amountTotal: row.amount_total == null ? null : Number(row.amount_total),
    currency: row.currency || null,
    status: row.status || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    metadata,
    rawPayload,
  };
}

function mapActivationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id || null,
    deviceName: row.device_name || null,
    email: row.email || null,
    activationToken: row.activation_token || null,
    activatedAt: row.activated_at || null,
    lastCheckInAt: row.last_check_in_at || null,
    deactivatedAt: row.deactivated_at || null,
  };
}

function mapLicenseRow(row, activations = [], purchaseEvents = [], licenseEvents = []) {
  const lastCheckInAt = activations
    .map((activation) => activation?.lastCheckInAt || null)
    .filter(Boolean)
    .sort()
    .pop() || null;

  return {
    id: row.id,
    licenseKey: row.license_key,
    plan: normalizePlan(row.plan),
    orgName: row.org_name || null,
    customerEmail: row.customer_email || null,
    licenseType: normalizeLicenseType(row.license_type, row.expiry_date),
    status: normalizeStatus(row.status),
    environment: normalizeEnvironment(row.environment),
    issuedAt: row.issued_at || null,
    seatsAllowed: resolveSeatLimit(row),
    expiresAt: row.expiry_date || null,
    supportExpiresAt: row.support_expiry_date || null,
    notes: row.notes || null,
    activeActivationCount: activations.filter((activation) => !activation?.deactivatedAt).length,
    lastCheckInAt,
    activations,
    purchaseEvents,
    licenseEvents,
  };
}

async function getLicenseByKey(licenseKey) {
  const normalizedKey = normalizeLicenseKey(licenseKey);
  const license = await getAsync("SELECT * FROM licenses WHERE license_key = ?", [normalizedKey]);
  if (!license) {
    throw new Error(`License not found: ${normalizedKey}`);
  }
  return license;
}

async function findLicenseByKey(licenseKey) {
  return getLicenseByKey(licenseKey);
}

async function getLicenseById(licenseId) {
  const numericId = Number(licenseId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("License id must be a positive integer");
  }
  const license = await getAsync("SELECT * FROM licenses WHERE id = ?", [numericId]);
  if (!license) {
    throw new Error(`License not found: ${numericId}`);
  }
  return license;
}

async function resolveLicense(target) {
  if (target && typeof target === "object") {
    if (target.id != null) return getLicenseById(target.id);
    if (target.licenseId != null) return getLicenseById(target.licenseId);
    if (target.key != null) return getLicenseByKey(target.key);
    if (target.licenseKey != null) return getLicenseByKey(target.licenseKey);
  }

  if (typeof target === "number") return getLicenseById(target);

  const text = String(target || "").trim();
  if (!text) throw new Error("License target is required");
  if (/^\d+$/.test(text)) return getLicenseById(Number(text));
  return getLicenseByKey(text);
}

async function listPurchaseEventsByLicense(licenseId) {
  const rows = await allAsync(`
    SELECT *
    FROM purchase_events
    WHERE license_id = ? OR target_license_id = ?
    ORDER BY id DESC
  `, [licenseId, licenseId]);
  return (rows || []).map(mapPurchaseRow);
}

async function listLicenseEventsByLicense(licenseId) {
  const rows = await allAsync(`
    SELECT *
    FROM license_events
    WHERE license_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
  `, [licenseId]);
  return (rows || []).map(mapLicenseEventRow);
}

function clampListLimit(value, fallback = 50) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(200, Math.floor(numeric));
}

async function listRecentPurchaseEvents(limit = 50) {
  const rows = await allAsync(`
    SELECT
      purchase_events.*,
      linked.license_key AS linked_license_key,
      linked.org_name AS linked_org_name,
      linked.status AS linked_license_status,
      target.license_key AS target_license_key,
      target.org_name AS target_org_name,
      target.status AS target_license_status
    FROM purchase_events
    LEFT JOIN licenses linked ON linked.id = purchase_events.license_id
    LEFT JOIN licenses target ON target.id = purchase_events.target_license_id
    ORDER BY datetime(purchase_events.created_at) DESC, purchase_events.id DESC
    LIMIT ?
  `, [clampListLimit(limit)]);

  return (rows || []).map((row) => ({
    ...mapPurchaseRow(row),
    linkedLicenseKey: row.linked_license_key || null,
    linkedOrgName: row.linked_org_name || null,
    linkedLicenseStatus: row.linked_license_status ? normalizeStatus(row.linked_license_status) : null,
    targetLicenseKey: row.target_license_key || null,
    targetOrgName: row.target_org_name || null,
    targetLicenseStatus: row.target_license_status ? normalizeStatus(row.target_license_status) : null,
  }));
}

async function listRecentLicenseEvents(limit = 50) {
  const rows = await allAsync(`
    SELECT
      license_events.*,
      licenses.license_key,
      licenses.org_name,
      licenses.status AS license_status,
      licenses.environment AS license_environment,
      activations.device_id,
      activations.device_name
    FROM license_events
    INNER JOIN licenses ON licenses.id = license_events.license_id
    LEFT JOIN activations ON activations.id = license_events.activation_id
    ORDER BY datetime(license_events.created_at) DESC, license_events.id DESC
    LIMIT ?
  `, [clampListLimit(limit)]);

  return (rows || []).map((row) => ({
    ...mapLicenseEventRow(row),
    licenseKey: row.license_key || null,
    orgName: row.org_name || null,
    licenseStatus: row.license_status ? normalizeStatus(row.license_status) : null,
    environment: row.license_environment ? normalizeEnvironment(row.license_environment) : null,
    deviceId: row.device_id || null,
    deviceName: row.device_name || null,
  }));
}

async function fetchLicenseDetails(target) {
  const license = await resolveLicense(target);
  const activationRows = await allAsync(`
    SELECT id, device_id, device_name, email, activation_token, activated_at, last_check_in_at, deactivated_at
    FROM activations
    WHERE license_id = ?
    ORDER BY CASE WHEN deactivated_at IS NULL THEN 0 ELSE 1 END, COALESCE(last_check_in_at, activated_at) DESC, id DESC
  `, [license.id]);
  const activations = (activationRows || []).map(mapActivationRow);
  const purchaseEvents = await listPurchaseEventsByLicense(license.id);
  const licenseEvents = await listLicenseEventsByLicense(license.id);
  return {
    license,
    activations,
    purchaseEvents,
    licenseEvents,
    summary: mapLicenseRow(license, activations, purchaseEvents, licenseEvents),
  };
}

async function recordLicenseEvent({ licenseId, activationId = null, eventType, actorType, actorId = null, metadata = null }) {
  const numericLicenseId = Number(licenseId);
  if (!Number.isInteger(numericLicenseId) || numericLicenseId <= 0) {
    throw new Error("licenseId must be a positive integer");
  }
  const normalizedEventType = normalizeNullableString(eventType);
  const normalizedActorType = normalizeNullableString(actorType);
  if (!normalizedEventType) {
    throw new Error("eventType is required");
  }
  if (!normalizedActorType) {
    throw new Error("actorType is required");
  }

  const result = await runAsync(`
    INSERT INTO license_events (
      license_id,
      activation_id,
      event_type,
      actor_type,
      actor_id,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, [
    numericLicenseId,
    activationId == null ? null : Number(activationId),
    normalizedEventType,
    normalizedActorType,
    normalizeNullableString(actorId),
    stringifyJson(metadata),
  ]);

  const row = await getAsync("SELECT * FROM license_events WHERE id = ?", [result.lastID]);
  return mapLicenseEventRow(row);
}

async function createLicense(input = {}) {
  const orgName = normalizeNullableString(input.orgName || input.organization || input.org_name);
  if (!orgName) {
    throw new Error("Organization name is required");
  }

  const customerEmail = normalizeNullableString(input.customerEmail || input.customer_email || input.email);
  const plan = input.plan ? parsePlanArg(input.plan) : "Essential";
  const licenseType = parseLicenseTypeArg(input.licenseType || input.type || input.license_type || "annual");
  const expiryDate = dateOnlyFromValue(input.expiryDate || input.expiry_date, "expiryDate");
  const supportExpiryDate = dateOnlyFromValue(input.supportExpiryDate || input.support_expiry_date, "supportExpiryDate");
  const seatsAllowed = parsePositiveInt(input.seatsAllowed ?? input.seats ?? seatsForPlan(plan), "seatsAllowed") || seatsForPlan(plan);
  const status = normalizeStatus(input.status || "active");
  const environment = parseEnvironmentArg(input.environment, "test");
  const notes = normalizeNullableString(input.notes);
  const issuedAt = toIsoString(input.issuedAt) || new Date().toISOString();
  validateLicenseShape({ licenseType, expiryDate, supportExpiryDate });

  if (status !== "active") {
    throw new Error("New licenses must be created with status active");
  }

  const licenseKey = await uniqueKey(input.licenseKey || input.key || null);
  const result = await runAsync(`
    INSERT INTO licenses (
      license_key,
      plan,
      org_name,
      customer_email,
      license_type,
      status,
      issued_at,
      seats_allowed,
      expiry_date,
      support_expiry_date,
      notes,
      environment
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    licenseKey,
    plan,
    orgName,
    customerEmail,
    licenseType,
    status,
    issuedAt,
    seatsAllowed,
    expiryDate,
    supportExpiryDate,
    notes,
    environment,
  ]);

  if (!input.skipEvent) {
    await recordLicenseEvent({
      licenseId: result.lastID,
      eventType: input.eventType || "license_created",
      actorType: input.actorType || "system",
      actorId: input.actorId || null,
      metadata: input.metadata || null,
    });
  }

  return fetchLicenseDetails(result.lastID);
}

async function revokeLicense(target, options = {}) {
  const license = await resolveLicense(target);
  await runAsync("UPDATE licenses SET status = 'revoked' WHERE id = ?", [license.id]);
  await recordLicenseEvent({
    licenseId: license.id,
    eventType: "license_revoked",
    actorType: options.actorType || "admin",
    actorId: options.actorId || null,
    metadata: options.metadata || null,
  });
  return fetchLicenseDetails(license.id);
}

async function resetActivations(target, options = {}) {
  const license = await resolveLicense(target);
  const result = await runAsync(`
    UPDATE activations
    SET deactivated_at = datetime('now'), updated_at = datetime('now')
    WHERE license_id = ? AND deactivated_at IS NULL
  `, [license.id]);
  await recordLicenseEvent({
    licenseId: license.id,
    eventType: "activations_reset",
    actorType: options.actorType || "admin",
    actorId: options.actorId || null,
    metadata: {
      ...(options.metadata || {}),
      resetCount: result.changes,
    },
  });
  const details = await fetchLicenseDetails(license.id);
  details.resetCount = result.changes;
  details.summary.resetCount = result.changes;
  return details;
}

function resolveSupportExpiry(input = {}, existingDate = null) {
  const explicitSupport = dateOnlyFromValue(input.supportExpiryDate || input.support_expiry_date || input["support-expires"], "supportExpiryDate");
  const supportDays = parsePositiveInt(input.supportDays ?? input["support-days"], "supportDays");
  const supportYears = parsePositiveInt(input.supportYears ?? input["support-years"], "supportYears");
  if (explicitSupport && (supportDays || supportYears)) {
    throw new Error("Use either support expiry date or support days/years");
  }
  if (explicitSupport) return explicitSupport;
  const extensionDays = (supportYears || 0) * 365 + (supportDays || 0);
  if (extensionDays > 0) return addDays(maxDateOnly(existingDate, todayDateOnly()), extensionDays);
  return null;
}

async function extendAnnualLicense({ licenseId, days, actorType = "system", actorId = null, metadata = null }) {
  const extensionDays = parsePositiveInt(days, "days");
  if (!extensionDays) {
    throw new Error("days is required");
  }

  const numericLicenseId = Number(licenseId);
  await withImmediateTransaction(async () => {
    const license = await getLicenseById(numericLicenseId);
    const licenseType = normalizeLicenseType(license.license_type, license.expiry_date);
    if (licenseType !== "annual" && licenseType !== "trial") {
      throw new Error("Only annual or trial licenses can be extended with an expiry date");
    }
    const nextExpiry = addDays(maxDateOnly(license.expiry_date, todayDateOnly()), extensionDays);
    await runAsync("UPDATE licenses SET expiry_date = ? WHERE id = ?", [nextExpiry, license.id]);
    await recordLicenseEvent({
      licenseId: license.id,
      eventType: "annual_renewed",
      actorType,
      actorId,
      metadata: {
        ...(metadata || {}),
        days: extensionDays,
        expiryDate: nextExpiry,
      },
    });
  });

  return fetchLicenseDetails(numericLicenseId);
}

async function extendMaintenance({ licenseId, days, actorType = "system", actorId = null, metadata = null }) {
  const extensionDays = parsePositiveInt(days, "days");
  if (!extensionDays) {
    throw new Error("days is required");
  }

  const numericLicenseId = Number(licenseId);
  await withImmediateTransaction(async () => {
    const license = await getLicenseById(numericLicenseId);
    const nextSupportExpiry = addDays(maxDateOnly(license.support_expiry_date, todayDateOnly()), extensionDays);
    await runAsync("UPDATE licenses SET support_expiry_date = ? WHERE id = ?", [nextSupportExpiry, license.id]);
    await recordLicenseEvent({
      licenseId: license.id,
      eventType: "maintenance_renewed",
      actorType,
      actorId,
      metadata: {
        ...(metadata || {}),
        days: extensionDays,
        supportExpiryDate: nextSupportExpiry,
      },
    });
  });

  return fetchLicenseDetails(numericLicenseId);
}

async function extendLicense(target, input = {}) {
  const license = await resolveLicense(target);
  const licenseType = normalizeLicenseType(license.license_type, license.expiry_date);

  const explicitExpiry = dateOnlyFromValue(input.expiryDate || input.expiry_date || input.expires, "expiryDate");
  const days = parsePositiveInt(input.days, "days");
  const years = parsePositiveInt(input.years, "years");
  const supportExpiry = resolveSupportExpiry(input, license.support_expiry_date);
  const supportDays = parsePositiveInt(input.supportDays ?? input["support-days"], "supportDays");
  const supportYears = parsePositiveInt(input.supportYears ?? input["support-years"], "supportYears");

  const updates = [];
  const values = [];
  const eventMetadata = { ...(input.metadata || {}) };

  if (explicitExpiry || days || years) {
    if (licenseType === "perpetual") {
      throw new Error("Perpetual licenses cannot be extended with a primary expiry. Extend support instead.");
    }

    let nextExpiry = explicitExpiry;
    if (!nextExpiry) {
      const extensionDays = (years || 0) * 365 + (days || 0);
      const baseDate = maxDateOnly(license.expiry_date, todayDateOnly());
      nextExpiry = addDays(baseDate, extensionDays);
      eventMetadata.expiryDays = extensionDays;
    }

    updates.push("expiry_date = ?");
    values.push(nextExpiry);
    eventMetadata.expiryDate = nextExpiry;
  }

  if (supportExpiry || supportDays || supportYears) {
    const nextSupportExpiry = supportExpiry || addDays(
      maxDateOnly(license.support_expiry_date, todayDateOnly()),
      ((supportYears || 0) * 365) + (supportDays || 0)
    );
    updates.push("support_expiry_date = ?");
    values.push(nextSupportExpiry);
    eventMetadata.supportExpiryDate = nextSupportExpiry;
  }

  if (updates.length === 0) {
    throw new Error("Nothing to update. Provide expiry or support extension values.");
  }

  await withImmediateTransaction(async () => {
    await runAsync(`UPDATE licenses SET ${updates.join(", ")} WHERE id = ?`, [...values, license.id]);
    await recordLicenseEvent({
      licenseId: license.id,
      eventType: "license_extended",
      actorType: input.actorType || "admin",
      actorId: input.actorId || null,
      metadata: eventMetadata,
    });
  });

  return fetchLicenseDetails(license.id);
}

async function releaseActivation({ licenseId, activationId, actorType = "admin", actorId = null, metadata = null }) {
  const numericLicenseId = Number(licenseId);
  const numericActivationId = Number(activationId);
  if (!Number.isInteger(numericLicenseId) || numericLicenseId <= 0) {
    throw new Error("licenseId must be a positive integer");
  }
  if (!Number.isInteger(numericActivationId) || numericActivationId <= 0) {
    throw new Error("activationId must be a positive integer");
  }

  await withImmediateTransaction(async () => {
    const activation = await getAsync(`
      SELECT *
      FROM activations
      WHERE id = ? AND license_id = ?
      LIMIT 1
    `, [numericActivationId, numericLicenseId]);

    if (!activation) {
      throw new Error("Activation not found for this license");
    }

    if (!activation.deactivated_at) {
      await runAsync(`
        UPDATE activations
        SET deactivated_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `, [numericActivationId]);
    }

    await recordLicenseEvent({
      licenseId: numericLicenseId,
      activationId: numericActivationId,
      eventType: "activation_released",
      actorType,
      actorId,
      metadata: {
        deviceId: activation.device_id || null,
        deviceName: activation.device_name || null,
        ...(metadata || {}),
      },
    });
  });

  return fetchLicenseDetails(numericLicenseId);
}

async function reissueLicense({ licenseId, clearActivations = false, actorType = "admin", actorId = null, metadata = null }) {
  const numericLicenseId = Number(licenseId);
  if (!Number.isInteger(numericLicenseId) || numericLicenseId <= 0) {
    throw new Error("licenseId must be a positive integer");
  }

  let newLicenseId = null;
  let previousLicenseId = numericLicenseId;

  await withImmediateTransaction(async () => {
    const currentLicense = await getLicenseById(numericLicenseId);
    const nextLicenseKey = await uniqueKey();
    const nextIssuedAt = new Date().toISOString();
    const nextNotes = [currentLicense.notes, `Reissued from ${currentLicense.license_key} on ${nextIssuedAt.slice(0, 10)}`]
      .filter(Boolean)
      .join("\n");

    const inserted = await runAsync(`
      INSERT INTO licenses (
        license_key,
        plan,
        org_name,
        customer_email,
        license_type,
        status,
        issued_at,
        seats_allowed,
        expiry_date,
        support_expiry_date,
        notes,
        environment
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    `, [
      nextLicenseKey,
      normalizePlan(currentLicense.plan),
      currentLicense.org_name || null,
      currentLicense.customer_email || null,
      normalizeLicenseType(currentLicense.license_type, currentLicense.expiry_date),
      nextIssuedAt,
      resolveSeatLimit(currentLicense),
      currentLicense.expiry_date || null,
      currentLicense.support_expiry_date || null,
      nextNotes,
      normalizeEnvironment(currentLicense.environment),
    ]);

    newLicenseId = inserted.lastID;

    await runAsync("UPDATE licenses SET status = 'superseded' WHERE id = ?", [currentLicense.id]);

    if (clearActivations) {
      await runAsync(`
        UPDATE activations
        SET deactivated_at = datetime('now'), updated_at = datetime('now')
        WHERE license_id = ? AND deactivated_at IS NULL
      `, [currentLicense.id]);
    }

    await recordLicenseEvent({
      licenseId: currentLicense.id,
      eventType: "license_superseded",
      actorType,
      actorId,
      metadata: {
        replacementLicenseId: newLicenseId,
        replacementLicenseKey: nextLicenseKey,
        clearActivations: !!clearActivations,
        ...(metadata || {}),
      },
    });

    await recordLicenseEvent({
      licenseId: newLicenseId,
      eventType: "license_reissued",
      actorType,
      actorId,
      metadata: {
        previousLicenseId: currentLicense.id,
        previousLicenseKey: currentLicense.license_key,
        clearActivations: !!clearActivations,
        ...(metadata || {}),
      },
    });
  });

  const details = await fetchLicenseDetails(newLicenseId);
  const previousDetails = await fetchLicenseDetails(previousLicenseId);

  return {
    newLicenseId,
    previousLicenseId,
    details,
    previousDetails,
  };
}

async function listLicenses(filters = {}) {
  const where = [];
  const params = [];

  const search = normalizeNullableString(filters.search || filters.q);
  if (search) {
    where.push("(LOWER(COALESCE(l.license_key, '')) LIKE ? OR LOWER(COALESCE(l.org_name, '')) LIKE ? OR LOWER(COALESCE(l.customer_email, '')) LIKE ?)");
    const pattern = `%${search.toLowerCase()}%`;
    params.push(pattern, pattern, pattern);
  }

  const plan = normalizeNullableString(filters.plan);
  if (plan) {
    where.push("LOWER(COALESCE(l.plan, '')) = ?");
    params.push(normalizePlan(plan).toLowerCase());
  }

  const licenseType = normalizeNullableString(filters.licenseType || filters.type);
  if (licenseType) {
    where.push("LOWER(COALESCE(l.license_type, '')) = ?");
    params.push(normalizeLicenseType(licenseType).toLowerCase());
  }

  const status = normalizeNullableString(filters.status);
  if (status) {
    where.push("LOWER(COALESCE(l.status, '')) = ?");
    params.push(normalizeStatus(status).toLowerCase());
  }

  const environment = normalizeNullableString(filters.environment);
  if (environment) {
    where.push("LOWER(COALESCE(l.environment, 'test')) = ?");
    params.push(normalizeEnvironment(environment).toLowerCase());
  }

  const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 500);
  params.push(limit);

  const rows = await allAsync(`
    SELECT
      l.*,
      SUM(CASE WHEN a.id IS NOT NULL AND a.deactivated_at IS NULL THEN 1 ELSE 0 END) AS active_activation_count,
      MAX(a.last_check_in_at) AS last_check_in_at
    FROM licenses l
    LEFT JOIN activations a ON a.license_id = l.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY l.id
    ORDER BY datetime(COALESCE(l.issued_at, '1970-01-01T00:00:00Z')) DESC, l.id DESC
    LIMIT ?
  `, params);

  return (rows || []).map((row) => ({
    id: row.id,
    licenseKey: row.license_key,
    plan: normalizePlan(row.plan),
    orgName: row.org_name || null,
    customerEmail: row.customer_email || null,
    licenseType: normalizeLicenseType(row.license_type, row.expiry_date),
    status: normalizeStatus(row.status),
    environment: normalizeEnvironment(row.environment),
    issuedAt: row.issued_at || null,
    seatsAllowed: resolveSeatLimit(row),
    expiresAt: row.expiry_date || null,
    supportExpiresAt: row.support_expiry_date || null,
    notes: row.notes || null,
    activeActivationCount: Number(row.active_activation_count || 0),
    lastCheckInAt: row.last_check_in_at || null,
  }));
}

function buildLicenseClientPayload(license, activations = [], overrides = {}) {
  const mappedActivations = (activations || []).map((activation) => activation?.lastCheckInAt ? activation : mapActivationRow(activation));
  const lastCheckInAt = mappedActivations
    .map((activation) => activation?.lastCheckInAt || null)
    .filter(Boolean)
    .sort()
    .pop() || null;

  return {
    success: true,
    valid: true,
    activated: true,
    plan: normalizePlan(license?.plan),
    licenseType: normalizeLicenseType(license?.license_type, license?.expiry_date),
    status: normalizeStatus(license?.status),
    environment: normalizeEnvironment(license?.environment),
    activationToken: overrides.activationToken ?? null,
    licenseId: license?.id ?? null,
    issuedAt: license?.issued_at || null,
    expiresAt: license?.expiry_date || null,
    supportExpiresAt: license?.support_expiry_date || null,
    seatsAllowed: resolveSeatLimit(license),
    orgName: license?.org_name || null,
    customerEmail: license?.customer_email || null,
    activeDeviceCount: overrides.activeDeviceCount ?? mappedActivations.filter((activation) => !activation?.deactivatedAt).length,
    lastCheckInAt,
    notes: license?.notes || null,
  };
}

async function countActiveActivations(licenseId) {
  const row = await getAsync(`
    SELECT COUNT(*) AS count
    FROM activations
    WHERE license_id = ? AND deactivated_at IS NULL
  `, [licenseId]);
  return Number(row?.count || 0);
}

async function activateLicenseSeat({ licenseId, deviceId, deviceName, email = null, actorType = "device", actorId = null, metadata = null }) {
  const numericLicenseId = Number(licenseId);
  const normalizedDeviceId = normalizeNullableString(deviceId);
  const normalizedDeviceName = normalizeNullableString(deviceName) || "unknown-device";
  if (!Number.isInteger(numericLicenseId) || numericLicenseId <= 0) {
    throw new Error("licenseId must be a positive integer");
  }
  if (!normalizedDeviceId) {
    throw new Error("deviceId is required");
  }

  return withImmediateTransaction(async () => {
    const license = await getLicenseById(numericLicenseId);
    const existingActivation = await getAsync(`
      SELECT *
      FROM activations
      WHERE license_id = ? AND device_id = ? AND deactivated_at IS NULL
      ORDER BY id DESC
      LIMIT 1
    `, [license.id, normalizedDeviceId]);

    if (existingActivation) {
      await runAsync(`
        UPDATE activations
        SET
          device_name = ?,
          email = COALESCE(?, email),
          last_check_in_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `, [normalizedDeviceName, normalizeNullableString(email), existingActivation.id]);

      await recordLicenseEvent({
        licenseId: license.id,
        activationId: existingActivation.id,
        eventType: "activation_reused",
        actorType,
        actorId: actorId || normalizedDeviceId,
        metadata: {
          deviceId: normalizedDeviceId,
          deviceName: normalizedDeviceName,
          ...(metadata || {}),
        },
      });

      const activation = await getAsync("SELECT * FROM activations WHERE id = ?", [existingActivation.id]);
      return {
        license,
        activation,
        activationToken: activation.activation_token,
        reused: true,
      };
    }

    const seatLimit = resolveSeatLimit(license);
    const activeCount = await countActiveActivations(license.id);
    if (activeCount >= seatLimit) {
      throw new Error(`Seat limit reached for ${normalizePlan(license.plan)} (${seatLimit} devices).`);
    }

    const activationToken = generateToken();
    const inserted = await runAsync(`
      INSERT INTO activations (
        license_id,
        device_id,
        device_name,
        email,
        activation_token,
        activated_at,
        last_check_in_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
    `, [
      license.id,
      normalizedDeviceId,
      normalizedDeviceName,
      normalizeNullableString(email),
      activationToken,
    ]);

    await recordLicenseEvent({
      licenseId: license.id,
      activationId: inserted.lastID,
      eventType: "activation_created",
      actorType,
      actorId: actorId || normalizedDeviceId,
      metadata: {
        deviceId: normalizedDeviceId,
        deviceName: normalizedDeviceName,
        ...(metadata || {}),
      },
    });

    const activation = await getAsync("SELECT * FROM activations WHERE id = ?", [inserted.lastID]);
    return {
      license,
      activation,
      activationToken,
      reused: false,
    };
  });
}

async function findPurchaseRecord({ stripeEventId = null, stripeSessionId = null, checkoutSessionId = null } = {}) {
  const eventId = normalizeNullableString(stripeEventId);
  const sessionId = normalizeNullableString(stripeSessionId);
  const checkoutId = normalizeNullableString(checkoutSessionId);
  if (!eventId && !sessionId && !checkoutId) return null;

  const clauses = [];
  const params = [];
  if (eventId) {
    clauses.push("stripe_event_id = ?");
    params.push(eventId);
  }
  if (sessionId) {
    clauses.push("stripe_session_id = ?");
    params.push(sessionId);
  }
  if (checkoutId) {
    clauses.push("checkout_session_id = ?");
    params.push(checkoutId);
  }

  const row = await getAsync(`
    SELECT *
    FROM purchase_events
    WHERE ${clauses.join(" OR ")}
    ORDER BY id DESC
    LIMIT 1
  `, params);

  return row || null;
}

async function createOrReusePurchaseRecord(input = {}) {
  const provider = normalizeNullableString(input.provider) || "stripe";
  const stripeEventId = normalizeNullableString(input.stripeEventId || input.stripe_event_id);
  const stripeSessionId = normalizeNullableString(input.stripeSessionId || input.stripe_session_id);
  const checkoutSessionId = normalizeNullableString(input.checkoutSessionId || input.checkout_session_id || stripeSessionId);
  const stripePaymentIntentId = normalizeNullableString(input.stripePaymentIntentId || input.stripe_payment_intent_id);
  const stripeCustomerId = normalizeNullableString(input.stripeCustomerId || input.stripe_customer_id);
  const stripePriceId = normalizeNullableString(input.stripePriceId || input.stripe_price_id || input.priceId || input.price_id);
  const customerEmail = normalizeNullableString(input.customerEmail || input.customer_email);
  const orgName = normalizeNullableString(input.orgName || input.org_name);
  const licenseId = input.licenseId || input.license_id || null;
  const targetLicenseId = input.targetLicenseId || input.target_license_id || null;
  const purchaseKind = parsePurchaseKindArg(input.purchaseKind || input.purchase_kind || "new_purchase");
  const environment = parseEnvironmentArg(input.environment, "test");
  const amountTotal = input.amountTotal == null ? null : Number(input.amountTotal);
  const currency = normalizeNullableString(input.currency);
  const status = normalizeNullableString(input.status) || "processing";
  const rawPayload = stringifyJson(input.rawPayload || input.raw_payload);

  let existing = await findPurchaseRecord({ stripeEventId, stripeSessionId, checkoutSessionId });
  if (existing) return existing;

  await runAsync(`
    INSERT OR IGNORE INTO purchase_events (
      provider,
      stripe_event_id,
      stripe_session_id,
      stripe_payment_intent_id,
      stripe_customer_id,
      stripe_price_id,
      customer_email,
      org_name,
      license_id,
      status,
      raw_payload,
      created_at,
      updated_at,
      environment,
      purchase_kind,
      target_license_id,
      checkout_session_id,
      price_id,
      amount_total,
      currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?, ?)
  `, [
    provider,
    stripeEventId,
    stripeSessionId || checkoutSessionId,
    stripePaymentIntentId,
    stripeCustomerId,
    stripePriceId,
    customerEmail,
    orgName,
    licenseId,
    status,
    rawPayload,
    environment,
    purchaseKind,
    targetLicenseId,
    checkoutSessionId,
    stripePriceId,
    Number.isFinite(amountTotal) ? amountTotal : null,
    currency,
  ]);

  existing = await findPurchaseRecord({ stripeEventId, stripeSessionId, checkoutSessionId });
  if (!existing) {
    throw new Error("Failed to create purchase record");
  }
  return existing;
}

async function finalizePurchaseRecord(purchaseId, input = {}) {
  const numericId = Number(purchaseId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("Purchase id must be a positive integer");
  }

  const stripePriceId = normalizeNullableString(input.stripePriceId || input.stripe_price_id || input.priceId || input.price_id);
  const rawPayload = stringifyJson(input.rawPayload || input.raw_payload);
  await runAsync(`
    UPDATE purchase_events
    SET
      stripe_event_id = COALESCE(?, stripe_event_id),
      stripe_session_id = COALESCE(?, stripe_session_id),
      stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_price_id = COALESCE(?, stripe_price_id),
      customer_email = COALESCE(?, customer_email),
      org_name = COALESCE(?, org_name),
      license_id = COALESCE(?, license_id),
      status = COALESCE(?, status),
      raw_payload = COALESCE(?, raw_payload),
      updated_at = datetime('now'),
      environment = COALESCE(?, environment),
      purchase_kind = COALESCE(?, purchase_kind),
      target_license_id = COALESCE(?, target_license_id),
      checkout_session_id = COALESCE(?, checkout_session_id),
      price_id = COALESCE(?, price_id),
      amount_total = COALESCE(?, amount_total),
      currency = COALESCE(?, currency)
    WHERE id = ?
  `, [
    normalizeNullableString(input.stripeEventId || input.stripe_event_id),
    normalizeNullableString(input.stripeSessionId || input.stripe_session_id),
    normalizeNullableString(input.stripePaymentIntentId || input.stripe_payment_intent_id),
    normalizeNullableString(input.stripeCustomerId || input.stripe_customer_id),
    stripePriceId,
    normalizeNullableString(input.customerEmail || input.customer_email),
    normalizeNullableString(input.orgName || input.org_name),
    input.licenseId || input.license_id || null,
    normalizeNullableString(input.status),
    rawPayload,
    normalizeNullableString(input.environment),
    normalizeNullableString(input.purchaseKind || input.purchase_kind),
    input.targetLicenseId || input.target_license_id || null,
    normalizeNullableString(input.checkoutSessionId || input.checkout_session_id),
    stripePriceId,
    input.amountTotal == null ? null : Number(input.amountTotal),
    normalizeNullableString(input.currency),
    numericId,
  ]);

  return getAsync("SELECT * FROM purchase_events WHERE id = ?", [numericId]);
}

async function addSeatsToLicense({ licenseId, additionalSeats, actorType = "stripe", actorId = null, metadata = null }) {
  const seatsToAdd = parsePositiveInt(additionalSeats, "additionalSeats");
  if (!seatsToAdd) throw new Error("additionalSeats must be a positive integer");

  const numericLicenseId = Number(licenseId);
  await withImmediateTransaction(async () => {
    const license = await getLicenseById(numericLicenseId);
    const previousSeats = resolveSeatLimit(license);
    const newSeats = previousSeats + seatsToAdd;
    await runAsync("UPDATE licenses SET seats_allowed = ? WHERE id = ?", [newSeats, license.id]);
    await recordLicenseEvent({
      licenseId: license.id,
      eventType: "seats_added",
      actorType,
      actorId,
      metadata: { ...(metadata || {}), previousSeats, newSeats, seatsAdded: seatsToAdd },
    });
  });

  return fetchLicenseDetails(numericLicenseId);
}

module.exports = {
  allAsync,
  getAsync,
  runAsync,
  ensureSchema,
  normalizeEnvironment,
  parseEnvironmentArg,
  normalizePlan,
  parsePlanArg,
  seatsForPlan,
  normalizeLicenseType,
  parseLicenseTypeArg,
  normalizeStatus,
  normalizePurchaseKind,
  parsePurchaseKindArg,
  normalizeLicenseKey,
  resolveSeatLimit,
  isValidDateValue,
  validateLicenseRecord,
  isLicenseExpired,
  dateOnlyFromValue,
  todayDateOnly,
  addDays,
  maxDateOnly,
  parsePositiveInt,
  validateLicenseShape,
  buildLicenseClientPayload,
  getLicenseByKey,
  findLicenseByKey,
  getLicenseById,
  fetchLicenseDetails,
  createLicense,
  revokeLicense,
  resetActivations,
  extendLicense,
  extendAnnualLicense,
  extendMaintenance,
  addSeatsToLicense,
  releaseActivation,
  reissueLicense,
  recordLicenseEvent,
  listLicenses,
  listRecentPurchaseEvents,
  listRecentLicenseEvents,
  countActiveActivations,
  activateLicenseSeat,
  findPurchaseRecord,
  createOrReusePurchaseRecord,
  finalizePurchaseRecord,
  mapLicenseRow,
  mapPurchaseRow,
  mapLicenseEventRow,
};

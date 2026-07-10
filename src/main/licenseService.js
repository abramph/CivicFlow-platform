const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");
const { getDeviceId, getDeviceName } = require("./device");
const logger = require("./logger");
const { resolveLicenseServerConfig } = require("./licenseServerConfig");

const TRIAL_DAYS = 30;

function getLicenseFilePath() {
  return path.join(app.getPath("userData"), "license.json");
}

function getTrialFilePath() {
  return path.join(app.getPath("userData"), "trial.json");
}

function getPendingDeactivationsFilePath() {
  return path.join(app.getPath("userData"), "pending-deactivations.json");
}
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_OFFLINE_GRACE_DAYS = 37;
const licenseRequestDiagnostics = {
  lastAttemptAt: null,
  lastMethod: null,
  lastEndpoint: null,
  lastServerUrl: null,
  lastSource: null,
  lastResult: null,
  lastStatusCode: null,
  lastError: null,
  lastResponseSnippet: null,
};

function updateLicenseRequestDiagnostics(patch) {
  Object.assign(licenseRequestDiagnostics, patch);
}

function getLicenseRequestDiagnostics() {
  return { ...licenseRequestDiagnostics };
}

function getResolvedServerConfig(overrideUrl = null, storedUrl = null) {
  return resolveLicenseServerConfig({ overrideUrl, storedUrl });
}

function previewResponseText(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return null;
  return value.slice(0, 240);
}

function mapNetworkFailure(err, serverConfig, endpointPath) {
  const causeCode = String(err?.cause?.code || err?.code || "").trim().toUpperCase();
  const baseUrl = serverConfig?.url || "the configured license server";

  if (err?.name === "AbortError") {
    return {
      kind: "timeout",
      userMessage: `License server timeout while contacting ${baseUrl}${endpointPath}.`,
      detail: "timeout",
    };
  }

  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") {
    return {
      kind: "dns",
      userMessage: `License server hostname could not be resolved: ${baseUrl}.`,
      detail: causeCode,
    };
  }

  if (causeCode === "ECONNREFUSED" || causeCode === "ECONNRESET" || causeCode === "EHOSTUNREACH" || causeCode === "EHOSTDOWN") {
    return {
      kind: "unreachable",
      userMessage: `License server unreachable at ${baseUrl}.`,
      detail: causeCode,
    };
  }

  return {
    kind: "network",
    userMessage: `License server unavailable at ${baseUrl}.`,
    detail: causeCode || err?.message || "network-error",
  };
}

async function requestJson(serverConfig, endpointPath, method, body) {
  const url = `${serverConfig.url}${endpointPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const requestStartedAt = nowIso();

  updateLicenseRequestDiagnostics({
    lastAttemptAt: requestStartedAt,
    lastMethod: method,
    lastEndpoint: endpointPath,
    lastServerUrl: serverConfig.url,
    lastSource: serverConfig.source,
    lastResult: "started",
    lastStatusCode: null,
    lastError: null,
    lastResponseSnippet: null,
  });

  logger.info("license-server-request-start", {
    method,
    endpoint: endpointPath,
    serverUrl: serverConfig.url,
    source: serverConfig.source,
  });

  try {
    const requestInit = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }

    const response = await fetch(url, requestInit);

    const text = await response.text();
    const snippet = previewResponseText(text);
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }

    if (!response.ok) {
      updateLicenseRequestDiagnostics({
        lastResult: "http-error",
        lastStatusCode: response.status,
        lastError: data?.error || data?.reason || `HTTP ${response.status}`,
        lastResponseSnippet: snippet,
      });
      logger.warn("license-server-request-http-error", {
        method,
        endpoint: endpointPath,
        serverUrl: serverConfig.url,
        statusCode: response.status,
        responseSnippet: snippet,
      });
      return {
        ok: false,
        statusCode: response.status,
        error: data?.error || data?.reason || `HTTP ${response.status}`,
      };
    }

    updateLicenseRequestDiagnostics({
      lastResult: "success",
      lastStatusCode: response.status,
      lastError: null,
      lastResponseSnippet: snippet,
    });
    logger.info("license-server-request-success", {
      method,
      endpoint: endpointPath,
      serverUrl: serverConfig.url,
      statusCode: response.status,
    });
    return { ok: true, data };
  } catch (err) {
    const failure = mapNetworkFailure(err, serverConfig, endpointPath);
    updateLicenseRequestDiagnostics({
      lastResult: failure.kind,
      lastStatusCode: null,
      lastError: failure.userMessage,
      lastResponseSnippet: null,
    });
    logger.error("license-server-request-failed", {
      method,
      endpoint: endpointPath,
      serverUrl: serverConfig.url,
      source: serverConfig.source,
      errorName: err?.name || null,
      errorMessage: err?.message || null,
      errorCode: err?.code || err?.cause?.code || null,
      errorCause: err?.cause?.message || null,
    });
    return {
      ok: false,
      error: failure.userMessage,
    };
  } finally {
    clearTimeout(timer);
  }
}

function postJson(serverConfig, endpointPath, body) {
  return requestJson(serverConfig, endpointPath, "POST", body);
}

function getJson(serverConfig, endpointPath) {
  return requestJson(serverConfig, endpointPath, "GET");
}

const PUBLIC_KEY_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxc5Yjr8Bcq97BtlzD4RK",
  "HUEZIX8LG3tIA9QixilRn5eseOQsuK0vFpMNhB16/8mbcUhyWlwlT8j/2VPI55s2",
  "rJmxK2YzDVNBwYAFFRPcaHyzkhxUVU89cTd24Y+kfv56h8Yr89kbF6dejcZKhM/n",
  "Y0s06UKXCO/COdTcqEz7f6b1u57GMaUqyZ0s62yFlRazea6qBj8JsRB6FAM93U/e",
  "MKHq/An750b/Prk1UafuFjoqX6KOHOzSNsWBW4CuaCyUHfSuZaHjIV84PeVgQUvQ",
  "+qYzIm0pKRKrPkBLpgUZdrU5j39pvsOx2Tj7uTMbm9NCHNiiHJEoqvL1ClGC6air",
  "lQIDAQAB",
  "-----END PUBLIC KEY-----",
].join("\n");

function nowIso() {
  return new Date().toISOString();
}

function maskLicenseKey(licenseKey) {
  const raw = String(licenseKey || "").trim();
  if (!raw) return null;
  if (raw.length <= 8) return "CF-****";
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
}

function getCurrentDeviceFingerprint() {
  return getDeviceId();
}

function computeOfflineGraceUntil(lastValidatedAt, graceDays = DEFAULT_OFFLINE_GRACE_DAYS) {
  const baseMs = new Date(lastValidatedAt).getTime();
  const days = Number(graceDays || DEFAULT_OFFLINE_GRACE_DAYS);
  if (!Number.isFinite(baseMs) || !Number.isFinite(days) || days <= 0) return null;
  return new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
}

function resolveLastValidatedAt(license) {
  return toIso(
    license?.lastValidatedAt
    || license?.lastOnlineCheck
    || license?.lastCheckedAt
    || license?.activatedAt
    || license?.issuedAt
  );
}

function logLicenseDiagnostics(event, details = {}) {
  logger.info(event, {
    licenseFilePath: getLicenseFilePath(),
    userDataPath: app.getPath("userData"),
    isPackaged: app.isPackaged,
    ...details,
  });
}

function isPermanentValidationReason(reason) {
  const text = String(reason || "").trim().toLowerCase();
  if (!text) return false;
  const permanentPatterns = [
    "revoked",
    "expired",
    "invalid key",
    "invalid license",
    "seat limit",
    "superseded",
    "license inactive",
    "license inactive",
    "not found for this device",
    "activation not found",
    "device not authorized",
  ];
  return permanentPatterns.some((pattern) => text.includes(pattern));
}

function classifyRefreshFailure(refreshResult) {
  if (refreshResult?.ok && refreshResult?.data?.success && refreshResult?.data?.valid) {
    return "ok";
  }
  if (!refreshResult?.ok) {
    if (!refreshResult?.statusCode) return "transient";
    if (refreshResult.statusCode >= 500) return "transient";
    if (refreshResult.statusCode === 404 || refreshResult.statusCode === 502 || refreshResult.statusCode === 503) {
      return "transient";
    }
  }
  const reason = refreshResult?.data?.reason || refreshResult?.data?.error || refreshResult?.error;
  if (isPermanentValidationReason(reason)) return "permanent";
  if (!refreshResult?.ok) return "transient";
  return "permanent";
}

function normalizeServerActivationData(data, serverConfig, deviceFingerprint) {
  const payload = data && typeof data === "object" ? data : {};
  const licenseBlock = payload.license && typeof payload.license === "object" ? payload.license : payload;
  const activationBlock = payload.activation && typeof payload.activation === "object" ? payload.activation : payload;

  const success = payload.success === true
    || payload.activated === true
    || licenseBlock.valid === true
    || payload.valid === true;

  const valid = payload.valid === true
    || payload.activated === true
    || (success && String(payload.status || licenseBlock.status || "active").toLowerCase() === "active");

  const now = nowIso();
  const lastValidatedAt = toIso(
    payload.lastValidatedAt
    || activationBlock.lastValidatedAt
    || licenseBlock.lastValidatedAt
    || now
  );
  const offlineGraceDays = Number(payload.offlineGraceDays || licenseBlock.offlineGraceDays || DEFAULT_OFFLINE_GRACE_DAYS);

  return {
    success,
    valid,
    plan: payload.plan || licenseBlock.plan,
    licenseType: payload.licenseType || licenseBlock.licenseType,
    status: String(payload.status || licenseBlock.status || "active").trim().toLowerCase() || "active",
    licenseId: payload.licenseId || licenseBlock.licenseId || licenseBlock.id || null,
    issuedAt: toIso(payload.issuedAt || licenseBlock.issuedAt),
    expiresAt: toIso(payload.expiresAt || licenseBlock.expiresAt),
    supportExpiresAt: toIso(payload.supportExpiresAt || licenseBlock.supportExpiresAt),
    activationToken: payload.activationToken || activationBlock.activationToken || activationBlock.token || null,
    activationId: payload.activationId || activationBlock.activationId || activationBlock.id || null,
    orgName: payload.orgName || licenseBlock.orgName || licenseBlock.organizationName || null,
    customerEmail: payload.customerEmail || licenseBlock.customerEmail || null,
    offlineGraceDays,
    warnAfterDays: Number(payload.warnAfterDays || licenseBlock.warnAfterDays || 30),
    seatsAllowed: Number(payload.seatsAllowed || licenseBlock.seatsAllowed || 0) || null,
    activeDeviceCount: Number(payload.activeDeviceCount || licenseBlock.activeDeviceCount || 0) || null,
    lastCheckInAt: toIso(payload.lastCheckInAt || activationBlock.lastCheckInAt),
    lastValidatedAt,
    offlineGraceUntil: toIso(payload.offlineGraceUntil) || computeOfflineGraceUntil(lastValidatedAt, offlineGraceDays),
    serverUrl: serverConfig?.url || null,
    deviceFingerprint,
    serverResponse: {
      success: payload.success,
      valid: payload.valid,
      activated: payload.activated,
      status: payload.status,
      reason: payload.reason || payload.error || null,
    },
  };
}

function buildPaidLicenseFromActivation(licenseKey, normalized, email) {
  const now = nowIso();
  const lastValidatedAt = normalized.lastValidatedAt || now;
  const offlineGraceDays = Number(normalized.offlineGraceDays || DEFAULT_OFFLINE_GRACE_DAYS);

  return {
    type: "paid",
    plan: normalizePlan(normalized.plan),
    licenseType: normalizeLicenseType(normalized.licenseType, normalized.expiresAt),
    validationMode: "server",
    status: normalized.status || "active",
    licenseId: normalized.licenseId || `CF-${Date.now()}`,
    licenseKey,
    activatedAt: now,
    lastValidatedAt,
    lastOnlineCheck: lastValidatedAt,
    lastCheckedAt: now,
    lastCheckInAt: normalized.lastCheckInAt,
    offlineGraceUntil: normalized.offlineGraceUntil || computeOfflineGraceUntil(lastValidatedAt, offlineGraceDays),
    offlineGraceDays,
    warnAfterDays: normalized.warnAfterDays,
    deviceId: normalized.deviceFingerprint,
    deviceFingerprint: normalized.deviceFingerprint,
    activationToken: normalized.activationToken,
    activationId: normalized.activationId,
    issuedAt: normalized.issuedAt || now,
    expiresAt: normalized.expiresAt,
    supportExpiresAt: normalized.supportExpiresAt,
    serverUrl: normalized.serverUrl,
    organizationName: normalized.orgName,
    orgName: normalized.orgName,
    customerEmail: normalized.customerEmail || email || null,
    seatsAllowed: normalized.seatsAllowed,
    activeDeviceCount: normalized.activeDeviceCount,
    invalidReason: null,
    serverResponse: normalized.serverResponse,
  };
}

function migrateLocalLicense(license) {
  if (!license || typeof license !== "object") return license;

  const migrated = { ...license };
  const deviceFingerprint = String(migrated.deviceFingerprint || migrated.deviceId || "").trim() || getCurrentDeviceFingerprint();
  migrated.deviceId = deviceFingerprint;
  migrated.deviceFingerprint = deviceFingerprint;

  if (migrated.type === "paid") {
    const lastValidatedAt = resolveLastValidatedAt(migrated);
    if (lastValidatedAt) {
      migrated.lastValidatedAt = lastValidatedAt;
      migrated.lastOnlineCheck = toIso(migrated.lastOnlineCheck) || lastValidatedAt;
    }
    const graceDays = Number(migrated.offlineGraceDays || DEFAULT_OFFLINE_GRACE_DAYS);
    migrated.offlineGraceUntil = toIso(migrated.offlineGraceUntil)
      || computeOfflineGraceUntil(lastValidatedAt, graceDays);
    migrated.offlineGraceDays = graceDays;
    if (!migrated.warnAfterDays) migrated.warnAfterDays = 30;
    if (migrated.orgName && !migrated.organizationName) migrated.organizationName = migrated.orgName;
    if (migrated.organizationName && !migrated.orgName) migrated.orgName = migrated.organizationName;
  }

  if (migrated.type === "trial") {
    migrated.fingerprintHash = String(migrated.fingerprintHash || "").trim() || buildTrialFingerprint(migrated.deviceId);
  }

  return migrated;
}

function detectDeviceFingerprintMismatch(license) {
  if (!license || license.type !== "paid") return null;
  const stored = String(license.deviceFingerprint || license.deviceId || "").trim();
  const current = getCurrentDeviceFingerprint();
  if (!stored || stored === current) return null;
  return { stored, current };
}

function toIso(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function buildTrialFingerprint(deviceId = getDeviceId()) {
  return crypto.createHash("sha256").update(String(deviceId || "").trim()).digest("hex");
}

function getLastValidatedAt(license) {
  return toIso(license?.lastValidatedAt || license?.lastOnlineCheck);
}

function requiresServerValidation(license) {
  if (!license || license.type !== "paid") return false;
  if (String(license.validationMode || "").trim().toLowerCase() === "signed") return false;
  return !!(
    license.activationToken
    || (license.licenseKey && (license.serverUrl || license.lastOnlineCheck || license.lastValidatedAt))
  );
}

function daysRemainingFromIso(expiresAt) {
  const expMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expMs)) return 0;
  return Math.max(0, Math.ceil((expMs - Date.now()) / (1000 * 60 * 60 * 24)));
}

function daysSinceIso(value) {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24)));
}

function normalizePlan(plan) {
  const normalized = String(plan || "").trim().toUpperCase();
  if (normalized === "ELITE") return "ELITE";
  if (normalized === "ESSENTIAL") return "ESSENTIAL";
  if (normalized === "TRIAL") return "TRIAL";
  return "ESSENTIAL";
}

function normalizeLicenseType(licenseType, expiresAt = null) {
  const normalized = String(licenseType || "").trim().toUpperCase();
  if (normalized === "TRIAL") return "TRIAL";
  if (normalized === "PERPETUAL" || normalized === "LIFETIME") return "PERPETUAL";
  if (normalized === "ANNUAL" || normalized === "YEARLY" || normalized === "SUBSCRIPTION") return "ANNUAL";
  return expiresAt ? "ANNUAL" : "PERPETUAL";
}

function loadJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function saveJsonFile(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

function allowSignedLicenseActivation() {
  const override = String(process.env.CIVICFLOW_ALLOW_SIGNED_LICENSES || "").trim().toLowerCase();
  return !app.isPackaged || override === "1" || override === "true" || override === "yes" || override === "on";
}

function loadLocalLicense() {
  const raw = loadJsonFile(getLicenseFilePath());
  if (!raw) {
    logLicenseDiagnostics("license-local-missing", {
      localLicenseFound: false,
    });
    return null;
  }

  const migrated = migrateLocalLicense(raw);
  const mismatch = detectDeviceFingerprintMismatch(migrated);
  logLicenseDiagnostics("license-local-loaded", {
    localLicenseFound: true,
    licenseType: migrated.type || null,
    licenseKeyMasked: maskLicenseKey(migrated.licenseKey),
    storedDeviceFingerprint: migrated.deviceFingerprint || null,
    currentDeviceFingerprint: getCurrentDeviceFingerprint(),
    deviceFingerprintMismatch: !!mismatch,
    lastValidatedAt: resolveLastValidatedAt(migrated),
    offlineGraceUntil: migrated.offlineGraceUntil || null,
    status: migrated.status || null,
  });

  if (mismatch) {
    migrated.deviceFingerprintMismatch = true;
    migrated.deviceFingerprintMismatchDetail = {
      stored: mismatch.stored,
      current: mismatch.current,
    };
  }

  return migrated;
}

function saveLocalLicense(state) {
  const normalized = migrateLocalLicense(state);
  saveJsonFile(getLicenseFilePath(), normalized);
  logLicenseDiagnostics("license-local-saved", {
    localLicenseFound: true,
    licenseType: normalized?.type || null,
    licenseKeyMasked: maskLicenseKey(normalized?.licenseKey),
    storedDeviceFingerprint: normalized?.deviceFingerprint || null,
    lastValidatedAt: resolveLastValidatedAt(normalized),
    offlineGraceUntil: normalized?.offlineGraceUntil || null,
  });
}

function loadTrialState() {
  return loadJsonFile(getTrialFilePath());
}

function saveTrialState(state) {
  saveJsonFile(getTrialFilePath(), state);
}

function normalizePendingDeactivationEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const licenseKey = String(entry.licenseKey || "").trim();
  const activationToken = String(entry.activationToken || "").trim();
  const deviceId = String(entry.deviceId || "").trim();
  const serverUrl = String(entry.serverUrl || "").trim();
  if (!licenseKey || !activationToken || !deviceId) return null;
  return {
    licenseKey,
    activationToken,
    deviceId,
    serverUrl,
    queuedAt: toIso(entry.queuedAt) || nowIso(),
    lastAttemptAt: toIso(entry.lastAttemptAt) || null,
    lastError: String(entry.lastError || "").trim() || null,
  };
}

function loadPendingDeactivations() {
  const raw = loadJsonFile(getPendingDeactivationsFilePath());
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizePendingDeactivationEntry).filter(Boolean);
}

function savePendingDeactivations(entries) {
  const normalized = Array.isArray(entries)
    ? entries.map(normalizePendingDeactivationEntry).filter(Boolean)
    : [];

  if (normalized.length === 0) {
    try {
      const pendingPath = getPendingDeactivationsFilePath();
      if (fs.existsSync(pendingPath)) {
        fs.unlinkSync(pendingPath);
      }
    } catch {
      // noop
    }
    return;
  }

  saveJsonFile(getPendingDeactivationsFilePath(), normalized);
}

function samePendingDeactivation(left, right) {
  return !!left
    && !!right
    && String(left.licenseKey || "").trim() === String(right.licenseKey || "").trim()
    && String(left.activationToken || "").trim() === String(right.activationToken || "").trim()
    && String(left.deviceId || "").trim() === String(right.deviceId || "").trim()
    && String(left.serverUrl || "").trim() === String(right.serverUrl || "").trim();
}

function enqueuePendingDeactivation(entry) {
  const normalized = normalizePendingDeactivationEntry(entry);
  if (!normalized) return [];
  const queue = loadPendingDeactivations().filter((item) => !samePendingDeactivation(item, normalized));
  queue.push(normalized);
  savePendingDeactivations(queue);
  return queue;
}

function buildPendingDeactivationEntry(license, errorMessage = null) {
  return normalizePendingDeactivationEntry({
    licenseKey: license?.licenseKey,
    activationToken: license?.activationToken,
    deviceId: license?.deviceId || getDeviceId(),
    serverUrl: license?.serverUrl || null,
    queuedAt: nowIso(),
    lastAttemptAt: nowIso(),
    lastError: errorMessage,
  });
}

async function flushPendingDeactivations() {
  const queue = loadPendingDeactivations();
  if (queue.length === 0) {
    return { attempted: 0, completed: 0, pending: 0 };
  }

  let completed = 0;
  const remaining = [];

  for (const entry of queue) {
    const serverConfig = getResolvedServerConfig(null, entry.serverUrl || null);
    if (!serverConfig.ok) {
      remaining.push({
        ...entry,
        lastAttemptAt: nowIso(),
        lastError: serverConfig.error,
      });
      continue;
    }

    const result = await postJson(serverConfig, "/api/license/deactivate", {
      licenseKey: entry.licenseKey,
      activationToken: entry.activationToken,
      deviceId: entry.deviceId,
    });

    if (result.ok && result.data?.success) {
      completed += 1;
      const local = loadLocalLicense();
      if (
        local?.licenseKey === entry.licenseKey
        && local?.activationToken === entry.activationToken
        && String(local?.deviceId || "") === entry.deviceId
      ) {
        clearLicense();
      }
      continue;
    }

    remaining.push({
      ...entry,
      lastAttemptAt: nowIso(),
      lastError: result.error || result.data?.error || result.data?.reason || "Deactivation retry failed.",
    });
  }

  savePendingDeactivations(remaining);
  return {
    attempted: queue.length,
    completed,
    pending: remaining.length,
  };
}

function normalizeTrialState(state) {
  const issuedAt = toIso(state?.issuedAt || state?.startedAt);
  const expiresAt = toIso(state?.expiresAt);
  if (!issuedAt || !expiresAt) return null;
  const deviceId = String(state?.deviceId || "").trim() || getDeviceId();
  return {
    issuedAt,
    expiresAt,
    deviceId,
    fingerprintHash: String(state?.fingerprintHash || "").trim() || buildTrialFingerprint(deviceId),
  };
}

function persistTrialStateFromLicense(license) {
  if (license?.type !== "trial") return;
  const issuedAt = toIso(license.issuedAt);
  const expiresAt = toIso(license.expiresAt);
  if (!issuedAt || !expiresAt) return;
  const deviceId = String(license.deviceId || "").trim() || getDeviceId();
  saveTrialState({
    issuedAt,
    expiresAt,
    deviceId,
    fingerprintHash: String(license.fingerprintHash || "").trim() || buildTrialFingerprint(deviceId),
  });
}

function createTrialLicense() {
  const existingTrial = normalizeTrialState(loadTrialState());
  const issuedAt = existingTrial?.issuedAt || nowIso();
  const expiresAt = existingTrial?.expiresAt || new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const deviceId = existingTrial?.deviceId || getDeviceId();
  const trial = {
    type: "trial",
    plan: "TRIAL",
    issuedAt,
    expiresAt,
    lastCheckedAt: nowIso(),
    deviceId,
    fingerprintHash: existingTrial?.fingerprintHash || buildTrialFingerprint(deviceId),
  };
  persistTrialStateFromLicense(trial);
  saveLocalLicense(trial);
  return trial;
}

function ensureLicenseInitialized() {
  const current = loadLocalLicense();
  if (current) {
    if (current.type === "trial") {
      persistTrialStateFromLicense(current);
    }
    return current;
  }
  return createTrialLicense();
}

function parseActivatePayload(payload) {
  if (typeof payload === "string") {
    return { licenseKey: payload.trim(), email: null, serverUrl: null };
  }
  const licenseKey = String(payload?.licenseKey || payload?.serial || payload?.key || "").trim();
  const email = payload?.email ? String(payload.email).trim() : null;
  const serverUrl = payload?.serverUrl || payload?.apiUrl || null;
  return { licenseKey, email, serverUrl };
}

function decodeBase64Utf8(text) {
  return Buffer.from(text, "base64").toString("utf8");
}

function parseSignedLicenseKey(licenseKey) {
  const parts = String(licenseKey || "").split(".");
  if (parts.length !== 2) {
    return { ok: false, error: "Invalid license format." };
  }

  const [payloadBase64, signatureBase64] = parts;

  try {
    const payloadJson = decodeBase64Utf8(payloadBase64);
    const payload = JSON.parse(payloadJson);

    const signature = Buffer.from(signatureBase64, "base64");
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(payloadJson, "utf8");
    verifier.end();
    const signatureValid = verifier.verify(PUBLIC_KEY_PEM, signature);
    if (!signatureValid) {
      return { ok: false, error: "License signature is invalid." };
    }

    const deviceId = getDeviceId();
    const keyDevice = String(payload?.deviceId || "").trim();
    if (keyDevice && keyDevice !== "ANY" && keyDevice !== deviceId) {
      return { ok: false, error: "License key is not valid for this device." };
    }

    const plan = normalizePlan(payload?.plan);
    if (plan !== "ESSENTIAL" && plan !== "ELITE") {
      return { ok: false, error: "License plan is invalid." };
    }

    const expiresAt = payload?.expiresAt ? toIso(payload.expiresAt) : null;
    if (payload?.expiresAt && !expiresAt) {
      return { ok: false, error: "License expiry date is invalid." };
    }
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      return { ok: false, error: "License key has expired." };
    }

    return {
      ok: true,
      payload: {
        licenseId: String(payload?.licenseId || "").trim() || `CF-${Date.now()}`,
        plan,
        licenseType: normalizeLicenseType(payload?.licenseType, expiresAt),
        status: "active",
        issuedAt: toIso(payload?.issuedAt) || nowIso(),
        expiresAt,
        deviceId,
        supportExpiresAt: toIso(payload?.supportExpiresAt) || null,
      },
    };
  } catch {
    return { ok: false, error: "License payload is invalid." };
  }
}

function mapLicenseToStatus(license) {
  if (!license) {
    return {
      status: "expired",
      daysRemaining: 0,
      plan: "TRIAL",
      valid: false,
      activated: false,
      reason: "no_license",
    };
  }

  if (license.type === "trial") {
    const daysRemaining = daysRemainingFromIso(license.expiresAt);
    const expired = daysRemaining <= 0;
    const currentDeviceId = getDeviceId();
    const currentFingerprint = buildTrialFingerprint(currentDeviceId);
    const trialDeviceMatches = (
      (!license.deviceId || license.deviceId === currentDeviceId)
      && (!license.fingerprintHash || license.fingerprintHash === currentFingerprint)
    );
    const valid = !expired && trialDeviceMatches;
    return {
      status: expired ? "expired" : (valid ? "trial" : "inactive"),
      daysRemaining,
      plan: "TRIAL",
      valid,
      activated: valid,
      reason: expired ? "trial_expired" : (trialDeviceMatches ? null : "trial_device_mismatch"),
      expiresAt: license.expiresAt,
      issuedAt: license.issuedAt,
      supportExpiresAt: null,
      deviceId: license.deviceId,
      organizationName: null,
      customerEmail: null,
      seatsAllowed: null,
      activeDeviceCount: null,
      lastValidatedAt: null,
      licenseType: "TRIAL",
      validationMode: "trial",
      type: "trial",
    };
  }

  if (license.type === "paid") {
    const signedValidation = String(license.validationMode || "").trim().toLowerCase() === "signed";
    if (signedValidation && !allowSignedLicenseActivation()) {
      return {
        status: "inactive",
        daysRemaining: license.expiresAt ? daysRemainingFromIso(license.expiresAt) : null,
        plan: normalizePlan(license.plan),
        valid: false,
        activated: false,
        reason: "signed_license_disabled",
        expiresAt: license.expiresAt || null,
        supportExpiresAt: license.supportExpiresAt || null,
        issuedAt: license.issuedAt || null,
        activatedAt: license.activatedAt || null,
        lastValidatedAt: getLastValidatedAt(license),
        lastOnlineCheck: getLastValidatedAt(license),
        lastOnlineCheckAt: getLastValidatedAt(license),
        lastCheckInAt: license.lastCheckInAt || null,
        serverUrl: license.serverUrl || null,
        deviceId: license.deviceId || getDeviceId(),
        licenseId: license.licenseId || null,
        organizationName: license.organizationName || license.orgName || null,
        customerEmail: license.customerEmail || null,
        seatsAllowed: Number(license.seatsAllowed || 0) || null,
        activeDeviceCount: Number(license.activeDeviceCount || 0) || null,
        licenseType: normalizeLicenseType(license.licenseType, license.expiresAt),
        statusValue: String(license.status || "active").trim().toLowerCase() || "active",
        invalidReason: "Signed licenses are disabled in packaged builds.",
        validationMode: "signed",
        warnings: [],
        type: "paid",
      };
    }

    const invalidReasonText = String(license.invalidReason || "").trim();
    const licenseState = String(license.status || "active").trim().toLowerCase();
    const forcedExpired = licenseState === "expired" || invalidReasonText.toLowerCase().includes("expired");
    const isExpired = forcedExpired || !!(license.expiresAt && new Date(license.expiresAt).getTime() < Date.now());
    const isActiveState = licenseState === "active";
    const serverValidated = requiresServerValidation(license);
    const offlineGraceDays = Number(license.offlineGraceDays || DEFAULT_OFFLINE_GRACE_DAYS);
    const warnAfterDays = Number(license.warnAfterDays || 30);
    const lastValidatedAt = resolveLastValidatedAt(license);
    const offlineGraceUntil = toIso(license.offlineGraceUntil)
      || computeOfflineGraceUntil(lastValidatedAt, offlineGraceDays);
    const graceUntilMs = offlineGraceUntil ? new Date(offlineGraceUntil).getTime() : null;
    const offlineGraceExpired = serverValidated
      && Number.isFinite(graceUntilMs)
      && Date.now() > graceUntilMs;
    const daysRemainingOffline = serverValidated && Number.isFinite(graceUntilMs)
      ? Math.max(0, Math.ceil((graceUntilMs - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;
    const fingerprintMismatch = detectDeviceFingerprintMismatch(license);
    const warnings = [];

    if (fingerprintMismatch) {
      warnings.push(
        "This device fingerprint changed since activation. Re-validate online or contact Unestra support if this computer was not replaced."
      );
    }

    if (serverValidated && isActiveState && !offlineGraceExpired && daysRemainingOffline != null && daysRemainingOffline <= warnAfterDays && !isExpired) {
      warnings.push(
        `Offline grace ends in ${daysRemainingOffline} day${daysRemainingOffline === 1 ? "" : "s"}. Check in now to refresh.`
      );
    }

    const blockedByFingerprint = !!fingerprintMismatch && serverValidated;
    const locallyUsable = !isExpired
      && isActiveState
      && !offlineGraceExpired
      && !blockedByFingerprint;

    return {
      status: isExpired ? "expired" : (locallyUsable ? "active" : "inactive"),
      daysRemaining: isExpired ? 0 : (license.expiresAt ? daysRemainingFromIso(license.expiresAt) : null),
      daysRemainingOffline,
      offlineGraceDays,
      offlineGraceUntil,
      warnAfterDays,
      plan: normalizePlan(license.plan),
      valid: locallyUsable,
      activated: locallyUsable,
      reason: isExpired
        ? (invalidReasonText || "expired")
        : (blockedByFingerprint
          ? "device_fingerprint_mismatch"
          : (offlineGraceExpired
            ? "offline_grace_expired"
            : (isActiveState ? (invalidReasonText || null) : (invalidReasonText || licenseState || "inactive")))),
      expiresAt: license.expiresAt || null,
      supportExpiresAt: license.supportExpiresAt || null,
      issuedAt: license.issuedAt || null,
      activatedAt: license.activatedAt || null,
      lastValidatedAt,
      lastOnlineCheck: lastValidatedAt,
      lastOnlineCheckAt: lastValidatedAt,
      lastCheckInAt: license.lastCheckInAt || null,
      serverUrl: license.serverUrl || null,
      deviceId: license.deviceId || getDeviceId(),
      licenseId: license.licenseId || null,
      organizationName: license.organizationName || license.orgName || null,
      customerEmail: license.customerEmail || null,
      seatsAllowed: Number(license.seatsAllowed || 0) || null,
      activeDeviceCount: Number(license.activeDeviceCount || 0) || null,
      licenseType: normalizeLicenseType(license.licenseType, license.expiresAt),
      statusValue: licenseState,
      invalidReason: invalidReasonText || null,
      validationMode: serverValidated ? "server" : "signed",
      warnings,
      type: "paid",
    };
  }

  return {
    status: "expired",
    daysRemaining: 0,
    plan: "TRIAL",
    valid: false,
    activated: false,
    reason: "invalid_license",
  };
}

function getLicenseStatus() {
  const current = ensureLicenseInitialized();
  const status = mapLicenseToStatus(current);
  const pendingQueue = loadPendingDeactivations();
  const hasPendingForCurrent = pendingQueue.some((entry) => samePendingDeactivation(entry, buildPendingDeactivationEntry(current)));

  if (!status.valid) {
    logLicenseDiagnostics("license-activation-screen-candidate", {
      reason: status.reason || null,
      licenseType: status.type || null,
      validationMode: status.validationMode || null,
      invalidReason: status.invalidReason || null,
      offlineGraceUntil: status.offlineGraceUntil || null,
      lastValidatedAt: status.lastValidatedAt || null,
    });
  }

  return {
    ...status,
    licenseFilePath: getLicenseFilePath(),
    localLicenseFound: !!current,
    licenseKeyMasked: maskLicenseKey(current?.licenseKey),
    storedDeviceFingerprint: current?.deviceFingerprint || current?.deviceId || null,
    currentDeviceFingerprint: getCurrentDeviceFingerprint(),
    pendingDeactivation: hasPendingForCurrent,
    pendingDeactivationCount: pendingQueue.length,
  };
}

async function activateLicense(payload) {
  const { licenseKey, email, serverUrl } = parseActivatePayload(payload);
  if (!licenseKey) {
    return { success: false, valid: false, error: "Activation code is required." };
  }

  await flushPendingDeactivations();
  const current = loadLocalLicense();
  persistTrialStateFromLicense(current);

  const looksSignedKey = String(licenseKey).includes(".");
  if (!looksSignedKey) {
    const serverConfig = getResolvedServerConfig(serverUrl, current?.serverUrl || null);
    if (!serverConfig.ok) {
      updateLicenseRequestDiagnostics({
        lastAttemptAt: nowIso(),
        lastMethod: "POST",
        lastEndpoint: "/api/license/activate",
        lastServerUrl: null,
        lastSource: serverConfig.source,
        lastResult: "configuration-error",
        lastStatusCode: null,
        lastError: serverConfig.error,
        lastResponseSnippet: null,
      });
      logger.error("license-server-config-missing", {
        action: "activate",
        source: serverConfig.source,
        error: serverConfig.error,
      });
      return { success: false, valid: false, error: serverConfig.error };
    }

    const deviceFingerprint = getCurrentDeviceFingerprint();
    logLicenseDiagnostics("license-activate-start", {
      licenseKeyMasked: maskLicenseKey(licenseKey),
      storedDeviceFingerprint: deviceFingerprint,
      currentDeviceFingerprint: deviceFingerprint,
      validationEndpoint: `${serverConfig.url}/api/license/activate`,
    });

    const activateResult = await postJson(serverConfig, "/api/license/activate", {
      licenseKey,
      key: licenseKey,
      email,
      deviceId: deviceFingerprint,
      deviceName: getDeviceName(),
    });

    if (!activateResult.ok) {
      return {
        success: false,
        valid: false,
        error: activateResult.error || "License server unavailable or activation failed.",
      };
    }

    const normalized = normalizeServerActivationData(activateResult.data || {}, serverConfig, deviceFingerprint);
    if (!normalized.success || !normalized.valid) {
      return {
        success: false,
        valid: false,
        error: normalized.serverResponse?.reason || "Activation failed.",
      };
    }

    if (!normalized.activationToken) {
      return {
        success: false,
        valid: false,
        error: "Activation succeeded but no activation token was returned by the license server.",
      };
    }

    const paid = buildPaidLicenseFromActivation(licenseKey, normalized, email);
    saveLocalLicense(paid);
    logLicenseDiagnostics("license-activate-success", {
      licenseKeyMasked: maskLicenseKey(licenseKey),
      storedDeviceFingerprint: paid.deviceFingerprint,
      lastValidatedAt: paid.lastValidatedAt,
      offlineGraceUntil: paid.offlineGraceUntil,
      validationEndpoint: `${serverConfig.url}/api/license/activate`,
    });
    const status = mapLicenseToStatus(paid);
    return { success: true, ...status };
  }

  if (!allowSignedLicenseActivation()) {
    return {
      success: false,
      valid: false,
      error: "Signed licenses are disabled in packaged builds. Activate against the Unestra license server instead.",
    };
  }

  const parsed = parseSignedLicenseKey(licenseKey);
  if (!parsed.ok) {
    return { success: false, valid: false, error: parsed.error || "Activation failed." };
  }

  const now = nowIso();
  const deviceFingerprint = parsed.payload.deviceId || getCurrentDeviceFingerprint();
  const paid = {
    type: "paid",
    plan: parsed.payload.plan,
    licenseType: parsed.payload.licenseType,
    validationMode: "signed",
    status: parsed.payload.status,
    licenseId: parsed.payload.licenseId,
    activatedAt: now,
    lastValidatedAt: now,
    lastOnlineCheck: now,
    lastCheckedAt: now,
    offlineGraceUntil: computeOfflineGraceUntil(now, DEFAULT_OFFLINE_GRACE_DAYS),
    offlineGraceDays: DEFAULT_OFFLINE_GRACE_DAYS,
    deviceId: deviceFingerprint,
    deviceFingerprint,
    issuedAt: parsed.payload.issuedAt,
    expiresAt: parsed.payload.expiresAt,
    supportExpiresAt: parsed.payload.supportExpiresAt,
    customerEmail: email || null,
    organizationName: null,
    seatsAllowed: null,
    activeDeviceCount: null,
    lastCheckInAt: null,
  };

  saveLocalLicense(paid);
  const status = mapLicenseToStatus(paid);
  return { success: true, ...status };
}

async function refreshLicense() {
  await flushPendingDeactivations();
  const current = ensureLicenseInitialized();
  if (!current) {
    return { success: false, valid: false, error: "License state is unavailable." };
  }

  if (current.type === "paid") {
    if (String(current.validationMode || "").trim().toLowerCase() === "signed" && !allowSignedLicenseActivation()) {
      return {
        success: false,
        ...mapLicenseToStatus(current),
        error: "Signed licenses are disabled in packaged builds. Activate against the Unestra license server instead.",
      };
    }

    const serverManaged = requiresServerValidation(current);
    const serverConfig = getResolvedServerConfig(null, current.serverUrl || null);
    const localStatus = mapLicenseToStatus(current);

    if (serverManaged && current.licenseKey && current.activationToken) {
      const deviceFingerprint = getCurrentDeviceFingerprint();
      const validationEndpoint = serverConfig.ok
        ? `${serverConfig.url}/api/license/refresh`
        : null;

      logLicenseDiagnostics("license-validate-start", {
        licenseKeyMasked: maskLicenseKey(current.licenseKey),
        storedDeviceFingerprint: current.deviceFingerprint || current.deviceId || null,
        currentDeviceFingerprint: deviceFingerprint,
        lastValidatedAt: resolveLastValidatedAt(current),
        offlineGraceUntil: current.offlineGraceUntil || null,
        validationEndpoint,
      });

      if (!serverConfig.ok) {
        updateLicenseRequestDiagnostics({
          lastAttemptAt: nowIso(),
          lastMethod: "POST",
          lastEndpoint: "/api/license/refresh",
          lastServerUrl: null,
          lastSource: serverConfig.source,
          lastResult: "configuration-error",
          lastStatusCode: null,
          lastError: serverConfig.error,
          lastResponseSnippet: null,
        });
        return {
          success: false,
          ...localStatus,
          keptLocalAccess: localStatus.valid,
          validationWarning: localStatus.valid
            ? `License server is not configured. Offline grace remains active until ${localStatus.offlineGraceUntil || "the grace period ends"}.`
            : null,
          error: serverConfig.error,
        };
      }

      const refreshResult = await postJson(serverConfig, "/api/license/refresh", {
        licenseKey: current.licenseKey,
        activationToken: current.activationToken,
        deviceId: deviceFingerprint,
      });

      const failureKind = classifyRefreshFailure(refreshResult);

      logLicenseDiagnostics("license-validate-result", {
        licenseKeyMasked: maskLicenseKey(current.licenseKey),
        validationEndpoint,
        validationResult: failureKind,
        httpStatus: refreshResult.statusCode || null,
        reason: refreshResult?.data?.reason || refreshResult?.error || null,
      });

      if (failureKind === "transient") {
        const checked = {
          ...current,
          lastCheckedAt: nowIso(),
        };
        saveLocalLicense(checked);
        return {
          success: false,
          ...mapLicenseToStatus(checked),
          keptLocalAccess: localStatus.valid,
          validationWarning: localStatus.valid
            ? `Could not reach the license server (${refreshResult.error || "network error"}). Offline grace remains active.`
            : null,
          error: refreshResult.error || refreshResult.data?.error || "License server unavailable.",
        };
      }

      if (failureKind === "permanent") {
        const invalidReason = refreshResult?.data?.reason || refreshResult?.data?.error || refreshResult.error || "refresh_failed";
        const invalid = {
          ...current,
          lastCheckedAt: nowIso(),
          status: invalidReason.toLowerCase().includes("expired") ? "expired" : "revoked",
          invalidReason,
        };
        saveLocalLicense(invalid);
        logLicenseDiagnostics("license-activation-screen-candidate", {
          reason: "server_validation_permanent_failure",
          invalidReason,
          validationEndpoint,
        });
        return { success: false, ...mapLicenseToStatus(invalid), error: invalidReason };
      }

      const normalized = normalizeServerActivationData(refreshResult.data || {}, serverConfig, deviceFingerprint);
      const now = nowIso();
      const lastValidatedAt = normalized.lastValidatedAt || now;
      const offlineGraceDays = Number(normalized.offlineGraceDays || current.offlineGraceDays || DEFAULT_OFFLINE_GRACE_DAYS);
      const next = {
        ...current,
        plan: normalizePlan(normalized.plan || current.plan),
        licenseType: normalizeLicenseType(normalized.licenseType || current.licenseType, normalized.expiresAt || current.expiresAt || null),
        validationMode: "server",
        status: normalized.status || current.status || "active",
        lastCheckedAt: now,
        lastValidatedAt,
        lastOnlineCheck: lastValidatedAt,
        offlineGraceUntil: normalized.offlineGraceUntil || computeOfflineGraceUntil(lastValidatedAt, offlineGraceDays),
        offlineGraceDays,
        lastCheckInAt: normalized.lastCheckInAt || current.lastCheckInAt || null,
        serverUrl: serverConfig.url,
        deviceId: deviceFingerprint,
        deviceFingerprint,
        activationToken: normalized.activationToken || current.activationToken,
        activationId: normalized.activationId || current.activationId || null,
        issuedAt: normalized.issuedAt || current.issuedAt || null,
        expiresAt: normalized.expiresAt || current.expiresAt || null,
        supportExpiresAt: normalized.supportExpiresAt || current.supportExpiresAt || null,
        organizationName: normalized.orgName || current.organizationName || null,
        orgName: normalized.orgName || current.orgName || null,
        customerEmail: normalized.customerEmail || current.customerEmail || null,
        seatsAllowed: normalized.seatsAllowed ?? current.seatsAllowed ?? null,
        activeDeviceCount: normalized.activeDeviceCount ?? current.activeDeviceCount ?? null,
        invalidReason: null,
        serverResponse: normalized.serverResponse,
      };

      saveLocalLicense(next);
      return { success: true, ...mapLicenseToStatus(next) };
    }

    if (serverManaged) {
      return {
        success: false,
        ...mapLicenseToStatus(current),
        error: current.activationToken
          ? "License server configuration is missing for this device."
          : "License activation token is missing for this device.",
      };
    }
  }

  return { success: true, ...mapLicenseToStatus(current) };
}

async function deactivateLicense() {
  const current = loadLocalLicense();
  if (!current) {
    return { success: true };
  }

  const serverConfig = getResolvedServerConfig(null, current?.serverUrl || null);

  if (
    current?.type === "paid"
    && serverConfig.ok
    && current?.licenseKey
    && current?.activationToken
  ) {
    const releaseResult = await postJson(serverConfig, "/api/license/deactivate", {
      licenseKey: current.licenseKey,
      activationToken: current.activationToken,
      deviceId: getDeviceId(),
    });

    if (!releaseResult.ok || !releaseResult.data?.success) {
      const queue = enqueuePendingDeactivation(buildPendingDeactivationEntry(
        current,
        releaseResult.error || releaseResult.data?.error || releaseResult.data?.reason || "Deactivation failed."
      ));
      return {
        success: false,
        queued: true,
        pendingDeactivationCount: queue.length,
        error: releaseResult.error || releaseResult.data?.error || releaseResult.data?.reason || "License server release failed.",
      };
    }

    clearLicense();
    savePendingDeactivations(loadPendingDeactivations().filter((entry) => !samePendingDeactivation(entry, buildPendingDeactivationEntry(current))));
    return { success: true };
  }

  if (current?.type === "paid" && current?.licenseKey && current?.activationToken) {
    const queue = enqueuePendingDeactivation(buildPendingDeactivationEntry(
      current,
      serverConfig.ok ? "Deactivation did not complete." : serverConfig.error
    ));
    return {
      success: false,
      queued: true,
      pendingDeactivationCount: queue.length,
      error: serverConfig.ok ? "License server release failed." : serverConfig.error,
    };
  }

  clearLicense();
  return { success: true };
}

async function startTrial() {
  const trial = createTrialLicense();
  return { success: true, ...mapLicenseToStatus(trial) };
}

function clearLicense() {
  try {
    const licensePath = getLicenseFilePath();
    if (fs.existsSync(licensePath)) {
      fs.unlinkSync(licensePath);
    }
  } catch {
    // noop
  }
}

function resetLocalLicenseData() {
  clearLicense();
  try {
    const trialPath = getTrialFilePath();
    if (fs.existsSync(trialPath)) {
      fs.unlinkSync(trialPath);
    }
  } catch {
    // noop
  }
  logLicenseDiagnostics("license-local-reset", { localLicenseFound: false });
  const trial = createTrialLicense();
  return { success: true, ...mapLicenseToStatus(trial) };
}

function getLicenseServerConfig() {
  const current = loadLocalLicense();
  const resolved = getResolvedServerConfig(null, current?.serverUrl || null);
  const pendingQueue = loadPendingDeactivations();
  return {
    ...resolved,
    requestDiagnostics: getLicenseRequestDiagnostics(),
    pendingDeactivationCount: pendingQueue.length,
  };
}

async function getServerHealth() {
  await flushPendingDeactivations();
  const current = loadLocalLicense();
  const serverConfig = getResolvedServerConfig(null, current?.serverUrl || null);
  if (serverConfig.ok) {
    const health = await getJson(serverConfig, "/health");
    return {
      ok: !!health.ok,
      mode: "server-validation",
      serverUrl: serverConfig.url,
      source: serverConfig.source,
      ...(health.data || {}),
    };
  }

  return {
    ok: false,
    mode: "configuration-error",
    error: serverConfig.error,
    source: serverConfig.source,
    deviceName: getDeviceName(),
  };
}

module.exports = {
  activateLicense,
  deactivateLicense,
  refreshLicense,
  startTrial,
  loadLocalLicense,
  clearLicense,
  resetLocalLicenseData,
  getLicenseFilePath,
  getLicenseServerConfig,
  getServerHealth,
  getLicenseStatus,
  ensureLicenseInitialized,
  createTrialLicense,
  _private: {
    allowSignedLicenseActivation,
    buildPendingDeactivationEntry,
    classifyRefreshFailure,
    computeOfflineGraceUntil,
    detectDeviceFingerprintMismatch,
    flushPendingDeactivations,
    loadPendingDeactivations,
    mapLicenseToStatus,
    migrateLocalLicense,
    maskLicenseKey,
    normalizeServerActivationData,
    savePendingDeactivations,
  },
};




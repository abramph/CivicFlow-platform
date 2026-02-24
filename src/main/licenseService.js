const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");
const { getDeviceId, getDeviceName } = require("./device");

const TRIAL_DAYS = 30;
const LICENSE_FILE = path.join(app.getPath("userData"), "license.json");
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_OFFLINE_GRACE_DAYS = 37;
const LOCAL_DEV_SERVER_URL = "http://localhost:4000";

function normalizeServerUrl(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function configuredServerUrl() {
  return normalizeServerUrl(
    process.env.ACTIVATION_API_URL || process.env.CIVICFLOW_LICENSE_SERVER_URL || ""
  );
}

function resolveServerUrl(overrideUrl) {
  return (
    normalizeServerUrl(overrideUrl)
    || normalizeServerUrl(loadLocalLicense()?.serverUrl)
    || configuredServerUrl()
    || null
  );
}

async function requestJson(url, method, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        error: data?.error || data?.reason || `HTTP ${response.status}`,
      };
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? "License server timeout" : (err?.message || "Network error"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function postJson(url, body) {
  return requestJson(url, "POST", body);
}

function getJson(url) {
  return requestJson(url, "GET");
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

function toIso(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
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

function loadLocalLicense() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null;
    return JSON.parse(fs.readFileSync(LICENSE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveLocalLicense(state) {
  fs.mkdirSync(path.dirname(LICENSE_FILE), { recursive: true });
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function createTrialLicense() {
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const trial = {
    type: "trial",
    plan: "TRIAL",
    issuedAt,
    expiresAt,
    lastCheckedAt: issuedAt,
    deviceId: getDeviceId(),
  };
  saveLocalLicense(trial);
  return trial;
}

function ensureLicenseInitialized() {
  const current = loadLocalLicense();
  if (current) return current;
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
        issuedAt: toIso(payload?.issuedAt) || nowIso(),
        expiresAt,
        deviceId,
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
    return {
      status: expired ? "expired" : "trial",
      daysRemaining,
      plan: "TRIAL",
      valid: !expired,
      activated: !expired,
      reason: expired ? "trial_expired" : null,
      expiresAt: license.expiresAt,
      issuedAt: license.issuedAt,
      deviceId: license.deviceId,
      licenseType: "TRIAL",
      type: "trial",
    };
  }

  if (license.type === "paid") {
    const isExpired = !!(license.expiresAt && new Date(license.expiresAt).getTime() < Date.now());
    const offlineGraceDays = Number(license.offlineGraceDays || DEFAULT_OFFLINE_GRACE_DAYS);
    const warnAfterDays = Number(license.warnAfterDays || 30);
    const lastOnlineCheckAt = license.lastOnlineCheck || null;
    const daysOffline = lastOnlineCheckAt ? daysSinceIso(lastOnlineCheckAt) : 0;
    const daysRemainingOffline = Math.max(0, offlineGraceDays - daysOffline);
    const warnings = [];

    if (daysRemainingOffline <= warnAfterDays && !isExpired) {
      warnings.push(
        `Offline grace ends in ${daysRemainingOffline} day${daysRemainingOffline === 1 ? "" : "s"}. Check in now to refresh.`
      );
    }

    return {
      status: isExpired ? "expired" : "active",
      daysRemaining: isExpired ? 0 : (license.expiresAt ? daysRemainingFromIso(license.expiresAt) : 0),
      daysRemainingOffline,
      offlineGraceDays,
      warnAfterDays,
      plan: normalizePlan(license.plan),
      valid: !isExpired,
      activated: !isExpired,
      reason: isExpired ? "expired" : null,
      expiresAt: license.expiresAt || null,
      activatedAt: license.activatedAt || null,
      lastOnlineCheck: lastOnlineCheckAt,
      lastOnlineCheckAt,
      deviceId: license.deviceId || getDeviceId(),
      licenseId: license.licenseId || null,
      licenseType: normalizePlan(license.plan),
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
  const existing = ensureLicenseInitialized();
  const now = nowIso();
  const next = { ...existing, lastCheckedAt: now };
  if (next.type === "paid") {
    next.lastOnlineCheck = next.lastOnlineCheck || now;
  }
  saveLocalLicense(next);
  return mapLicenseToStatus(next);
}

async function activateLicense(payload) {
  const { licenseKey, email, serverUrl } = parseActivatePayload(payload);
  if (!licenseKey) {
    return { success: false, valid: false, error: "Activation code is required." };
  }

  const looksSignedKey = String(licenseKey).includes(".");
  const resolvedServerUrl = resolveServerUrl(serverUrl) || (!looksSignedKey ? LOCAL_DEV_SERVER_URL : null);
  if (resolvedServerUrl) {
    const deviceId = getDeviceId();
    const activateResult = await postJson(`${resolvedServerUrl}/api/license/activate`, {
      licenseKey,
      key: licenseKey,
      email,
      deviceId,
      deviceName: getDeviceName(),
    });

    if (!activateResult.ok) {
      return {
        success: false,
        valid: false,
        error: activateResult.error || "License server unavailable or activation failed.",
      };
    }

    const data = activateResult.data || {};
    if (!data.success || !data.valid) {
      return {
        success: false,
        valid: false,
        error: data.reason || data.error || "Activation failed.",
      };
    }

    const now = nowIso();
    const paid = {
      type: "paid",
      plan: normalizePlan(data.plan),
      licenseId: data.licenseId || `CF-${Date.now()}`,
      activatedAt: now,
      lastOnlineCheck: now,
      lastCheckedAt: now,
      deviceId,
      issuedAt: now,
      expiresAt: toIso(data.expiresAt),
      activationToken: data.activationToken || null,
      licenseKey,
      serverUrl: resolvedServerUrl,
      offlineGraceDays: Number(data.offlineGraceDays || DEFAULT_OFFLINE_GRACE_DAYS),
      warnAfterDays: Number(data.warnAfterDays || 30),
    };

    saveLocalLicense(paid);
    const status = mapLicenseToStatus(paid);
    return { success: true, ...status };
  }

  if (!looksSignedKey) {
    return {
      success: false,
      valid: false,
      error: "License key requires server validation. Start license server or configure ACTIVATION_API_URL.",
    };
  }

  const parsed = parseSignedLicenseKey(licenseKey);
  if (!parsed.ok) {
    return { success: false, valid: false, error: parsed.error || "Activation failed." };
  }

  const now = nowIso();
  const paid = {
    type: "paid",
    plan: parsed.payload.plan,
    licenseId: parsed.payload.licenseId,
    activatedAt: now,
    lastOnlineCheck: now,
    lastCheckedAt: now,
    deviceId: parsed.payload.deviceId,
    issuedAt: parsed.payload.issuedAt,
    expiresAt: parsed.payload.expiresAt,
  };

  saveLocalLicense(paid);
  const status = mapLicenseToStatus(paid);
  return { success: true, ...status };
}

async function refreshLicense() {
  const current = ensureLicenseInitialized();
  if (!current) {
    return { success: false, valid: false, error: "License state is unavailable." };
  }

  if (current.type === "paid") {
    const resolvedServerUrl = resolveServerUrl(current.serverUrl);
    if (resolvedServerUrl && current.licenseKey && current.activationToken) {
      const refreshResult = await postJson(`${resolvedServerUrl}/api/license/refresh`, {
        licenseKey: current.licenseKey,
        activationToken: current.activationToken,
        deviceId: getDeviceId(),
      });

      if (!refreshResult.ok) {
        const local = { ...current, lastCheckedAt: nowIso() };
        saveLocalLicense(local);
        return { success: false, ...mapLicenseToStatus(local), error: refreshResult.error };
      }

      const data = refreshResult.data || {};
      if (!data.success || !data.valid) {
        clearLicense();
        return { success: false, valid: false, activated: false, reason: data.reason || "refresh_failed" };
      }

      const now = nowIso();
      const next = {
        ...current,
        plan: normalizePlan(data.plan || current.plan),
        lastCheckedAt: now,
        lastOnlineCheck: now,
        serverUrl: resolvedServerUrl,
        activationToken: data.activationToken || current.activationToken,
        expiresAt: toIso(data.expiresAt) || current.expiresAt || null,
      };

      saveLocalLicense(next);
      return { success: true, ...mapLicenseToStatus(next) };
    }
  }

  const now = nowIso();
  const next = { ...current, lastCheckedAt: now };
  if (next.type === "paid") {
    next.lastOnlineCheck = now;
  }

  saveLocalLicense(next);
  return { success: true, ...mapLicenseToStatus(next) };
}

async function deactivateLicense() {
  const current = loadLocalLicense();
  const resolvedServerUrl = resolveServerUrl(current?.serverUrl);

  if (
    current?.type === "paid"
    && resolvedServerUrl
    && current?.licenseKey
    && current?.activationToken
  ) {
    await postJson(`${resolvedServerUrl}/api/license/deactivate`, {
      licenseKey: current.licenseKey,
      activationToken: current.activationToken,
      deviceId: getDeviceId(),
    });
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
    if (fs.existsSync(LICENSE_FILE)) {
      fs.unlinkSync(LICENSE_FILE);
    }
  } catch {
    // noop
  }
}

async function getServerHealth() {
  const resolvedServerUrl = resolveServerUrl();
  if (resolvedServerUrl) {
    const health = await getJson(`${resolvedServerUrl}/health`);
    return {
      ok: !!health.ok,
      mode: "server-validation",
      serverUrl: resolvedServerUrl,
      ...(health.data || {}),
    };
  }

  return {
    ok: true,
    mode: "local-signature-validation",
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
  getServerHealth,
  getLicenseStatus,
  ensureLicenseInitialized,
  createTrialLicense,
};

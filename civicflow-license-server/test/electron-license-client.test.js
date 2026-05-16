const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function loadElectronLicenseService({ isPackaged = false } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "civicflow-main-license-"));
  const targetPath = require.resolve("../../src/main/licenseService.js");
  delete require.cache[targetPath];

  const fakeElectron = {
    app: {
      isPackaged,
      getPath() {
        return tempDir;
      },
      getAppPath() {
        return tempDir;
      },
    },
  };

  const fakeDevice = {
    getDeviceId() {
      return "device-test-123";
    },
    getDeviceName() {
      return "Device Test";
    },
  };

  const fakeLogger = {
    info() {},
    warn() {},
    error() {},
  };

  const fakeConfig = {
    resolveLicenseServerConfig({ overrideUrl = null, storedUrl = null } = {}) {
      const url = storedUrl || overrideUrl || "http://127.0.0.1:4000";
      return {
        ok: true,
        url,
        source: "test",
      };
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    if (parent && parent.filename === targetPath) {
      if (request === "./device") return fakeDevice;
      if (request === "./logger") return fakeLogger;
      if (request === "./licenseServerConfig") return fakeConfig;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const service = require(targetPath);
  Module._load = originalLoad;

  return {
    service,
    tempDir,
    cleanup() {
      delete require.cache[targetPath];
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("offline grace remains valid while the server-issued license is within the grace window", () => {
  const { service, cleanup } = loadElectronLicenseService();
  try {
    const status = service._private.mapLicenseToStatus({
      type: "paid",
      plan: "ESSENTIAL",
      validationMode: "server",
      status: "active",
      licenseKey: "CF-AAAA-BBBB-CCCC-DDDD",
      activationToken: "activation-token",
      lastValidatedAt: new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)).toISOString(),
      offlineGraceDays: 10,
      warnAfterDays: 3,
      deviceId: "device-test-123",
    });

    assert.equal(status.valid, true);
    assert.equal(status.status, "active");
    assert.equal(status.daysRemainingOffline, 5);
  } finally {
    cleanup();
  }
});

test("offline grace expires when the device has been offline too long", () => {
  const { service, cleanup } = loadElectronLicenseService();
  try {
    const status = service._private.mapLicenseToStatus({
      type: "paid",
      plan: "ESSENTIAL",
      validationMode: "server",
      status: "active",
      licenseKey: "CF-AAAA-BBBB-CCCC-DDDD",
      activationToken: "activation-token",
      lastValidatedAt: new Date(Date.now() - (15 * 24 * 60 * 60 * 1000)).toISOString(),
      offlineGraceDays: 10,
      warnAfterDays: 3,
      deviceId: "device-test-123",
    });

    assert.equal(status.valid, false);
    assert.equal(status.status, "inactive");
    assert.equal(status.reason, "offline_grace_expired");
  } finally {
    cleanup();
  }
});

test("migrateLocalLicense backfills lastValidatedAt and offlineGraceUntil for legacy paid licenses", () => {
  const { service, cleanup } = loadElectronLicenseService();
  try {
    const migrated = service._private.migrateLocalLicense({
      type: "paid",
      plan: "ESSENTIAL",
      validationMode: "server",
      status: "active",
      licenseKey: "CF-AAAA-BBBB-CCCC-DDDD",
      activationToken: "activation-token",
      activatedAt: new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)).toISOString(),
      offlineGraceDays: 10,
      deviceId: "device-test-123",
    });

    assert.ok(migrated.lastValidatedAt);
    assert.ok(migrated.offlineGraceUntil);
    assert.equal(migrated.deviceFingerprint, "device-test-123");
  } finally {
    cleanup();
  }
});

test("refresh keeps local access when the license server is unreachable", async () => {
  const { service, tempDir, cleanup } = loadElectronLicenseService();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("simulated network failure");
  };

  try {
    const licensePath = path.join(tempDir, "license.json");
    const activatedAt = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)).toISOString();
    fs.writeFileSync(licensePath, JSON.stringify({
      type: "paid",
      plan: "ESSENTIAL",
      validationMode: "server",
      status: "active",
      licenseKey: "CF-AAAA-BBBB-CCCC-DDDD",
      activationToken: "activation-token",
      activatedAt,
      lastValidatedAt: activatedAt,
      offlineGraceDays: 10,
      deviceId: "device-test-123",
      deviceFingerprint: "device-test-123",
      serverUrl: "http://127.0.0.1:4000",
    }, null, 2));

    const result = await service.refreshLicense();
    assert.equal(result.success, false);
    assert.equal(result.valid, true);
    assert.equal(result.keptLocalAccess, true);
    assert.ok(result.validationWarning);
    assert.equal(fs.existsSync(licensePath), true);
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

test("refresh marks license invalid only for permanent server failures", async () => {
  const { service, tempDir, cleanup } = loadElectronLicenseService();
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: false, valid: false, reason: "License revoked" }),
  });

  try {
    const licensePath = path.join(tempDir, "license.json");
    fs.writeFileSync(licensePath, JSON.stringify({
      type: "paid",
      plan: "ESSENTIAL",
      validationMode: "server",
      status: "active",
      licenseKey: "CF-AAAA-BBBB-CCCC-DDDD",
      activationToken: "activation-token",
      activatedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      offlineGraceDays: 10,
      deviceId: "device-test-123",
      deviceFingerprint: "device-test-123",
      serverUrl: "http://127.0.0.1:4000",
    }, null, 2));

    const result = await service.refreshLicense();
    assert.equal(result.success, false);
    assert.equal(result.valid, false);
    const saved = JSON.parse(fs.readFileSync(licensePath, "utf8"));
    assert.equal(saved.status, "revoked");
    assert.match(String(saved.invalidReason || ""), /revoked/i);
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

test("device fingerprint mismatch is surfaced without treating missing timestamps as expired grace", () => {
  const { service, cleanup } = loadElectronLicenseService();
  try {
    const status = service._private.mapLicenseToStatus({
      type: "paid",
      plan: "ESSENTIAL",
      validationMode: "server",
      status: "active",
      licenseKey: "CF-AAAA-BBBB-CCCC-DDDD",
      activationToken: "activation-token",
      activatedAt: new Date().toISOString(),
      offlineGraceDays: 10,
      deviceId: "stored-device",
      deviceFingerprint: "stored-device",
    });

    assert.equal(status.valid, false);
    assert.equal(status.reason, "device_fingerprint_mismatch");
  } finally {
    cleanup();
  }
});

test("deactivate keeps the local license and queues a retry when server release fails", async () => {
  const { service, tempDir, cleanup } = loadElectronLicenseService();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("simulated network failure");
  };

  try {
    const licensePath = path.join(tempDir, "license.json");
    fs.writeFileSync(licensePath, JSON.stringify({
      type: "paid",
      validationMode: "server",
      status: "active",
      licenseKey: "CF-AAAA-BBBB-CCCC-DDDD",
      activationToken: "activation-token",
      deviceId: "device-test-123",
      serverUrl: "http://127.0.0.1:4000",
    }, null, 2));

    const result = await service.deactivateLicense();
    assert.equal(result.success, false);
    assert.equal(result.queued, true);
    assert.equal(fs.existsSync(licensePath), true);

    const queue = service._private.loadPendingDeactivations();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].licenseKey, "CF-AAAA-BBBB-CCCC-DDDD");
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const os = require("os");
const http = require("http");
const fs = require("fs");
const logger = require("./main/logger");
const { getDatabase, initializeDatabase } = require("./main/db");

let mainWindowRef = null;
let pendingDeepLinkHash = null;

function parseDeepLinkToHash(urlString) {
  try {
    if (!urlString || !String(urlString).startsWith("civicflow://")) return null;
    const parsed = new URL(String(urlString));
    const route = String(parsed.hostname || parsed.pathname || "")
      .replace(/^\/+/, "")
      .trim();
    if (!route) return "#/dashboard";
    const query = parsed.search || "";
    return `#/${route}${query}`;
  } catch {
    return null;
  }
}

function extractDeepLinkFromArgv(argv = []) {
  const arr = Array.isArray(argv) ? argv : [];
  return arr.find((arg) => typeof arg === "string" && arg.startsWith("civicflow://")) || null;
}

function applyHashToWindow(hash) {
  const target = String(hash || "").trim();
  if (!target) return;
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) {
    pendingDeepLinkHash = target;
    return;
  }

  const run = () => win.webContents
    .executeJavaScript(`window.location.hash = ${JSON.stringify(target)};`, true)
    .catch(() => {});

  if (win.webContents.isLoading()) {
    pendingDeepLinkHash = target;
    win.webContents.once("did-finish-load", () => {
      if (pendingDeepLinkHash) {
        const queued = pendingDeepLinkHash;
        pendingDeepLinkHash = null;
        run(queued);
      }
    });
    return;
  }

  run();
}

function handleIncomingDeepLink(urlString) {
  const hash = parseDeepLinkToHash(urlString);
  if (!hash) return;
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    if (mainWindowRef.isMinimized()) mainWindowRef.restore();
    mainWindowRef.focus();
  }
  applyHashToWindow(hash);
}

// =====================================================
// FORCE WRITABLE PROFILE (fix cache + crypto errors)
// =====================================================
const tempUserData = path.join(os.tmpdir(), "CivicFlowDevProfile");
if (!app.isPackaged) {
  app.setPath("userData", tempUserData);
  app.setPath("cache", path.join(tempUserData, "Cache"));
}
app.disableHardwareAcceleration();

// =====================================================
// GLOBAL ERROR HANDLING
// =====================================================
process.on("uncaughtException", (err) => {
  console.error("MAIN PROCESS CRASH:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED PROMISE:", err);
});

// =====================================================
// IPC BOOTSTRAP
// =====================================================
let registerAllIpc = () => {};
try {
  ({ registerAllIpc } = require("./main/ipc-bootstrap"));
  console.log("✅ IPC bootstrap loaded");
} catch (e) {
  console.warn("⚠️ IPC bootstrap failed:", e.message);
  logger.error("ipc-bootstrap-failed", e?.message || e);
}

function ensureCriticalIpcHandlers() {
  const hasInvokeHandler = (channel) => ipcMain._invokeHandlers?.has(channel);
  const database = getDatabase() || initializeDatabase();

  const forceRegister = (channel, handler) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
    logger.warn("ipc-fallback-registered", { channel, mode: "force" });
  };

  if (!hasInvokeHandler("license:getStatus")) {
    ipcMain.removeHandler("license:getStatus");
    ipcMain.handle("license:getStatus", async () => {
      return licenseService.getLicenseStatus();
    });
    logger.warn("ipc-fallback-registered", { channel: "license:getStatus" });
  }

  if (!hasInvokeHandler("license:refresh")) {
    ipcMain.removeHandler("license:refresh");
    ipcMain.handle("license:refresh", async () => {
      return licenseService.refreshLicense();
    });
    logger.warn("ipc-fallback-registered", { channel: "license:refresh" });
  }

  if (!hasInvokeHandler("license:activate")) {
    ipcMain.removeHandler("license:activate");
    ipcMain.handle("license:activate", async (_event, payload) => {
      return licenseService.activateLicense(payload);
    });
    logger.warn("ipc-fallback-registered", { channel: "license:activate" });
  }

  if (!hasInvokeHandler("license:can-activate")) {
    ipcMain.removeHandler("license:can-activate");
    ipcMain.handle("license:can-activate", async () => ({ allowed: true }));
    logger.warn("ipc-fallback-registered", { channel: "license:can-activate" });
  }

  forceRegister("organization:getSetupStatus", async () => {
    const row = database.prepare("SELECT setup_completed FROM organization_settings WHERE id = 1").get();
    const completed = Number(row?.setup_completed ?? 0) === 1;
    return { completed, setupCompleted: completed };
  });

  forceRegister("organization:get", async () => {
    const row = database.prepare("SELECT * FROM organization WHERE id = 1").get();
    return row || { id: 1, name: "Civicflow" };
  });

  forceRegister("organization:set", async (_event, data = {}) => {
    database
      .prepare(`
        INSERT INTO organization (
          id,
          name,
          logo_path,
          email_display_name,
          email_from_address,
          payments_enabled,
          stripe_account_id,
          cashapp_handle,
          zelle_contact,
          venmo_handle,
          auto_archive_enabled,
          auto_archive_events_days,
          auto_archive_campaigns_days,
          updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name = COALESCE(excluded.name, organization.name),
          logo_path = COALESCE(excluded.logo_path, organization.logo_path),
          email_display_name = COALESCE(excluded.email_display_name, organization.email_display_name),
          email_from_address = COALESCE(excluded.email_from_address, organization.email_from_address),
          payments_enabled = COALESCE(excluded.payments_enabled, organization.payments_enabled),
          stripe_account_id = COALESCE(excluded.stripe_account_id, organization.stripe_account_id),
          cashapp_handle = COALESCE(excluded.cashapp_handle, organization.cashapp_handle),
          zelle_contact = COALESCE(excluded.zelle_contact, organization.zelle_contact),
          venmo_handle = COALESCE(excluded.venmo_handle, organization.venmo_handle),
            auto_archive_enabled = COALESCE(excluded.auto_archive_enabled, organization.auto_archive_enabled),
            auto_archive_events_days = COALESCE(excluded.auto_archive_events_days, organization.auto_archive_events_days),
            auto_archive_campaigns_days = COALESCE(excluded.auto_archive_campaigns_days, organization.auto_archive_campaigns_days),
          updated_at = datetime('now')
      `)
      .run(
        data.name ?? null,
        data.logo_path ?? null,
        data.email_display_name ?? null,
        data.email_from_address ?? null,
        data.payments_enabled == null ? null : (data.payments_enabled ? 1 : 0),
        data.stripe_account_id ?? null,
        data.cashapp_handle ?? null,
        data.zelle_contact ?? null,
        data.venmo_handle ?? null,
        data.auto_archive_enabled == null ? null : (data.auto_archive_enabled ? 1 : 0),
        data.auto_archive_events_days == null ? null : Math.max(0, Number(data.auto_archive_events_days) || 0),
        data.auto_archive_campaigns_days == null ? null : Math.max(0, Number(data.auto_archive_campaigns_days) || 0),
      );
    return { success: true };
  });

  forceRegister("organization:getSettings", async () => {
    return database.prepare("SELECT * FROM organization_settings WHERE id = 1").get() || {};
  });

  forceRegister("organization:updateSettings", async (_event, data = {}) => {
    database
      .prepare("INSERT INTO organization_settings (id, organization_name, email_from_name, email_from_address, setup_completed, updated_at) VALUES (1, ?, ?, ?, COALESCE(?, 0), datetime('now')) ON CONFLICT(id) DO UPDATE SET organization_name = COALESCE(excluded.organization_name, organization_settings.organization_name), email_from_name = COALESCE(excluded.email_from_name, organization_settings.email_from_name), email_from_address = COALESCE(excluded.email_from_address, organization_settings.email_from_address), setup_completed = COALESCE(excluded.setup_completed, organization_settings.setup_completed), updated_at = datetime('now')")
      .run(data.organization_name ?? null, data.email_from_name ?? null, data.email_from_address ?? null, data.setup_completed ?? null);
    return { success: true };
  });

  forceRegister("organization:completeSetup", async () => {
    database.prepare("UPDATE organization_settings SET setup_completed = 1, updated_at = datetime('now') WHERE id = 1").run();
    return { success: true };
  });

  if (!hasInvokeHandler("organization:upload-logo")) {
    ipcMain.removeHandler("organization:upload-logo");
    ipcMain.handle("organization:upload-logo", async (_event, base64OrPath) => {
      if (!base64OrPath) return { success: false, error: "No logo payload provided" };
      const userData = app.getPath("userData");
      const orgDir = path.join(userData, "logos");
      fs.mkdirSync(orgDir, { recursive: true });
      let logoPath = base64OrPath;
      if (typeof base64OrPath === "string" && base64OrPath.startsWith("data:image/")) {
        const data = base64OrPath.split(",")[1] || "";
        const file = path.join(orgDir, `logo-${Date.now()}.png`);
        fs.writeFileSync(file, Buffer.from(data, "base64"));
        logoPath = file;
      }
      database.prepare("UPDATE organization SET logo_path = ?, updated_at = datetime('now') WHERE id = 1").run(logoPath);
      return { success: true, logo_path: logoPath, logoPath };
    });
    logger.warn("ipc-fallback-registered", { channel: "organization:upload-logo" });
  }

  if (!hasInvokeHandler("db:categories:list")) {
    ipcMain.removeHandler("db:categories:list");
    ipcMain.handle("db:categories:list", async () => database.prepare("SELECT * FROM categories ORDER BY name").all());
    logger.warn("ipc-fallback-registered", { channel: "db:categories:list" });
  }

  if (!hasInvokeHandler("db:categories:create")) {
    ipcMain.removeHandler("db:categories:create");
    ipcMain.handle("db:categories:create", async (_event, data) => {
      const name = typeof data === "string" ? data : data?.name ?? "";
      const dues = typeof data === "object" && data ? Number(data.monthly_dues_cents ?? 0) : 0;
      const result = database.prepare("INSERT OR IGNORE INTO categories (name, monthly_dues_cents) VALUES (?, ?)").run(name, dues);
      if (!result.lastInsertRowid) {
        return database.prepare("SELECT id FROM categories WHERE name = ?").get(name)?.id ?? null;
      }
      return result.lastInsertRowid;
    });
    logger.warn("ipc-fallback-registered", { channel: "db:categories:create" });
  }

  if (!hasInvokeHandler("db:categories:update")) {
    ipcMain.removeHandler("db:categories:update");
    ipcMain.handle("db:categories:update", async (_event, id, updates = {}) => {
      database.prepare("UPDATE categories SET name = COALESCE(?, name), monthly_dues_cents = COALESCE(?, monthly_dues_cents), updated_at = datetime('now') WHERE id = ?").run(updates.name ?? null, updates.monthly_dues_cents ?? null, id);
      return true;
    });
    logger.warn("ipc-fallback-registered", { channel: "db:categories:update" });
  }

  if (!hasInvokeHandler("set-cbo-branding")) {
    ipcMain.removeHandler("set-cbo-branding");
    ipcMain.handle("set-cbo-branding", async () => ({ success: true }));
    logger.warn("ipc-fallback-registered", { channel: "set-cbo-branding" });
  }

  if (!hasInvokeHandler("get-cbo-branding")) {
    ipcMain.removeHandler("get-cbo-branding");
    ipcMain.handle("get-cbo-branding", async () => ({ cboName: "Civicflow", logoPath: null }));
    logger.warn("ipc-fallback-registered", { channel: "get-cbo-branding" });
  }

  if (!hasInvokeHandler("get-dashboard-stats")) {
    ipcMain.removeHandler("get-dashboard-stats");
    ipcMain.handle("get-dashboard-stats", async () => ({
      totalMembers: 0,
      currentMembers: 0,
      pastDueMembers: 0,
      delinquentMembers: 0,
      totalDuesOutstandingCents: 0,
      duesCollectedLast30DaysCents: 0,
      expenseLast30DaysCents: 0,
      totalTransactionsCents: 0,
      upcomingEventsCount: 0,
      campaignProgress: [],
      totalCampaignContributionsCents: 0,
      totalEventContributionsCents: 0,
      totalDuesCents: 0,
      totalDonationsCents: 0,
      totalCampaignRevenueCents: 0,
      totalEventRevenueCents: 0,
      totalExpendituresCurrentMonth: 0,
      totalExpendituresYTD: 0,
      totalMemberPayouts: 0,
      totalOperationalExpenses: 0,
      paymentMethodBreakdown: [],
    }));
    logger.warn("ipc-fallback-registered", { channel: "get-dashboard-stats" });
  }

  if (!hasInvokeHandler("payments:listPendingExternal")) {
    ipcMain.removeHandler("payments:listPendingExternal");
    ipcMain.handle("payments:listPendingExternal", async () => []);
    logger.warn("ipc-fallback-registered", { channel: "payments:listPendingExternal" });
  }

  if (!hasInvokeHandler("payments:approveExternal")) {
    ipcMain.removeHandler("payments:approveExternal");
    ipcMain.handle("payments:approveExternal", async () => ({ success: false, error: "Pending external payment handler not initialized." }));
    logger.warn("ipc-fallback-registered", { channel: "payments:approveExternal" });
  }

  if (!hasInvokeHandler("payments:rejectExternal")) {
    ipcMain.removeHandler("payments:rejectExternal");
    ipcMain.handle("payments:rejectExternal", async () => ({ success: false, error: "Pending external payment handler not initialized." }));
    logger.warn("ipc-fallback-registered", { channel: "payments:rejectExternal" });
  }
}

// =====================================================
// LICENSE SERVICE
// =====================================================
let licenseService;

try {
  const licensePath = path.join(__dirname, "main", "licenseService.js");
  licenseService = require(licensePath);
  console.log("✅ License service loaded from:", licensePath);
} catch (err) {
  console.warn("⚠️ License service failed to load:", err.message);

  licenseService = {
    validateLicense: () => true,
    getLicenseStatus: () => ({
      valid: true,
      type: "developer",
      expires: null
    })
  };
}

// =====================================================
// ENV
// =====================================================
const isDev = !app.isPackaged;

function canConnect(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4096) {
          req.destroy();
        }
      });
      res.on("end", () => {
        const ok = res.statusCode >= 200
          && res.statusCode < 400
          && body.includes("<div id=\"root\"></div>")
          && body.toLowerCase().includes("civicflow");
        resolve(ok);
      });
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolveDevServerUrl() {
  const explicit = process.env.CIVICFLOW_DEV_SERVER_URL || process.env.VITE_DEV_SERVER_URL;
  if (explicit) {
    return explicit;
  }

  const hosts = ["localhost", "127.0.0.1"];
  const ports = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];

  for (const host of hosts) {
    for (const port of ports) {
      const candidate = `http://${host}:${port}/`;
      if (await canConnect(candidate)) {
        return candidate;
      }
    }
  }

  return "http://localhost:5173/";
}

// =====================================================
// WINDOW CREATION
// =====================================================
async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: {
      preload: require("path").resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const forceDevTools = String(process.env.CIVICFLOW_OPEN_DEVTOOLS || "").trim() === "1";
  if (isDev || forceDevTools) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindowRef = mainWindow;
  mainWindow.on("closed", () => {
    if (mainWindowRef === mainWindow) mainWindowRef = null;
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("❌ LOAD FAILED", code, desc, url);
    logger.error("did-fail-load", { code, desc, url });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("✅ WINDOW LOADED", mainWindow.webContents.getURL());
    logger.info("did-finish-load", mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on("console-message", (_event, level, message) => {
    console.log("RENDERER:", message);
    logger.warn("renderer-console", { level, message });
  });

  const webRequestFilter = { urls: ['http://*/*', 'https://*/*'] }
  mainWindow.webContents.session.webRequest.onErrorOccurred(webRequestFilter, (details) => {
    if (details.resourceType === "stylesheet" || details.resourceType === "script" || details.resourceType === "image") {
      logger.error("resource-load-failed", {
        resourceType: details.resourceType,
        error: details.error,
        url: details.url,
        method: details.method,
      });
    }
  });

  if (isDev) {
    const devUrl = await resolveDevServerUrl();
    logger.info("dev-server-url", devUrl);
    await mainWindow.loadURL(devUrl);
  } else {
    const indexPath = path.join(app.getAppPath(), "dist", "index.html");
    await mainWindow.loadFile(indexPath);
  }

  if (pendingDeepLinkHash) {
    const queued = pendingDeepLinkHash;
    pendingDeepLinkHash = null;
    applyHashToWindow(queued);
  }
}

// =====================================================
// APP LIFECYCLE
// =====================================================
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  const deepLink = extractDeepLinkFromArgv(argv);
  if (deepLink) handleIncomingDeepLink(deepLink);
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    if (mainWindowRef.isMinimized()) mainWindowRef.restore();
    mainWindowRef.focus();
  }
});

app.on("open-url", (event, urlString) => {
  event.preventDefault();
  handleIncomingDeepLink(urlString);
});

app.whenReady().then(() => {
  try {
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient("civicflow", process.execPath, [path.resolve(process.argv[1] || "")]);
    } else {
      app.setAsDefaultProtocolClient("civicflow");
    }
  } catch {
  }

  const startupDeepLink = extractDeepLinkFromArgv(process.argv);
  if (startupDeepLink) {
    const hash = parseDeepLinkToHash(startupDeepLink);
    if (hash) pendingDeepLinkHash = hash;
  }

  try {
    registerAllIpc();
  } catch (err) {
    logger.error("registerAllIpc-failed", err?.message || err);
  }

  ensureCriticalIpcHandlers();

  try {
    if (typeof licenseService?.ensureLicenseInitialized === "function") {
      licenseService.ensureLicenseInitialized();
    }
  } catch (err) {
    console.warn("⚠️ Failed to initialize license state:", err?.message || err);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// =====================================================
// EXPORT
// =====================================================
module.exports = { createWindow };

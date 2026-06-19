const { dialog, shell, app } = require("electron");
const logger = require("./logger");

const RELEASES_URL = "https://github.com/abramph/CivicFlow-platform/releases/latest";

function initAutoUpdater(mainWindow) {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    logger.warn("auto-updater-module-missing", { message: err?.message });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("update-available", (info) => {
    logger.info("update-available", { version: info.version });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Available",
      message: `CivicFlow ${info.version} is available`,
      detail: `You're running ${app.getVersion()}. Download and install the update now?`,
      buttons: ["Download & Install", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate();
    });
  });

  autoUpdater.on("update-downloaded", () => {
    logger.info("update-downloaded");
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Restart to Update",
      message: "CivicFlow update downloaded",
      detail: "Restart now to install the update, or it will be applied next time you launch.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on("update-not-available", () => {
    logger.info("update-not-available", { current: app.getVersion() });
  });

  autoUpdater.on("error", (err) => {
    logger.warn("auto-updater-error", { message: err?.message });
    // On macOS without code signing, fall back to a manual download prompt
    if (process.platform === "darwin" && mainWindow && !mainWindow.isDestroyed()) {
      checkGitHubReleaseManually(mainWindow);
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.warn("auto-updater-check-failed", { message: err?.message });
    });
  }, 8000);
}

async function checkGitHubReleaseManually(mainWindow) {
  try {
    const https = require("https");
    const currentVersion = app.getVersion();

    const latestVersion = await new Promise((resolve, reject) => {
      const req = https.get(
        "https://api.github.com/repos/abramph/CivicFlow-platform/releases/latest",
        { headers: { "User-Agent": "CivicFlow-updater" } },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            try {
              const tag = JSON.parse(data)?.tag_name || "";
              resolve(tag.replace(/^v/, ""));
            } catch {
              reject(new Error("parse-failed"));
            }
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error("timeout")); });
    });

    if (!latestVersion || latestVersion === currentVersion) return;

    const [curMaj, curMin, curPatch] = currentVersion.split(".").map(Number);
    const [latMaj, latMin, latPatch] = latestVersion.split(".").map(Number);
    const isNewer = latMaj > curMaj
      || (latMaj === curMaj && latMin > curMin)
      || (latMaj === curMaj && latMin === curMin && latPatch > curPatch);

    if (!isNewer) return;

    logger.info("update-available-manual-check", { latestVersion });
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Available",
      message: `CivicFlow ${latestVersion} is available`,
      detail: `You're running ${currentVersion}. Visit the download page to get the latest version.`,
      buttons: ["Download Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(RELEASES_URL);
  } catch (err) {
    logger.warn("manual-update-check-failed", { message: err?.message });
  }
}

module.exports = { initAutoUpdater };

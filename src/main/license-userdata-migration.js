const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");
const { APP_ID, APP_PRODUCT_NAME, LEGACY_USER_DATA_FOLDER_NAMES } = require("../shared/appConfig");

const LICENSE_FILE_NAME = "license.json";

function getAppDataRoots() {
  if (process.platform === "win32") {
    return [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return [path.join(os.homedir(), "Library", "Application Support")];
  }
  return [
    process.env.XDG_CONFIG_HOME,
    path.join(os.homedir(), ".config"),
  ].filter(Boolean);
}

function buildLegacyUserDataDirs(extraFolderNames = []) {
  const roots = getAppDataRoots();
  const folderNames = [...new Set([
    ...LEGACY_USER_DATA_FOLDER_NAMES,
    ...extraFolderNames,
  ])];
  const dirs = [];

  for (const folderName of folderNames) {
    const normalized = String(folderName || "").trim();
    if (!normalized) continue;
    if (path.isAbsolute(normalized)) {
      dirs.push(normalized);
      continue;
    }
    for (const root of roots) {
      dirs.push(path.join(root, normalized));
    }
  }

  return [...new Set(dirs.map((entry) => path.resolve(entry)))];
}

function isReadableLicenseFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

function scoreLegacyLicense(parsed, stat) {
  let score = 0;
  if (parsed?.type === "paid") score += 100;
  if (parsed?.activationToken) score += 20;
  if (parsed?.licenseKey) score += 10;
  if (parsed?.type === "trial") score += 5;
  if (stat?.mtimeMs) score += stat.mtimeMs / 1_000_000_000_000;
  return score;
}

function findLegacyLicenseCandidates(currentUserDataPath, extraFolderNames = []) {
  const currentUserData = path.resolve(String(currentUserDataPath || ""));
  const candidates = [];

  for (const legacyUserDataDir of buildLegacyUserDataDirs(extraFolderNames)) {
    if (legacyUserDataDir === currentUserData) continue;

    const licensePath = path.join(legacyUserDataDir, LICENSE_FILE_NAME);
    if (!isReadableLicenseFile(licensePath)) continue;

    let stat = null;
    let parsed = null;
    try {
      stat = fs.statSync(licensePath);
      parsed = JSON.parse(fs.readFileSync(licensePath, "utf8"));
    } catch {
      continue;
    }

    candidates.push({
      legacyUserDataDir,
      licensePath,
      stat,
      parsed,
      score: scoreLegacyLicense(parsed, stat),
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function copyFilePreserveTimestamps(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  const stat = fs.statSync(sourcePath);
  fs.utimesSync(destinationPath, stat.atime, stat.mtime);
  return {
    atime: stat.atime.toISOString(),
    mtime: stat.mtime.toISOString(),
  };
}

function migrateLegacyLicenseIfNeeded({
  currentUserDataPath = app.getPath("userData"),
  currentLicensePath = path.join(currentUserDataPath, LICENSE_FILE_NAME),
  extraFolderNames = [],
  log = () => {},
} = {}) {
  const resolvedCurrentLicense = path.resolve(currentLicensePath);
  const resolvedCurrentUserData = path.resolve(currentUserDataPath);

  if (isReadableLicenseFile(resolvedCurrentLicense)) {
    return {
      migrated: false,
      reason: "current-license-exists",
      currentLicensePath: resolvedCurrentLicense,
      currentUserDataPath: resolvedCurrentUserData,
    };
  }

  const candidates = findLegacyLicenseCandidates(resolvedCurrentUserData, extraFolderNames);
  if (candidates.length === 0) {
    return {
      migrated: false,
      reason: "no-legacy-license-found",
      currentLicensePath: resolvedCurrentLicense,
      currentUserDataPath: resolvedCurrentUserData,
      scannedDirectories: buildLegacyUserDataDirs(extraFolderNames),
    };
  }

  const selected = candidates[0];
  const timestamps = copyFilePreserveTimestamps(selected.licensePath, resolvedCurrentLicense);

  const result = {
    migrated: true,
    reason: "legacy-license-copied",
    sourceUserDataPath: selected.legacyUserDataDir,
    sourceLicensePath: selected.licensePath,
    destinationLicensePath: resolvedCurrentLicense,
    currentUserDataPath: resolvedCurrentUserData,
    preservedTimestamps: timestamps,
    licenseType: selected.parsed?.type || null,
    alternateCandidates: candidates.slice(1).map((entry) => ({
      legacyUserDataDir: entry.legacyUserDataDir,
      licensePath: entry.licensePath,
      score: entry.score,
    })),
  };

  log("license-userdata-migrated", result);
  return result;
}

function logAppIdentity(log = () => {}) {
  const payload = {
    appName: app.getName(),
    productName: APP_PRODUCT_NAME,
    userDataPath: app.getPath("userData"),
    appId: APP_ID,
    executablePath: process.execPath,
    isPackaged: app.isPackaged,
    platform: process.platform,
  };

  log("app-identity", payload);
  return payload;
}

module.exports = {
  LICENSE_FILE_NAME,
  buildLegacyUserDataDirs,
  copyFilePreserveTimestamps,
  findLegacyLicenseCandidates,
  getAppDataRoots,
  logAppIdentity,
  migrateLegacyLicenseIfNeeded,
};

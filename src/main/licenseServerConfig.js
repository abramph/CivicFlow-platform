const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const dotenv = require("dotenv");

const DEV_DEFAULT_SERVER_URL = "http://localhost:4000";
const PROD_DEFAULT_SERVER_URL = "https://api.civicflowapp.com";
const CONFIG_FILE_NAME = "license-server.json";

let envLoaded = false;

function configFilePath() {
  return path.join(app.getPath("userData"), CONFIG_FILE_NAME);
}

function loadRuntimeEnv() {
  if (envLoaded) return;
  envLoaded = true;

  const envFileNames = app.isPackaged
    ? [".env.production", ".env.local", ".env"]
    : [".env.local", ".env.production", ".env"];
  const candidateRoots = [
    process.cwd(),
    path.dirname(process.execPath || ""),
    app.getPath("userData"),
  ];

  try {
    const appPath = app.getAppPath?.();
    if (appPath) {
      candidateRoots.splice(1, 0, appPath);
    }
  } catch {
    // noop
  }

  const seen = new Set();
  const candidates = [];
  for (const root of candidateRoots) {
    const normalizedRoot = String(root || "").trim();
    if (!normalizedRoot) continue;
    for (const fileName of envFileNames) {
      const candidate = path.join(normalizedRoot, fileName);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        dotenv.config({ path: candidate, override: false });
        break;
      }
    } catch {
      // noop
    }
  }
}

function normalizeServerUrl(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    const normalizedPath = parsed.pathname && parsed.pathname !== "/"
      ? parsed.pathname.replace(/\/+$/, "")
      : "";

    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return null;
  }
}

function loadPersistedConfig() {
  try {
    const filePath = configFilePath();
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildCandidateList({ overrideUrl = null, storedUrl = null } = {}) {
  loadRuntimeEnv();

  const persisted = loadPersistedConfig();
  const shared = [
    { source: "override", value: overrideUrl },
    { source: "config-file", value: persisted?.serverUrl },
    { source: "env:CIVICFLOW_LICENSE_SERVER_URL", value: process.env.CIVICFLOW_LICENSE_SERVER_URL },
    { source: "env:VITE_LICENSE_SERVER_URL", value: process.env.VITE_LICENSE_SERVER_URL },
    { source: "env:LICENSE_SERVER_URL", value: process.env.LICENSE_SERVER_URL },
    { source: "env:ACTIVATION_SERVER_URL", value: process.env.ACTIVATION_SERVER_URL },
    { source: "env:ACTIVATION_API_URL", value: process.env.ACTIVATION_API_URL },
  ];

  if (app.isPackaged) {
    return [
      ...shared,
      { source: "license-cache", value: storedUrl },
      { source: "production-default", value: PROD_DEFAULT_SERVER_URL },
    ];
  }

  return [
    ...shared,
    { source: "license-cache", value: storedUrl },
    { source: "development-default", value: DEV_DEFAULT_SERVER_URL },
  ];
}

function resolveLicenseServerConfig({ overrideUrl = null, storedUrl = null } = {}) {
  const candidates = buildCandidateList({ overrideUrl, storedUrl });
  let invalidSource = null;
  let invalidValue = null;

  for (const candidate of candidates) {
    const raw = String(candidate?.value || "").trim();
    if (!raw) continue;
    const normalized = normalizeServerUrl(raw);
    if (normalized) {
      return {
        ok: true,
        url: normalized,
        source: candidate.source,
        isPackaged: app.isPackaged,
        configFilePath: configFilePath(),
        productionDefault: PROD_DEFAULT_SERVER_URL,
        developmentDefault: DEV_DEFAULT_SERVER_URL,
      };
    }

    if (!invalidSource) {
      invalidSource = candidate.source;
      invalidValue = raw;
    }
  }

  const error = invalidSource
    ? `Activation server URL in ${invalidSource} is invalid: ${invalidValue}`
    : (
      app.isPackaged
        ? "Activation server URL is not configured for this packaged app."
        : "Activation server URL is not configured. Start the local license server or set CIVICFLOW_LICENSE_SERVER_URL."
    );

  return {
    ok: false,
    url: null,
    source: invalidSource ? `${invalidSource}:invalid` : "missing",
    error,
    isPackaged: app.isPackaged,
    configFilePath: configFilePath(),
    productionDefault: PROD_DEFAULT_SERVER_URL,
    developmentDefault: DEV_DEFAULT_SERVER_URL,
  };
}

function getLicenseServerConfigDiagnostics({ overrideUrl = null, storedUrl = null } = {}) {
  const resolved = resolveLicenseServerConfig({ overrideUrl, storedUrl });
  return {
    ...resolved,
    configFileExists: fs.existsSync(configFilePath()),
  };
}

module.exports = {
  DEV_DEFAULT_SERVER_URL,
  PROD_DEFAULT_SERVER_URL,
  configFilePath,
  getLicenseServerConfigDiagnostics,
  normalizeServerUrl,
  resolveLicenseServerConfig,
};

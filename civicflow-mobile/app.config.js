// Unified Expo app config.
//
// This file replaces static-only app.json evaluation. It composes from app.json
// and resolves a build-time identity:
//
//   • production (the default)      — the real Unestra app
//   • preview    (APP_VARIANT=preview) — an internal build that installs ALONGSIDE
//                                        production under a ".preview" identity
//
// Why it exists: Android push (FCM) needs a google-services.json baked into the
// build via android.googleServicesFile. We deliver that file through the EAS
// file-type environment variable GOOGLE_SERVICES_JSON (production environment,
// Secret visibility) instead of committing it. This config wires that path in and
// FAILS CLOSED for a production build so a misconfigured build can never ship
// broken FCM or point at the wrong API.
//
// iOS is APNs-only and never receives a google-services file.
//
// SECURITY: process.env.GOOGLE_SERVICES_JSON is treated ONLY as a filesystem path.
// Its contents are never opened, parsed, printed, snapshotted, or committed here.

const base = require("./app.json");

// The canonical production API host. A production build must talk to exactly this.
const PRODUCTION_API_HOST = "app.getunestra.com";

// Hosts a preview build must never talk to (production + legacy production).
const PRODUCTION_HOSTS = [
  "app.getunestra.com",
  "app.civicflowapp.com",
  "civicflow-portal-iule6.ondigitalocean.app",
  "api.civicflowapp.com",
];

// Greppable prefix for every diagnostic emitted by this file.
const TAG = "[app.config]";

function hostOf(url) {
  try {
    return url ? new URL(url).host.toLowerCase() : null;
  } catch {
    return null;
  }
}

function isProductionHost(host) {
  return (
    !!host && PRODUCTION_HOSTS.some((p) => host === p || host.endsWith(`.${p}`))
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Pure resolver: takes an environment bag and returns the Expo config object,
 * or throws (fail-closed) when a production build is misconfigured.
 *
 * Exported so tests can drive it with dummy env values. Tests must only ever use
 * dummy file PATHS — never the real EAS Secret file.
 */
function resolveConfig(env) {
  const isPreview = env.APP_VARIANT === "preview";
  const isProductionBuild = env.EAS_BUILD_PROFILE === "production";
  const apiBase = env.EXPO_PUBLIC_API_BASE_URL;
  const apiHost = hostOf(apiBase);

  // A production build must never resolve a preview identity/package. Guard before
  // any identity resolution so this can't slip through the preview branch's early
  // return.
  if (isProductionBuild && isPreview) {
    throw new Error(
      `${TAG} production: a preview identity/package was resolved — refusing to build.`
    );
  }

  // Shallow copy so repeated calls never mutate the required('./app.json') cache.
  const expo = { ...base.expo };

  if (isPreview) {
    // ---- Preview identity: installs ALONGSIDE production ----
    // A preview build must target a real, non-production HTTPS API.
    if (!isNonEmptyString(apiBase)) {
      throw new Error(
        `${TAG} preview: EXPO_PUBLIC_API_BASE_URL is required for a preview build.`
      );
    }
    if (!apiHost) {
      throw new Error(
        `${TAG} preview: EXPO_PUBLIC_API_BASE_URL is not a valid URL.`
      );
    }
    if (!apiBase.startsWith("https://")) {
      throw new Error(`${TAG} preview: API base must be HTTPS.`);
    }
    if (isProductionHost(apiHost)) {
      throw new Error(
        `${TAG} preview: refusing to build against a PRODUCTION host (${apiHost}). ` +
          `An internal preview must never target production.`
      );
    }

    expo.name = `${base.expo.name} Preview`;
    // Separate identifiers so a preview installs beside production, not over it.
    expo.ios = {
      ...(expo.ios ?? {}),
      bundleIdentifier: `${base.expo.ios.bundleIdentifier}.preview`,
    };
    // Drop the PRODUCTION universal-link / app-link claims so a preview never
    // intercepts production links (and iOS associated-domain validation passes).
    delete expo.ios.associatedDomains;
    expo.android = {
      ...(expo.android ?? {}),
      package: `${base.expo.android.package}.preview`,
    };
    delete expo.android.intentFilters;

    // Preview must NEVER consume the production Firebase file.
    delete expo.android.googleServicesFile;
    // Android push in preview stays disabled unless a SEPARATELY scoped preview
    // Firebase file is provided later via its own variable (never the prod one).
    const previewGoogleServices = env.GOOGLE_SERVICES_JSON_PREVIEW;
    if (isNonEmptyString(previewGoogleServices)) {
      expo.android.googleServicesFile = previewGoogleServices;
    }

    return { ...base, expo };
  }

  // ---- Production identity (the default) ----
  // iOS stays APNs-only: no googleServicesFile is ever set on iOS.
  // Android points at the EAS file variable — a PATH; contents are never read here.
  const googleServicesFile = env.GOOGLE_SERVICES_JSON;
  if (isNonEmptyString(googleServicesFile)) {
    expo.android = {
      ...(expo.android ?? {}),
      googleServicesFile,
    };
  }
  // When the variable is absent (local development), googleServicesFile is simply
  // left unset so `expo start` / exports work without any Firebase credential.

  // Fail closed for a real production build so a misconfigured build never ships.
  if (isProductionBuild) {
    // Defensive: never emit a preview identity from a production build. (The
    // APP_VARIANT=preview case is already rejected above; this catches any other
    // path that could yield a ".preview" identifier.)
    if (
      String(expo.ios?.bundleIdentifier).endsWith(".preview") ||
      String(expo.android?.package).endsWith(".preview")
    ) {
      throw new Error(
        `${TAG} production: a preview identity/package was resolved — refusing to build.`
      );
    }
    if (!isNonEmptyString(googleServicesFile)) {
      throw new Error(
        `${TAG} production: GOOGLE_SERVICES_JSON is missing or blank — refusing to ` +
          `build an Android app with no FCM configuration. Set the production, ` +
          `Secret, file-type EAS variable GOOGLE_SERVICES_JSON.`
      );
    }
    if (!isNonEmptyString(apiBase)) {
      throw new Error(
        `${TAG} production: EXPO_PUBLIC_API_BASE_URL is required.`
      );
    }
    if (!apiBase.startsWith("https://")) {
      throw new Error(`${TAG} production: API base must be HTTPS.`);
    }
    if (apiHost !== PRODUCTION_API_HOST) {
      throw new Error(
        `${TAG} production: EXPO_PUBLIC_API_BASE_URL must resolve to ` +
          `${PRODUCTION_API_HOST} (got ${apiHost ?? "none"}).`
      );
    }
    if (!isNonEmptyString(expo.android?.googleServicesFile)) {
      throw new Error(
        `${TAG} production: android.googleServicesFile was not set.`
      );
    }
    // Positive diagnostic — stderr only, so it never corrupts `expo config --json`
    // stdout. Path/contents are intentionally NOT printed.
    console.warn(
      `${TAG} production Android build: android.googleServicesFile is configured from GOOGLE_SERVICES_JSON.`
    );
  }

  return { ...base, expo };
}

module.exports = () => resolveConfig(process.env);
// Exposed for focused config tests (dummy env / dummy paths only).
module.exports.resolveConfig = resolveConfig;

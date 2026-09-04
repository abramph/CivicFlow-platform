// STAGING-PREVIEW CONFIG — exists ONLY on test/build26-staging-preview.
// NEVER merge this to main.
//
// Purpose: make it impossible to ship an internal preview build that talks to
// production. Expo evaluates this file at build time, so throwing here fails
// the build before any artifact exists.
//
// Set APP_VARIANT=preview to produce the staging-preview identity.

const base = require("./app.json");

// Hosts that must never be reachable from a preview build.
const PRODUCTION_HOSTS = [
  "app.getunestra.com",
  "civicflow-portal-iule6.ondigitalocean.app",
  "api.civicflowapp.com",
];

const isPreview = process.env.APP_VARIANT === "preview";
const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;

if (isPreview) {
  if (!apiBase) {
    throw new Error(
      "[staging-preview] EXPO_PUBLIC_API_BASE_URL is required for a preview build. " +
        "Refusing to build: without it the client would fall back to localhost and the " +
        "build would be useless on a device."
    );
  }

  let host;
  try {
    host = new URL(apiBase).host.toLowerCase();
  } catch {
    throw new Error(`[staging-preview] EXPO_PUBLIC_API_BASE_URL is not a valid URL.`);
  }

  const hitsProduction = PRODUCTION_HOSTS.some(
    (p) => host === p || host.endsWith(`.${p}`)
  );
  if (hitsProduction) {
    throw new Error(
      "[staging-preview] REFUSING TO BUILD: the resolved API host is a PRODUCTION host. " +
        "An internal preview build must never target production — it would write test " +
        "progression and family-photo data into the live database."
    );
  }

  if (!apiBase.startsWith("https://")) {
    throw new Error("[staging-preview] REFUSING TO BUILD: staging API base must be HTTPS.");
  }
}

module.exports = () => {
  const expo = { ...base.expo };

  if (isPreview) {
    expo.name = "Unestra Preview";
    expo.slug = base.expo.slug; // slug must stay stable for the EAS project
    // Separate identifiers so the preview installs ALONGSIDE production
    // rather than overwriting it.
    expo.ios = { ...(expo.ios ?? {}), bundleIdentifier: `${base.expo.ios.bundleIdentifier}.preview` };
    expo.android = { ...(expo.android ?? {}), package: `${base.expo.android.package}.preview` };
    // No production update channel; internal builds are self-contained.
    delete expo.updates;
    expo.extra = {
      ...(expo.extra ?? {}),
      isStagingPreview: true,
      stagingApiHost: new URL(apiBase).host,
    };
  }

  return { ...base, expo };
};

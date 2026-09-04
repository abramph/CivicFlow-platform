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

// ── Fail closed, BEFORE the isPreview branch ──────────────────────────────
//
// The guard below used to run only when APP_VARIANT=preview, which left the
// hole this branch exists to prevent. A cloud EAS build never sets
// APP_VARIANT, and the EAS "preview" environment supplies
// EXPO_PUBLIC_API_BASE_URL=https://app.getunestra.com — so `eas build
// --profile preview` from this branch produced an app with the PRODUCTION
// bundle identifier, pointing at the PRODUCTION API, with no staging badge,
// and this file raised no objection. Installed on a device it would have
// replaced the real Unestra app and written test data into the live database.
//
// This branch is staging-only and must never produce a releasable artifact,
// so the rule needs no exception: on this branch a production host is always
// wrong, and a non-preview identity is always wrong.
{
  const host = (() => {
    try {
      return apiBase ? new URL(apiBase).host.toLowerCase() : null;
    } catch {
      return null;
    }
  })();
  if (host && PRODUCTION_HOSTS.some((p) => host === p || host.endsWith(`.${p}`))) {
    throw new Error(
      "[staging-preview] REFUSING TO BUILD: EXPO_PUBLIC_API_BASE_URL resolves to a PRODUCTION host. " +
        "This branch only ever builds internal staging previews. If this came from an EAS build profile, " +
        "that profile is loading the wrong environment — fix the profile rather than this guard."
    );
  }
  if (!isPreview) {
    throw new Error(
      "[staging-preview] REFUSING TO BUILD: APP_VARIANT is not 'preview'. Without it this config emits the " +
        "PRODUCTION bundle identifier and app name, so the artifact would install over the real app instead " +
        "of alongside it."
    );
  }
}

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

    // Drop the PRODUCTION universal-link / app-link claims. Left in place, a
    // preview installed beside the real app also claims app.getunestra.com and
    // app.civicflowapp.com, so tapping a production link could open the
    // staging build. iOS would additionally fail associated-domain validation
    // for a bundle id that owns no such domain.
    delete expo.ios.associatedDomains;
    expo.android = { ...expo.android };
    delete expo.android.intentFilters;
    expo.extra = {
      ...(expo.extra ?? {}),
      isStagingPreview: true,
      stagingApiHost: new URL(apiBase).host,
    };
  }

  return { ...base, expo };
};

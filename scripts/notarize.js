const { APP_ID } = require("../src/shared/appConfig");

/**
 * electron-builder afterSign hook. Prefers App Store Connect API-key
 * notarization (recommended by Apple and by @electron/notarize) over the
 * legacy Apple ID + app-specific password method; falls back to the legacy
 * method only if the API key isn't configured, since the existing production
 * `build.yml` workflow currently only sets the legacy variables.
 *
 * The API key's private key material is never read from an environment
 * variable directly — only a file path is (APPLE_API_PRIVATE_KEY_PATH). The
 * caller (CI) is responsible for decoding the base64 secret to a temporary
 * file with restricted permissions and deleting it after the build, and for
 * never printing the decoded contents.
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuerId = process.env.APPLE_API_ISSUER_ID;
  const apiKeyPath = process.env.APPLE_API_PRIVATE_KEY_PATH;

  if (apiKeyId && apiIssuerId && apiKeyPath) {
    const { notarize } = require("@electron/notarize");
    console.log(`Notarizing ${appName} via App Store Connect API key...`);
    await notarize({
      appBundleId: APP_ID,
      appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuerId,
    });
    console.log("Notarization complete (API key).");
    return;
  }

  // Legacy fallback — accepts either name for the app-specific password:
  // APPLE_APP_SPECIFIC_PASSWORD (this task's preferred naming) or the
  // pre-existing APPLE_ID_PASSWORD (still set by the production build.yml
  // workflow) so neither workflow silently stops notarizing.
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (appleId && appleIdPassword && teamId) {
    const { notarize } = require("@electron/notarize");
    console.log(`Notarizing ${appName} via Apple ID + app-specific password (fallback method)...`);
    await notarize({
      appBundleId: APP_ID,
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log("Notarization complete (Apple ID fallback).");
    return;
  }

  console.log("Skipping notarization: no Apple credentials configured (neither API-key nor Apple ID method).");
};

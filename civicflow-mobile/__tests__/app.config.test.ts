// Focused tests for the unified Expo config (../app.config.js).
//
// These drive the pure resolver with DUMMY env values and DUMMY file paths only.
// They never read, download, or reference the real EAS Secret file or any real
// Firebase identifier.

// app.config.js is an untyped CommonJS module; require() keeps tsc happy under
// strict (an `import` of a .js file with no declarations would error).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveConfig } = require("../app.config.js") as {
  resolveConfig: (env: Record<string, string | undefined>) => { expo: any };
};

const PROD_PACKAGE = "com.aphtechnologies.unestra";
const PROD_BUNDLE = "com.aphtechnologies.unestra";
const DUMMY_GS_PATH = "/dummy/path/google-services.json";

function prodBuildEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    EAS_BUILD_PROFILE: "production",
    EXPO_PUBLIC_API_BASE_URL: "https://app.getunestra.com",
    GOOGLE_SERVICES_JSON: DUMMY_GS_PATH,
    ...overrides,
  };
}

function notificationsPluginConfig(expo: any): any {
  const entry = (expo.plugins as unknown[]).find(
    (p) => Array.isArray(p) && p[0] === "expo-notifications"
  ) as [string, any] | undefined;
  return entry?.[1];
}

beforeEach(() => {
  // Keep the positive production diagnostic out of the test output and give us a
  // handle to assert nothing sensitive is ever logged.
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("production build", () => {
  test("prod host + Firebase file path resolves prod identity and android.googleServicesFile", () => {
    const { expo } = resolveConfig(prodBuildEnv());
    expect(expo.android.package).toBe(PROD_PACKAGE);
    expect(expo.ios.bundleIdentifier).toBe(PROD_BUNDLE);
    expect(expo.android.googleServicesFile).toBe(DUMMY_GS_PATH);
  });

  test("fails closed when the Firebase file path is missing", () => {
    expect(() =>
      resolveConfig(prodBuildEnv({ GOOGLE_SERVICES_JSON: undefined }))
    ).toThrow(/GOOGLE_SERVICES_JSON/);
  });

  test("fails closed when the Firebase file path is blank", () => {
    expect(() =>
      resolveConfig(prodBuildEnv({ GOOGLE_SERVICES_JSON: "   " }))
    ).toThrow(/GOOGLE_SERVICES_JSON/);
  });

  test("fails closed on a preview/staging API host", () => {
    expect(() =>
      resolveConfig(
        prodBuildEnv({ EXPO_PUBLIC_API_BASE_URL: "https://staging.unestra.example" })
      )
    ).toThrow(/must resolve to app\.getunestra\.com/);
  });

  test("fails closed on a non-HTTPS API base", () => {
    expect(() =>
      resolveConfig(
        prodBuildEnv({ EXPO_PUBLIC_API_BASE_URL: "http://app.getunestra.com" })
      )
    ).toThrow(/HTTPS/);
  });

  test("fails closed when the API base is missing", () => {
    expect(() =>
      resolveConfig(prodBuildEnv({ EXPO_PUBLIC_API_BASE_URL: undefined }))
    ).toThrow(/EXPO_PUBLIC_API_BASE_URL/);
  });

  test("fails closed when a preview identity is resolved during a production build", () => {
    expect(() =>
      resolveConfig(
        prodBuildEnv({
          APP_VARIANT: "preview",
          EXPO_PUBLIC_API_BASE_URL: "https://staging.unestra.example",
        })
      )
    ).toThrow(/preview identity/);
  });

  test("iOS production config is materially unchanged and has no google-services file", () => {
    const base = require("../app.json");
    const { expo } = resolveConfig(prodBuildEnv());
    expect(expo.ios.bundleIdentifier).toBe(PROD_BUNDLE);
    // associatedDomains preserved exactly from app.json.
    expect(expo.ios.associatedDomains).toEqual(base.expo.ios.associatedDomains);
    // No Firebase/google-services file is ever set on iOS.
    expect(expo.ios.googleServicesFile).toBeUndefined();
    expect(JSON.stringify(expo.ios)).not.toMatch(/google-services/i);
  });

  test("notification icon/color plugin config remains intact", () => {
    const { expo } = resolveConfig(prodBuildEnv());
    const cfg = notificationsPluginConfig(expo);
    expect(cfg).toBeDefined();
    expect(cfg.icon).toBe("./assets/images/android-icon-monochrome.png");
    expect(cfg.color).toBe("#047857");
  });

  test("marketing version stays 1.1.0 with no local buildNumber/versionCode", () => {
    const { expo } = resolveConfig(prodBuildEnv());
    expect(expo.version).toBe("1.1.0");
    expect(expo.ios.buildNumber).toBeUndefined();
    expect(expo.android.versionCode).toBeUndefined();
  });
});

describe("preview build", () => {
  test("resolves .preview identifiers against a non-production HTTPS API", () => {
    const { expo } = resolveConfig({
      APP_VARIANT: "preview",
      EXPO_PUBLIC_API_BASE_URL: "https://staging.unestra.example",
    });
    expect(expo.ios.bundleIdentifier).toBe(`${PROD_BUNDLE}.preview`);
    expect(expo.android.package).toBe(`${PROD_PACKAGE}.preview`);
    expect(expo.name).toBe("Unestra Preview");
    // Production universal-link / app-link claims are dropped.
    expect(expo.ios.associatedDomains).toBeUndefined();
    expect(expo.android.intentFilters).toBeUndefined();
  });

  test("rejects the production API host", () => {
    expect(() =>
      resolveConfig({
        APP_VARIANT: "preview",
        EXPO_PUBLIC_API_BASE_URL: "https://app.getunestra.com",
      })
    ).toThrow(/PRODUCTION host/i);
  });

  test("rejects a non-HTTPS preview API host", () => {
    expect(() =>
      resolveConfig({
        APP_VARIANT: "preview",
        EXPO_PUBLIC_API_BASE_URL: "http://staging.unestra.example",
      })
    ).toThrow(/HTTPS/);
  });

  test("does NOT inherit the production Firebase file", () => {
    const { expo } = resolveConfig({
      APP_VARIANT: "preview",
      EXPO_PUBLIC_API_BASE_URL: "https://staging.unestra.example",
      // Even if the production secret is present in the environment, preview must
      // never consume it.
      GOOGLE_SERVICES_JSON: "/dummy/path/production-google-services.json",
    });
    expect(expo.android.googleServicesFile).toBeUndefined();
  });

  test("uses a separately scoped preview Firebase file only when explicitly provided", () => {
    const { expo } = resolveConfig({
      APP_VARIANT: "preview",
      EXPO_PUBLIC_API_BASE_URL: "https://staging.unestra.example",
      GOOGLE_SERVICES_JSON: "/dummy/path/production-google-services.json",
      GOOGLE_SERVICES_JSON_PREVIEW: "/dummy/path/preview-google-services.json",
    });
    expect(expo.android.googleServicesFile).toBe(
      "/dummy/path/preview-google-services.json"
    );
  });
});

describe("local development", () => {
  test("remains usable with no build profile and no Firebase credential", () => {
    const { expo } = resolveConfig({
      EXPO_PUBLIC_API_BASE_URL: "http://localhost:3000",
    });
    // Production identity by default, but no fail-closed outside a production build.
    expect(expo.android.package).toBe(PROD_PACKAGE);
    expect(expo.android.googleServicesFile).toBeUndefined();
  });
});

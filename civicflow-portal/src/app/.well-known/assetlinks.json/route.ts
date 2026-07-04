import { getServerEnv } from "@/lib/env";

/**
 * Android app link verification. ANDROID_SHA256_CERT_FINGERPRINTS must be set
 * to the release signing certificate's SHA-256 fingerprint (comma-separated
 * if there's more than one, e.g. debug + release) once the app is signed.
 */
export async function GET() {
  const env = getServerEnv();
  const packageName = env.ANDROID_PACKAGE_NAME || "org.civicflowapp.mobile";
  const fingerprints = (env.ANDROID_SHA256_CERT_FINGERPRINTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return Response.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    { headers: { "Content-Type": "application/json" } }
  );
}

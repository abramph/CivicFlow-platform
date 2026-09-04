/**
 * Asserts the Android permissions the app actually ships.
 *
 * Checked against the GENERATED release manifest (`expo prebuild` output),
 * not app.json alone -- the whole point is that a dependency can inject a
 * permission the config never mentions, which is exactly how
 * SYSTEM_ALERT_WINDOW and an unbounded WRITE_EXTERNAL_STORAGE reached the
 * shipping build. Verified during Build 26 remediation with
 * `aapt2 dump permissions` against the built APK; this script is the
 * repeatable form of that check.
 *
 *   node scripts/verify-android-permissions.mjs
 *
 * `android/` is a prebuild artifact and is gitignored, so on a clean checkout
 * there is nothing to inspect. That is reported and skipped rather than
 * failing, so the check is meaningful where it can run and silent where it
 * cannot. Run `npx expo prebuild --platform android` first to make it real.
 */
import { existsSync, readFileSync } from "node:fs";

/** Prefer the MERGED manifest produced by a release build: some properties
 * only exist after merging. expo-image-picker, for instance, is what bounds
 * READ_EXTERNAL_STORAGE to maxSdkVersion 32 -- the app's own source manifest
 * declares it unbounded, so checking source alone would report a false alarm.
 * Falls back to source when no release build has run, where the removal
 * assertions still hold (tools:node="remove" is written at prebuild). */
const MERGED = "android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml";
const SOURCE = "android/app/src/main/AndroidManifest.xml";
const MANIFEST = existsSync(MERGED) ? MERGED : SOURCE;
const IS_MERGED = MANIFEST === MERGED;

/** Must be present -- the app genuinely needs these. */
const REQUIRED = ["android.permission.CAMERA", "android.permission.INTERNET"];

/** Must NOT be effectively granted in a release build.
 *  - RECORD_AUDIO: the app records no audio; expo-image-picker's
 *    `microphonePermission: false` removes it.
 *  - SYSTEM_ALERT_WINDOW: React Native's dev-menu overlay only. Google Play
 *    treats it as sensitive and no product feature uses it.
 *  - WRITE_EXTERNAL_STORAGE: nothing writes to shared storage; picked images
 *    land in the app's own cache directory. */
const FORBIDDEN = [
  "android.permission.RECORD_AUDIO",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];

if (!existsSync(MANIFEST)) {
  console.log(`  SKIP  ${SOURCE} not present (run \`npx expo prebuild --platform android\` to generate it)`);
  process.exit(0);
}

const xml = readFileSync(MANIFEST, "utf8");

/** A permission counts as shipped only if it is declared AND not marked for
 * removal by the manifest merger. `tools:node="remove"` is how Expo's
 * blockedPermissions and `microphonePermission: false` take effect. */
function declaredEffective(name) {
  const re = new RegExp(`<uses-permission[^>]*android:name="${name.replace(/\./g, "\\.")}"[^>]*/?>`, "g");
  const nodes = xml.match(re) ?? [];
  return nodes.filter((n) => !/tools:node\s*=\s*"remove"/.test(n));
}

const results = [];
const check = (name, passed, detail = "") => {
  results.push(passed);
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

for (const perm of REQUIRED) {
  check(`${perm.split(".").pop()} is declared`, declaredEffective(perm).length > 0);
}

for (const perm of FORBIDDEN) {
  const live = declaredEffective(perm);
  check(
    `${perm.split(".").pop()} is NOT shipped`,
    live.length === 0,
    live.length ? "still present in the merged manifest" : "absent or removed"
  );
}

// READ_EXTERNAL_STORAGE is allowed, but only bounded: expo-image-picker scopes
// it to maxSdkVersion 32 so Android 13+ never sees it. An unbounded one would
// mean a dependency reintroduced a broad, modern-Android storage grant.
const read = declaredEffective("android.permission.READ_EXTERNAL_STORAGE");
if (read.length > 0 && IS_MERGED) {
  check(
    "READ_EXTERNAL_STORAGE is bounded by maxSdkVersion",
    read.every((n) => /maxSdkVersion/.test(n)),
    read.join(" ").match(/maxSdkVersion="(\d+)"/)?.[0] ?? "no maxSdkVersion"
  );
} else if (read.length > 0) {
  console.log("  SKIP  READ_EXTERNAL_STORAGE maxSdkVersion bound — only observable after a release build merges dependency manifests");
}

const passed = results.filter(Boolean).length;
console.log(`\n  android permissions: ${passed}/${results.length}`);
if (passed !== results.length) process.exit(1);

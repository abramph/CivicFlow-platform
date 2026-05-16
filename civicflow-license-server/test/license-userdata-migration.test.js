const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  copyFilePreserveTimestamps,
  findLegacyLicenseCandidates,
  migrateLegacyLicenseIfNeeded,
} = require("../../src/main/license-userdata-migration");

test("migrateLegacyLicenseIfNeeded copies the best legacy license into current userData", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "civicflow-license-migrate-"));
  const currentUserData = path.join(root, "current");
  const legacyUserData = path.join(root, "legacy", "CivicFlow");
  fs.mkdirSync(currentUserData, { recursive: true });
  fs.mkdirSync(legacyUserData, { recursive: true });

  const legacyLicensePath = path.join(legacyUserData, "license.json");
  const legacyPayload = {
    type: "paid",
    validationMode: "server",
    status: "active",
    licenseKey: "CF-AAAA-BBBB-CCCC-DDDD",
    activationToken: "token-123",
    deviceFingerprint: "device-abc",
    lastValidatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(legacyLicensePath, JSON.stringify(legacyPayload, null, 2), "utf8");

  const currentLicensePath = path.join(currentUserData, "license.json");
  const events = [];
  const result = migrateLegacyLicenseIfNeeded({
    currentUserDataPath: currentUserData,
    currentLicensePath,
    extraFolderNames: [legacyUserData],
    log: (event, payload) => events.push({ event, payload }),
  });

  assert.equal(result.migrated, true);
  assert.equal(fs.existsSync(currentLicensePath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(currentLicensePath, "utf8")), legacyPayload);

  const sourceStat = fs.statSync(legacyLicensePath);
  const destStat = fs.statSync(currentLicensePath);
  assert.ok(Math.abs(destStat.mtimeMs - sourceStat.mtimeMs) <= 2000);
  assert.equal(events[0]?.event, "license-userdata-migrated");
});

test("migrateLegacyLicenseIfNeeded skips when the current license already exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "civicflow-license-migrate-"));
  const currentUserData = path.join(root, "current");
  fs.mkdirSync(currentUserData, { recursive: true });

  const currentLicensePath = path.join(currentUserData, "license.json");
  fs.writeFileSync(currentLicensePath, JSON.stringify({ type: "trial" }), "utf8");

  const result = migrateLegacyLicenseIfNeeded({
    currentUserDataPath: currentUserData,
    currentLicensePath,
    extraFolderNames: [],
    log: () => {},
  });

  assert.equal(result.migrated, false);
  assert.equal(result.reason, "current-license-exists");
});

test("copyFilePreserveTimestamps keeps source mtimes on the destination file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "civicflow-license-copy-"));
  const sourcePath = path.join(root, "source.txt");
  const destPath = path.join(root, "dest.txt");
  fs.writeFileSync(sourcePath, "payload", "utf8");

  const past = new Date("2020-01-01T00:00:00.000Z");
  fs.utimesSync(sourcePath, past, past);

  copyFilePreserveTimestamps(sourcePath, destPath);
  const destStat = fs.statSync(destPath);
  assert.equal(Math.floor(destStat.mtimeMs), Math.floor(past.getTime()));
});

test("findLegacyLicenseCandidates prefers paid licenses over trial licenses", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "civicflow-license-candidates-"));
  const currentUserData = path.join(root, "current");
  const trialDir = path.join(root, "legacy-trial");
  const paidDir = path.join(root, "legacy-paid");
  fs.mkdirSync(currentUserData, { recursive: true });
  fs.mkdirSync(trialDir, { recursive: true });
  fs.mkdirSync(paidDir, { recursive: true });

  fs.writeFileSync(path.join(trialDir, "license.json"), JSON.stringify({ type: "trial" }), "utf8");
  fs.writeFileSync(path.join(paidDir, "license.json"), JSON.stringify({
    type: "paid",
    licenseKey: "CF-PAID",
    activationToken: "token",
  }), "utf8");

  const candidates = findLegacyLicenseCandidates(currentUserData, [trialDir, paidDir])
    .filter((entry) => entry.legacyUserDataDir.startsWith(root));

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].parsed.type, "paid");
});

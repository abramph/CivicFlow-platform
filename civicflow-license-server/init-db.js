const db = require("./db");
const { envFlag } = require("./config");
const { createLicense, ensureSchema } = require("./license-service");

async function seedDemoLicenses() {
  if (!envFlag("SEED_DEMO_LICENSES", false)) {
    return { seeded: false, reason: "SEED_DEMO_LICENSES is not enabled" };
  }

  if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production") {
    return { seeded: false, reason: "Demo seeds are disabled in production" };
  }

  await createLicense({
    licenseKey: "CF-A2F9-K7M3-P4Q8-T6W1",
    orgName: "Unestra Demo Org",
    customerEmail: "demo@civicflow.app",
    plan: "Essential",
    licenseType: "annual",
    seatsAllowed: 2,
    expiryDate: "2027-12-31",
    notes: "Seeded example annual license",
    environment: "test",
    actorType: "system",
    actorId: "init-db",
    metadata: { seededDemo: true },
  }).catch((err) => {
    if (!String(err?.message || "").includes("already exists")) {
      throw err;
    }
  });

  await createLicense({
    licenseKey: "CF-Z8R5-N2X4-H7V9-B3L6",
    orgName: "Unestra Demo Org",
    customerEmail: "demo@civicflow.app",
    plan: "Elite",
    licenseType: "perpetual",
    seatsAllowed: 3,
    supportExpiryDate: "2027-12-31",
    notes: "Seeded example perpetual license",
    environment: "test",
    actorType: "system",
    actorId: "init-db",
    metadata: { seededDemo: true },
  }).catch((err) => {
    if (!String(err?.message || "").includes("already exists")) {
      throw err;
    }
  });

  return { seeded: true, reason: "demo licenses inserted or already present" };
}

async function main() {
  try {
    await ensureSchema();
    const seedResult = await seedDemoLicenses();
    console.log("Database initialized successfully");
    console.log(`Demo seeds: ${seedResult.seeded ? "enabled" : "skipped"} (${seedResult.reason})`);
  } catch (err) {
    console.error("Schema error:", err?.message || err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();

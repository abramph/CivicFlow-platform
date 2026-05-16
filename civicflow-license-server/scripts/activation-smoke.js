const db = require("../db");
const {
  addDays,
  createLicense,
  ensureSchema,
  resetActivations,
  revokeLicense,
} = require("../license-service");

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function usage() {
  console.log(`
Usage:
  node scripts/activation-smoke.js [--server https://api.civicflowapp.com] [--environment prod|test] [--plan Essential|Elite] [--type annual|perpetual|trial] [--seats 1] [--days 7] [--device-id smoke-device-001] [--device-name "Smoke Check"] [--org "Smoke Org"] [--email ops+smoke@example.com] [--notes "Optional note"] [--keep-license]

Notes:
  - Run this on a host that has direct access to the target licenses database.
  - By default it creates a disposable license, activates it through the public API,
    deactivates it, resets any remaining activations, and revokes the license.
  - Use --keep-license only for diagnostics.
`);
}

function requireString(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`Missing required ${name}`);
  }
  return normalized;
}

function parsePositiveInt(value, fallback, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const numeric = Number(normalized);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return numeric;
}

function normalizeChoice(value, allowed, fallback, name) {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return normalized;
}

function timestampToken() {
  return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function buildDefaults(token) {
  return {
    orgName: `Activation Smoke ${token}`,
    customerEmail: `ops+activation-smoke-${token}@civicflow.app`,
    deviceId: `activation-smoke-${token}`,
    deviceName: `Activation Smoke ${token}`,
  };
}

function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (error) {
      throw new Error(`Non-JSON response from ${url}: ${text}`);
    }
    return {
      status: response.status,
      ok: response.ok,
      body,
    };
  });
}

async function closeDb() {
  await new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

function printStep(label, payload) {
  console.log(`---${label}---`);
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const token = timestampToken();
  const defaults = buildDefaults(token);
  const server = requireString(args.server || "https://api.civicflowapp.com", "--server").replace(/\/+$/, "");
  const environment = normalizeChoice(args.environment, ["prod", "test"], "prod", "--environment");
  const plan = normalizeChoice(args.plan, ["essential", "elite"], "essential", "--plan");
  const licenseType = normalizeChoice(args.type, ["annual", "perpetual", "trial"], "annual", "--type");
  const seatsAllowed = parsePositiveInt(args.seats, 1, "--seats");
  const durationDays = parsePositiveInt(args.days, 7, "--days");
  const orgName = String(args.org || defaults.orgName).trim();
  const customerEmail = String(args.email || defaults.customerEmail).trim();
  const deviceFingerprint = String(args["device-id"] || defaults.deviceId).trim();
  const deviceName = String(args["device-name"] || defaults.deviceName).trim();
  const notes = String(args.notes || "Automated activation smoke check").trim();
  const keepLicense = !!args["keep-license"];

  let licenseKey = null;
  let activationToken = null;

  await ensureSchema();

  try {
    const created = await createLicense({
      orgName,
      customerEmail,
      plan: plan === "elite" ? "Elite" : "Essential",
      licenseType,
      seatsAllowed,
      expiryDate: licenseType === "perpetual" ? null : addDays(null, durationDays),
      supportExpiryDate: licenseType === "perpetual" ? addDays(null, durationDays) : null,
      environment,
      notes,
      metadata: {
        smokeCheck: true,
        source: "scripts/activation-smoke.js",
      },
    });

    licenseKey = created.summary.licenseKey;
    printStep("CREATE", {
      licenseKey,
      environment: created.summary.environment,
      licenseType: created.summary.licenseType,
      expiresAt: created.summary.expiresAt,
      supportExpiresAt: created.summary.supportExpiresAt,
      seatsAllowed: created.summary.seatsAllowed,
      orgName: created.summary.orgName,
      customerEmail: created.summary.customerEmail,
    });

    const activate = await postJson(`${server}/api/licenses/activate`, {
      licenseKey,
      deviceFingerprint,
      deviceName,
    });
    printStep("ACTIVATE", activate);

    if (!activate.ok || !activate.body?.success || !activate.body?.activationToken) {
      throw new Error("Activation smoke check failed before token issuance");
    }

    activationToken = activate.body.activationToken;

    const deactivate = await postJson(`${server}/api/licenses/deactivate`, {
      licenseKey,
      activationToken,
      deviceFingerprint,
    });
    printStep("DEACTIVATE", deactivate);

    if (!deactivate.ok || !deactivate.body?.success) {
      throw new Error("Activation smoke check failed during deactivation");
    }

    printStep("RESULT", {
      success: true,
      server,
      environment,
      licenseKey,
      deviceFingerprint,
      keptLicense: keepLicense,
    });
  } finally {
    if (licenseKey) {
      try {
        const resetDetails = await resetActivations({ key: licenseKey }, {
          actorType: "system",
          metadata: { smokeCheck: true },
        });
        printStep("RESET", {
          licenseKey,
          resetCount: resetDetails.resetCount,
        });
      } catch (error) {
        printStep("RESET_ERROR", {
          licenseKey,
          message: error.message,
        });
      }

      if (!keepLicense) {
        try {
          const revoked = await revokeLicense({ key: licenseKey }, {
            actorType: "system",
            metadata: { smokeCheck: true },
          });
          printStep("REVOKE", {
            licenseKey,
            status: revoked.summary.status,
          });
        } catch (error) {
          printStep("REVOKE_ERROR", {
            licenseKey,
            message: error.message,
          });
        }
      }
    }

    await closeDb();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
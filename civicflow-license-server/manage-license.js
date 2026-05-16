const db = require("./db");
const {
  addDays,
  createLicense,
  dateOnlyFromValue,
  ensureSchema,
  extendLicense,
  fetchLicenseDetails,
  parseLicenseTypeArg,
  parsePlanArg,
  parsePositiveInt,
  resetActivations,
  revokeLicense,
} = require("./license-service");

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }

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

function requireArg(args, name) {
  const value = String(args[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function resolveCreateExpiry(licenseType, args) {
  const explicitExpiry = dateOnlyFromValue(args.expires, "expires");
  const years = parsePositiveInt(args.years, "years");
  const days = parsePositiveInt(args.days, "days");

  if (explicitExpiry && (years || days)) {
    throw new Error("Use either --expires or --days/--years for the primary expiry");
  }

  if (licenseType === "perpetual") {
    if (explicitExpiry || years || days) {
      throw new Error("Perpetual licenses cannot use --expires, --years, or --days. Use support duration options instead.");
    }
    return null;
  }

  if (explicitExpiry) return explicitExpiry;
  if (years) return addDays(null, years * 365);
  if (days) return addDays(null, days);
  if (licenseType === "trial") return addDays(null, 30);
  return addDays(null, 365);
}

function resolveSupportExpiry(args) {
  const explicitSupport = dateOnlyFromValue(args["support-expires"], "support-expires");
  const supportDays = parsePositiveInt(args["support-days"], "support-days");
  const supportYears = parsePositiveInt(args["support-years"], "support-years");
  if (explicitSupport && (supportDays || supportYears)) {
    throw new Error("Use either --support-expires or --support-days/--support-years");
  }
  if (explicitSupport) return explicitSupport;
  const extensionDays = (supportYears || 0) * 365 + (supportDays || 0);
  if (extensionDays > 0) return addDays(null, extensionDays);
  return null;
}

function buildCliOutput(details, includeChildren = false) {
  const output = { ...details.summary };
  if (typeof details.resetCount === "number") {
    output.resetCount = details.resetCount;
  }
  if (includeChildren) {
    output.activations = details.activations || [];
    output.purchaseEvents = details.purchaseEvents || [];
  }
  return output;
}

function printLicenseDetails(details, outputJson = false) {
  console.log(JSON.stringify(buildCliOutput(details, outputJson), null, 2));
}

function printUsage() {
  console.log(`
Usage:
  node manage-license.js create --org "Acme Org" --plan Essential|Elite --seats 2 [--email billing@example.com] [--type annual|perpetual|trial] [--days 365|--years 1|--expires 2027-12-31] [--support-days 365|--support-years 1|--support-expires 2027-12-31] [--key CF-XXXX-XXXX-XXXX-XXXX] [--notes "Optional note"]
  node manage-license.js revoke --key CF-XXXX-XXXX-XXXX-XXXX
  node manage-license.js reset-activations --key CF-XXXX-XXXX-XXXX-XXXX
  node manage-license.js extend --key CF-XXXX-XXXX-XXXX-XXXX [--days 365|--years 1|--expires 2027-12-31] [--support-days 365|--support-years 1|--support-expires 2027-12-31]
  node manage-license.js inspect --key CF-XXXX-XXXX-XXXX-XXXX [--json]
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "";
  const outputJson = !!args.json;

  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  await ensureSchema();

  let details;
  if (command === "create") {
    const licenseType = parseLicenseTypeArg(args.type);
    details = await createLicense({
      orgName: requireArg(args, "org"),
      customerEmail: String(args.email || "").trim() || null,
      plan: parsePlanArg(requireArg(args, "plan")),
      licenseType,
      seatsAllowed: parsePositiveInt(requireArg(args, "seats"), "seats"),
      expiryDate: resolveCreateExpiry(licenseType, args),
      supportExpiryDate: resolveSupportExpiry(args),
      licenseKey: args.key || null,
      notes: String(args.notes || "").trim() || null,
    });
  } else if (command === "revoke") {
    details = await revokeLicense({ key: requireArg(args, "key") });
  } else if (command === "reset-activations") {
    details = await resetActivations({ key: requireArg(args, "key") });
  } else if (command === "extend") {
    details = await extendLicense({ key: requireArg(args, "key") }, {
      expires: args.expires,
      days: args.days,
      years: args.years,
      supportDays: args["support-days"],
      supportYears: args["support-years"],
      supportExpiryDate: args["support-expires"],
    });
  } else if (command === "inspect") {
    details = await fetchLicenseDetails({ key: requireArg(args, "key") });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  printLicenseDetails(details, outputJson);
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });

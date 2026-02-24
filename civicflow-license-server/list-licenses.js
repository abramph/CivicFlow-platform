const db = require("./db");

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function getLicenseColumns() {
  const rows = await allAsync("PRAGMA table_info(licenses)");
  return new Set((rows || []).map((r) => String(r?.name || "").trim()));
}

async function getActivationColumns() {
  const rows = await allAsync("PRAGMA table_info(activations)");
  return new Set((rows || []).map((r) => String(r?.name || "").trim()));
}

function buildQuery(columns, activationColumns) {
  const hasDeactivatedAt = activationColumns.has("deactivated_at");
  const hasDeviceName = activationColumns.has("device_name");
  const hasDeviceId = activationColumns.has("device_id");

  const joinConditions = ["a.license_id = l.id"];
  if (hasDeactivatedAt) joinConditions.push("a.deactivated_at IS NULL");

  const deviceIdsExpr = hasDeviceId
    ? "COALESCE(GROUP_CONCAT(a.device_id, ', '), '') AS device_ids"
    : "'' AS device_ids";
  const deviceNamesExpr = hasDeviceName
    ? "COALESCE(GROUP_CONCAT(a.device_name, ', '), '') AS device_names"
    : "'' AS device_names";

  const selectParts = [
    "l.id AS license_id",
    "l.license_key",
    columns.has("org_name") ? "COALESCE(l.org_name, '') AS org_name" : "'' AS org_name",
    columns.has("plan") ? "COALESCE(l.plan, '') AS plan" : "'' AS plan",
    columns.has("seats_allowed") ? "COALESCE(l.seats_allowed, 0) AS seats_allowed" : "0 AS seats_allowed",
    columns.has("expiry_date") ? "l.expiry_date" : "NULL AS expiry_date",
    "COUNT(a.id) AS active_devices",
    deviceIdsExpr,
    deviceNamesExpr,
  ];

  return `
    SELECT
      ${selectParts.join(",\n      ")}
    FROM licenses l
    LEFT JOIN activations a
      ON ${joinConditions.join(" AND ")}
    GROUP BY l.id
    ORDER BY l.id DESC
  `;
}

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log("No licenses found.");
    return;
  }

  const formatted = rows.map((row) => ({
    ID: row.license_id,
    Key: row.license_key,
    Org: row.org_name || "-",
    Plan: row.plan || "-",
    Seats: row.seats_allowed,
    Active: row.active_devices,
    Expires: row.expiry_date || "perpetual",
    Devices: row.device_names || row.device_ids || "-",
  }));

  console.table(formatted);
}

async function run() {
  const outputJson = process.argv.includes("--json");

  try {
    const columns = await getLicenseColumns();
    const activationColumns = await getActivationColumns();

    if (!columns.has("license_key")) {
      throw new Error("licenses table is missing license_key column");
    }

    const query = buildQuery(columns, activationColumns);
    const rows = await allAsync(query);

    if (outputJson) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      printTable(rows);
    }
  } catch (err) {
    console.error("Failed to list licenses:", err?.message || err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

run();

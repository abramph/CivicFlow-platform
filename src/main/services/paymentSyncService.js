const { getDatabase, initializeDatabase } = require("../db");

const CLOUD_API_BASE = process.env.CIVICFLOW_CLOUD_API_BASE || "http://localhost:8787";

function getDb() {
  return getDatabase() || initializeDatabase();
}

async function fetchCloudSubmissions() {
  const response = await fetch(`${CLOUD_API_BASE}/api/payment-submissions?status=NEW`);
  if (!response.ok) {
    throw new Error(`Cloud fetch failed with status ${response.status}`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.submissions) ? payload.submissions : []);
  return items;
}

function resolveMemberIdByName(database, memberName) {
  const normalized = String(memberName || "").trim();
  if (!normalized) return null;
  return database.prepare(`
    SELECT id
    FROM members
    WHERE LOWER(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) = LOWER(?)
    ORDER BY id DESC
    LIMIT 1
  `).get(normalized)?.id ?? null;
}

async function insertIntoLocalDB(submissions) {
  const database = getDb();
  if (!Array.isArray(submissions) || submissions.length === 0) {
    return { insertedCount: 0, cloudIdsToMark: [] };
  }

  const insert = database.prepare(`
    INSERT INTO payment_submissions (
      member_id,
      invoice_id,
      method,
      amount,
      paid_date,
      note,
      screenshot_path,
      status,
      source,
      cloud_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_VERIFICATION', 'CLOUD', ?)
  `);

  const existingByCloudId = database.prepare("SELECT id FROM payment_submissions WHERE cloud_id = ? LIMIT 1");

  const cloudIdsToMark = [];
  let insertedCount = 0;

  const run = database.transaction((items) => {
    for (const item of items) {
      const cloudId = String(item?.cloud_id || item?.id || "").trim();
      if (!cloudId) continue;

      cloudIdsToMark.push(cloudId);
      const existing = existingByCloudId.get(cloudId);
      if (existing) continue;

      const memberId = resolveMemberIdByName(database, item.member_name);
      const invoiceId = Number.isFinite(Number(item.invoice_id)) ? Number(item.invoice_id) : null;
      const amount = Number(item.amount || 0);

      insert.run(
        memberId,
        invoiceId,
        String(item.method || "").trim().toUpperCase() || null,
        Number.isFinite(amount) ? amount : 0,
        String(item.paid_date || "").trim() || null,
        String(item.note || "").trim() || null,
        null,
        cloudId,
      );

      insertedCount += 1;
    }
  });

  run(submissions);
  return { insertedCount, cloudIdsToMark };
}

async function markCloudAsSynced(ids) {
  const payload = { ids: Array.isArray(ids) ? ids : [] };
  if (!payload.ids.length) return { success: true, updated: 0 };

  const response = await fetch(`${CLOUD_API_BASE}/api/payment-submissions/mark-synced`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Cloud mark-synced failed with status ${response.status}`);
  }

  return response.json();
}

async function syncPayments() {
  const submissions = await fetchCloudSubmissions();
  const { insertedCount, cloudIdsToMark } = await insertIntoLocalDB(submissions);
  await markCloudAsSynced(cloudIdsToMark);
  return insertedCount;
}

module.exports = {
  fetchCloudSubmissions,
  insertIntoLocalDB,
  markCloudAsSynced,
  syncPayments,
};

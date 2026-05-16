const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "civicflow-license-server-"));
process.env.LICENSE_DB_PATH = path.join(tempRoot, "licenses-test.db");
process.env.STRIPE_SECRET_KEY = "sk_test_checkout";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_checkout";
process.env.STRIPE_PRICE_ID_ANNUAL_ESSENTIAL = "price_annual_essential";
process.env.STRIPE_PRICE_ID_ANNUAL_ELITE = "price_annual_elite";
process.env.STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL = "price_perpetual_essential";
process.env.STRIPE_PRICE_ID_PERPETUAL_ELITE = "price_perpetual_elite";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "password";
process.env.ADMIN_SESSION_SECRET = "test-session-secret";
process.env.LICENSE_SUPPORT_EMAIL = "support@test.civicflow.app";

const db = require("../db");
const {
  addDays,
  allAsync,
  createLicense,
  ensureSchema,
  fetchLicenseDetails,
  getAsync,
  releaseActivation,
  reissueLicense,
  runAsync,
  todayDateOnly,
} = require("../license-service");
const { createApp } = require("../server");
const {
  processLicensePurchase,
  setStripeClientForTests,
} = require("../stripe-license-service");

let httpServer = null;
let baseUrl = null;
let webhookEvent = null;
let checkoutSession = null;

const stripeMock = {
  checkout: {
    sessions: {
      async create() {
        if (!checkoutSession) {
          throw new Error("checkoutSession mock not configured");
        }
        return checkoutSession;
      },
      async listLineItems() {
        return {
          data: [
            {
              price: {
                id: webhookEvent?.data?.object?.metadata?.priceId || "price_annual_essential",
              },
            },
          ],
        };
      },
    },
  },
  customers: {
    async retrieve() {
      return {
        email: "retrieved@example.com",
        name: "Retrieved Customer",
      };
    },
  },
  webhooks: {
    constructEvent() {
      if (!webhookEvent) {
        throw new Error("webhookEvent mock not configured");
      }
      return webhookEvent;
    },
  },
};

async function cleanupDatabase() {
  await runAsync("DELETE FROM license_events");
  await runAsync("DELETE FROM purchase_events");
  await runAsync("DELETE FROM activations");
  await runAsync("DELETE FROM licenses");
  await runAsync("DELETE FROM sqlite_sequence WHERE name IN ('license_events', 'purchase_events', 'activations', 'licenses')");
}

function buildWebhookEvent({
  eventId,
  sessionId,
  priceId,
  purchaseKind = "new_purchase",
  targetLicenseKey = "",
  livemode = false,
  customerEmail = "buyer@example.com",
  organizationName = "Test Org",
  amountTotal = 12500,
  currency = "usd",
  created = 1770000000,
}) {
  return {
    id: eventId,
    livemode,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        livemode,
        payment_status: "paid",
        created,
        amount_total: amountTotal,
        currency,
        customer_details: {
          email: customerEmail,
          name: organizationName,
        },
        metadata: {
          priceId,
          purchaseKind,
          targetLicenseKey,
          customerEmail,
          organizationName,
        },
      },
    },
  };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

test.before(async () => {
  await ensureSchema();
  setStripeClientForTests(stripeMock);
  httpServer = createApp().listen(0);
  await new Promise((resolve) => httpServer.once("listening", resolve));
  const address = httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  setStripeClientForTests(null);
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await new Promise((resolve) => db.close(resolve));
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test.beforeEach(async () => {
  webhookEvent = null;
  checkoutSession = null;
  await cleanupDatabase();
});

test("checkout session creation stores a pending purchase record", async () => {
  checkoutSession = {
    id: "cs_checkout_001",
    url: "https://checkout.stripe.com/c/pay/cs_checkout_001",
    amount_total: 18900,
    currency: "usd",
  };

  const { response, payload } = await postJson(`${baseUrl}/api/store/checkout`, {
    priceId: process.env.STRIPE_PRICE_ID_ANNUAL_ESSENTIAL,
    purchaseKind: "new_purchase",
    customerEmail: "buyer@example.com",
    organizationName: "Checkout Org",
    targetLicenseKey: null,
    environment: "test",
    successUrl: "https://portal.civicflow.test/buy?status=success",
    cancelUrl: "https://portal.civicflow.test/buy?status=cancelled",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.checkoutUrl, checkoutSession.url);

  const purchase = await getAsync("SELECT * FROM purchase_events WHERE checkout_session_id = ?", ["cs_checkout_001"]);
  assert.ok(purchase);
  assert.equal(purchase.status, "checkout_created");
  assert.equal(purchase.purchase_kind, "new_purchase");
  assert.equal(purchase.environment, "test");
  assert.equal(purchase.amount_total, 18900);
});

test("webhook processing is idempotent for the same Stripe event/session", async () => {
  webhookEvent = buildWebhookEvent({
    eventId: "evt_duplicate_001",
    sessionId: "cs_duplicate_001",
    priceId: process.env.STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL,
    purchaseKind: "new_purchase",
    organizationName: "Idempotency Org",
  });

  let first = await fetch(`${baseUrl}/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": "sig_test",
    },
    body: JSON.stringify({ test: true }),
  });
  let firstPayload = await first.json();

  let second = await fetch(`${baseUrl}/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": "sig_test",
    },
    body: JSON.stringify({ test: true }),
  });
  let secondPayload = await second.json();

  assert.equal(first.status, 200);
  assert.equal(firstPayload.success, true);
  assert.equal(second.status, 200);
  assert.equal(secondPayload.duplicate, true);

  const licenseCount = await getAsync("SELECT COUNT(*) AS count FROM licenses");
  const purchaseCount = await getAsync("SELECT COUNT(*) AS count FROM purchase_events");
  assert.equal(licenseCount.count, 1);
  assert.equal(purchaseCount.count, 1);
});

test("new perpetual purchase creates a perpetual license with one year of support", async () => {
  const result = await processLicensePurchase({
    stripeEventId: "evt_perpetual_001",
    stripeSessionId: "cs_perpetual_001",
    checkoutSessionId: "cs_perpetual_001",
    priceId: process.env.STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL,
    stripePriceId: process.env.STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL,
    purchaseKind: "new_purchase",
    customerEmail: "perpetual@example.com",
    orgName: "Perpetual Org",
    purchasedAt: "2026-01-15T00:00:00.000Z",
    rawPayload: { test: "perpetual" },
    amountTotal: 45000,
    currency: "usd",
    environment: "test",
  });

  assert.equal(result.created, true);
  assert.equal(result.details.summary.licenseType, "perpetual");
  assert.equal(result.details.summary.expiresAt, null);
  assert.equal(result.details.summary.supportExpiresAt, "2027-01-15");
});

test("new annual purchase creates an annual license with a one-year expiry", async () => {
  const result = await processLicensePurchase({
    stripeEventId: "evt_annual_001",
    stripeSessionId: "cs_annual_001",
    checkoutSessionId: "cs_annual_001",
    priceId: process.env.STRIPE_PRICE_ID_ANNUAL_ELITE,
    stripePriceId: process.env.STRIPE_PRICE_ID_ANNUAL_ELITE,
    purchaseKind: "new_purchase",
    customerEmail: "annual@example.com",
    orgName: "Annual Org",
    purchasedAt: "2026-02-01T00:00:00.000Z",
    rawPayload: { test: "annual" },
    amountTotal: 26000,
    currency: "usd",
    environment: "test",
  });

  assert.equal(result.created, true);
  assert.equal(result.details.summary.licenseType, "annual");
  assert.equal(result.details.summary.expiresAt, "2027-02-01");
  assert.equal(result.details.summary.supportExpiresAt, null);
});

test("annual renewal extends the existing key instead of creating a new license", async () => {
  const existing = await createLicense({
    orgName: "Renewal Org",
    customerEmail: "renewal@example.com",
    plan: "Essential",
    licenseType: "annual",
    expiryDate: addDays(todayDateOnly(), -10),
    environment: "test",
  });

  const result = await processLicensePurchase({
    stripeEventId: "evt_renew_001",
    stripeSessionId: "cs_renew_001",
    checkoutSessionId: "cs_renew_001",
    priceId: process.env.STRIPE_PRICE_ID_ANNUAL_ESSENTIAL,
    stripePriceId: process.env.STRIPE_PRICE_ID_ANNUAL_ESSENTIAL,
    purchaseKind: "annual_renewal",
    customerEmail: "renewal@example.com",
    orgName: "Renewal Org",
    targetLicenseKey: existing.summary.licenseKey,
    purchasedAt: nowIso(),
    rawPayload: { test: "annual_renewal" },
    amountTotal: 18900,
    currency: "usd",
    environment: "test",
  });

  assert.equal(result.details.summary.licenseKey, existing.summary.licenseKey);
  assert.equal(result.details.summary.expiresAt, addDays(todayDateOnly(), 365));

  const licenseCount = await getAsync("SELECT COUNT(*) AS count FROM licenses");
  assert.equal(licenseCount.count, 1);
});

test("maintenance renewal extends support_expiry_date on the existing perpetual key", async () => {
  const existing = await createLicense({
    orgName: "Maintenance Org",
    customerEmail: "maintenance@example.com",
    plan: "Essential",
    licenseType: "perpetual",
    supportExpiryDate: addDays(todayDateOnly(), -5),
    environment: "test",
  });

  const result = await processLicensePurchase({
    stripeEventId: "evt_support_001",
    stripeSessionId: "cs_support_001",
    checkoutSessionId: "cs_support_001",
    priceId: process.env.STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL,
    stripePriceId: process.env.STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL,
    purchaseKind: "maintenance_renewal",
    customerEmail: "maintenance@example.com",
    orgName: "Maintenance Org",
    targetLicenseKey: existing.summary.licenseKey,
    purchasedAt: nowIso(),
    rawPayload: { test: "maintenance_renewal" },
    amountTotal: 9900,
    currency: "usd",
    environment: "test",
  });

  assert.equal(result.details.summary.licenseKey, existing.summary.licenseKey);
  assert.equal(result.details.summary.supportExpiresAt, addDays(todayDateOnly(), 365));

  const licenseCount = await getAsync("SELECT COUNT(*) AS count FROM licenses");
  assert.equal(licenseCount.count, 1);
});

test("activation on the first device creates one active activation", async () => {
  const existing = await createLicense({
    orgName: "Activation Org",
    customerEmail: "activate@example.com",
    plan: "Essential",
    licenseType: "annual",
    expiryDate: addDays(todayDateOnly(), 30),
    environment: "test",
  });

  const { response, payload } = await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    email: "activate@example.com",
    deviceId: "device-001",
    deviceName: "Device 001",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.valid, true);
  assert.ok(payload.activationToken);
  assert.equal(payload.activeDeviceCount, 1);

  const activationCount = await getAsync("SELECT COUNT(*) AS count FROM activations WHERE deactivated_at IS NULL");
  assert.equal(activationCount.count, 1);
});

test("activating the same device reuses the existing activation record", async () => {
  const existing = await createLicense({
    orgName: "Reuse Org",
    customerEmail: "reuse@example.com",
    plan: "Essential",
    licenseType: "annual",
    expiryDate: addDays(todayDateOnly(), 30),
    environment: "test",
  });

  const first = await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    email: "reuse@example.com",
    deviceId: "device-001",
    deviceName: "Device 001",
  });
  const second = await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    email: "reuse@example.com",
    deviceId: "device-001",
    deviceName: "Device 001 Updated",
  });

  assert.equal(first.payload.activationToken, second.payload.activationToken);
  const activationCount = await getAsync("SELECT COUNT(*) AS count FROM activations WHERE deactivated_at IS NULL");
  assert.equal(activationCount.count, 1);
});

test("plural activate route accepts deviceFingerprint and returns JSON", async () => {
  const existing = await createLicense({
    orgName: "Plural Activate Org",
    customerEmail: "plural-activate@example.com",
    plan: "Essential",
    licenseType: "annual",
    expiryDate: addDays(todayDateOnly(), 30),
    environment: "test",
  });

  const { response, payload } = await postJson(`${baseUrl}/api/licenses/activate`, {
    licenseKey: existing.summary.licenseKey,
    deviceFingerprint: "test-device-001",
    deviceName: "Manual Test",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.valid, true);
  assert.ok(payload.activationToken);

  const activation = await getAsync(
    "SELECT * FROM activations WHERE license_id = ? AND device_id = ? AND deactivated_at IS NULL",
    [existing.summary.id, "test-device-001"]
  );
  assert.ok(activation);
});

test("plural validate route accepts token and deviceFingerprint aliases", async () => {
  const existing = await createLicense({
    orgName: "Plural Validate Org",
    customerEmail: "plural-validate@example.com",
    plan: "Essential",
    licenseType: "annual",
    expiryDate: addDays(todayDateOnly(), 30),
    environment: "test",
  });

  const activationResult = await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    deviceId: "test-device-validate",
    deviceName: "Validate Device",
  });

  const { response, payload } = await postJson(`${baseUrl}/api/licenses/validate`, {
    license_key: existing.summary.licenseKey,
    token: activationResult.payload.activationToken,
    device_fingerprint: "test-device-validate",
  });

  assert.equal(response.status, 200);
  assert.equal(payload.valid, true);
  assert.equal(payload.activationToken, activationResult.payload.activationToken);
});

test("license API returns structured JSON for unknown license keys", async () => {
  const { response, payload } = await postJson(`${baseUrl}/api/licenses/activate`, {
    licenseKey: "CF-H7K2-M9Q4-X3R8-P6T1",
    deviceFingerprint: "test-device-001",
    deviceName: "Manual Test",
  });

  assert.equal(response.status, 404);
  assert.deepEqual(payload, {
    success: false,
    valid: false,
    reason: "not_found",
    error: "License key not recognized",
  });
});

test("license API returns JSON for unsupported plural routes", async () => {
  const response = await fetch(`${baseUrl}/api/licenses/unsupported`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ licenseKey: "CF-H7K2-M9Q4-X3R8-P6T1" }),
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(payload, {
    success: false,
    valid: false,
    reason: "not_found",
    error: "License API route not found",
  });
});

test("seat exhaustion rejects activations beyond the allowed seat count", async () => {
  const existing = await createLicense({
    orgName: "Seat Org",
    customerEmail: "seats@example.com",
    plan: "Essential",
    licenseType: "annual",
    seatsAllowed: 2,
    expiryDate: addDays(todayDateOnly(), 30),
    environment: "test",
  });

  await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    email: "seats@example.com",
    deviceId: "device-001",
    deviceName: "Device 001",
  });
  await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    email: "seats@example.com",
    deviceId: "device-002",
    deviceName: "Device 002",
  });
  const third = await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    email: "seats@example.com",
    deviceId: "device-003",
    deviceName: "Device 003",
  });

  assert.equal(third.payload.valid, false);
  assert.match(String(third.payload.reason || ""), /Seat limit reached/);
});

test("device release soft-deactivates the activation row", async () => {
  const existing = await createLicense({
    orgName: "Release Org",
    customerEmail: "release@example.com",
    plan: "Essential",
    licenseType: "annual",
    expiryDate: addDays(todayDateOnly(), 30),
    environment: "test",
  });

  const activated = await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    email: "release@example.com",
    deviceId: "device-release",
    deviceName: "Device Release",
  });

  const activation = await getAsync("SELECT * FROM activations WHERE activation_token = ?", [activated.payload.activationToken]);
  await releaseActivation({
    licenseId: existing.summary.id,
    activationId: activation.id,
    actorType: "admin",
    actorId: "test",
  });

  const activeCount = await getAsync("SELECT COUNT(*) AS count FROM activations WHERE license_id = ? AND deactivated_at IS NULL", [existing.summary.id]);
  assert.equal(activeCount.count, 0);
});

test("reissue license supersedes the old key and creates a replacement key", async () => {
  const existing = await createLicense({
    orgName: "Reissue Org",
    customerEmail: "reissue@example.com",
    plan: "Elite",
    licenseType: "perpetual",
    seatsAllowed: 3,
    supportExpiryDate: addDays(todayDateOnly(), 180),
    environment: "test",
  });

  const activated = await postJson(`${baseUrl}/api/license/activate`, {
    licenseKey: existing.summary.licenseKey,
    email: "reissue@example.com",
    deviceId: "device-reissue",
    deviceName: "Device Reissue",
  });
  assert.equal(activated.payload.valid, true);

  const result = await reissueLicense({
    licenseId: existing.summary.id,
    clearActivations: true,
    actorType: "admin",
    actorId: "test",
  });

  assert.notEqual(result.details.summary.licenseKey, existing.summary.licenseKey);
  assert.equal(result.details.summary.plan, existing.summary.plan);
  assert.equal(result.details.summary.licenseType, existing.summary.licenseType);
  assert.equal(result.details.summary.supportExpiresAt, existing.summary.supportExpiresAt);
  assert.equal(result.previousDetails.summary.status, "superseded");

  const oldActiveCount = await getAsync("SELECT COUNT(*) AS count FROM activations WHERE license_id = ? AND deactivated_at IS NULL", [existing.summary.id]);
  assert.equal(oldActiveCount.count, 0);
});

function nowIso() {
  return new Date().toISOString();
}

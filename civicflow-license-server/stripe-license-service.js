const Stripe = require("stripe");
const {
  addDays,
  createLicense,
  createOrReusePurchaseRecord,
  extendAnnualLicense,
  extendMaintenance,
  fetchLicenseDetails,
  finalizePurchaseRecord,
  findLicenseByKey,
  findPurchaseRecord,
  mapPurchaseRow,
  normalizeEnvironment,
  normalizeLicenseKey,
  normalizeLicenseType,
  normalizePlan,
  normalizePurchaseKind,
  parsePurchaseKindArg,
  recordLicenseEvent,
} = require("./license-service");
const {
  sendNewLicenseEmail,
  sendRenewalConfirmationEmail,
} = require("./license-mailer");

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;
  const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secret) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  stripeClient = new Stripe(secret, { apiVersion: "2023-10-16" });
  return stripeClient;
}

function setStripeClientForTests(client) {
  stripeClient = client || null;
}

function isStripeConfigured() {
  return !!String(process.env.STRIPE_SECRET_KEY || "").trim()
    && !!String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
}

function getPriceCatalog() {
  const catalog = {};

  const entries = [
    {
      envName: "STRIPE_PRICE_ID_ANNUAL_ESSENTIAL",
      config: { plan: "Essential", licenseType: "annual", seatsAllowed: 2, durationDays: 365 },
    },
    {
      envName: "STRIPE_PRICE_ID_ANNUAL_ELITE",
      config: { plan: "Elite", licenseType: "annual", seatsAllowed: 3, durationDays: 365 },
    },
    {
      envName: "STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL",
      config: { plan: "Essential", licenseType: "perpetual", seatsAllowed: 2, supportDays: 365 },
    },
    {
      envName: "STRIPE_PRICE_ID_PERPETUAL_ELITE",
      config: { plan: "Elite", licenseType: "perpetual", seatsAllowed: 3, supportDays: 365 },
    },
  ];

  entries.forEach(({ envName, config }) => {
    const priceId = String(process.env[envName] || "").trim();
    if (priceId) {
      catalog[priceId] = { ...config, priceId };
    }
  });

  return catalog;
}

function readMetadata(source = {}) {
  return source?.metadata && typeof source.metadata === "object" ? source.metadata : {};
}

function normalizeOrgName(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeAbsoluteUrl(value, label) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`${label} is required`);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_err) {
    throw new Error(`${label} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }
  return parsed.toString();
}

function resolvePriceConfigForPurchase({ priceId, purchaseKind, targetLicense = null }) {
  const catalog = getPriceCatalog();
  const normalizedPriceId = String(priceId || "").trim();
  const priceConfig = catalog[normalizedPriceId];
  if (!priceConfig) {
    throw new Error(`No CivicFlow license mapping is configured for Stripe price ${normalizedPriceId || "(missing)"}.`);
  }

  const normalizedPurchaseKind = parsePurchaseKindArg(purchaseKind);
  if (normalizedPurchaseKind === "new_purchase") {
    return priceConfig;
  }

  if (!targetLicense) {
    throw new Error("A target license is required for renewals.");
  }

  const targetPlan = normalizePlan(targetLicense.plan);
  const targetType = normalizeLicenseType(targetLicense.license_type, targetLicense.expiry_date);

  if (priceConfig.plan !== targetPlan) {
    throw new Error(`Renewal price ${normalizedPriceId} does not match target license plan ${targetPlan}.`);
  }

  if (normalizedPurchaseKind === "annual_renewal") {
    if (targetType !== "annual") {
      throw new Error("Annual renewal can only be applied to annual licenses.");
    }
    if (priceConfig.licenseType !== "annual") {
      throw new Error("Annual renewal requires one of the configured annual CivicFlow price IDs.");
    }
    return priceConfig;
  }

  if (targetType !== "perpetual") {
    throw new Error("Maintenance renewal can only be applied to perpetual licenses.");
  }
  if (priceConfig.licenseType !== "perpetual") {
    throw new Error("Maintenance renewal requires one of the configured perpetual CivicFlow price IDs.");
  }
  return priceConfig;
}

async function resolveSessionPriceId(stripe, session) {
  const metadata = readMetadata(session);
  const metadataPriceId = String(
    metadata.priceId
    || metadata.price_id
    || metadata.civicflowPriceId
    || metadata.civicflow_price_id
    || ""
  ).trim();
  if (metadataPriceId) return metadataPriceId;

  const lineItems = session.line_items?.data;
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    const directPrice = lineItems[0]?.price?.id || lineItems[0]?.pricing?.price_details?.price;
    if (directPrice) return String(directPrice);
  }

  if (!session.id) return null;

  const listed = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
  const priceId = listed?.data?.[0]?.price?.id || listed?.data?.[0]?.pricing?.price_details?.price || null;
  return priceId ? String(priceId) : null;
}

async function resolveCustomerRecord(stripe, session) {
  const email = String(session.customer_details?.email || session.customer_email || "").trim();
  const name = String(session.customer_details?.name || "").trim();
  if (email || name || !session.customer) {
    return { email: email || null, name: name || null };
  }

  try {
    const customer = await stripe.customers.retrieve(String(session.customer));
    return {
      email: String(customer?.email || "").trim() || null,
      name: String(customer?.name || "").trim() || null,
    };
  } catch (_err) {
    return { email: null, name: null };
  }
}

async function createCheckoutSessionForLicensePurchase(input = {}) {
  const priceId = String(input.priceId || "").trim();
  const purchaseKind = parsePurchaseKindArg(input.purchaseKind || "new_purchase");
  const customerEmail = String(input.customerEmail || "").trim();
  const organizationName = String(input.organizationName || "").trim();
  const targetLicenseKey = input.targetLicenseKey ? normalizeLicenseKey(input.targetLicenseKey, "targetLicenseKey") : null;
  const environment = normalizeEnvironment(input.environment, "test");
  const successUrl = normalizeAbsoluteUrl(input.successUrl, "successUrl");
  const cancelUrl = normalizeAbsoluteUrl(input.cancelUrl, "cancelUrl");

  let targetLicense = null;
  if (purchaseKind !== "new_purchase") {
    if (!targetLicenseKey) {
      throw new Error("targetLicenseKey is required for renewals.");
    }
    targetLicense = await findLicenseByKey(targetLicenseKey);
  }

  resolvePriceConfigForPurchase({ priceId, purchaseKind, targetLicense });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: customerEmail || undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      priceId,
      purchaseKind,
      targetLicenseKey: targetLicenseKey || "",
      customerEmail: customerEmail || "",
      organizationName: organizationName || "",
      environment,
    },
  });

  if (!session?.url) {
    throw new Error("Stripe checkout session did not return a redirect URL.");
  }

  return {
    id: session.id,
    url: session.url,
    amountTotal: session.amount_total ?? null,
    currency: session.currency || null,
    priceId,
    purchaseKind,
    environment,
    customerEmail: customerEmail || null,
    organizationName: organizationName || null,
    targetLicenseId: targetLicense?.id || null,
    targetLicenseKey,
  };
}

async function extractPurchaseFromCheckoutSession(stripe, event, session) {
  const metadata = readMetadata(session);
  const customer = await resolveCustomerRecord(stripe, session);
  const priceId = await resolveSessionPriceId(stripe, session);
  const purchaseKind = normalizePurchaseKind(metadata.purchaseKind || metadata.purchase_kind || "new_purchase");
  const targetLicenseKey = metadata.targetLicenseKey
    ? normalizeLicenseKey(metadata.targetLicenseKey, "targetLicenseKey")
    : null;
  const orgName = normalizeOrgName(
    metadata.organizationName
    || metadata.org_name
    || metadata.orgName
    || metadata.organization
    || metadata.company_name
    || customer.name
    || session.customer_details?.name
  ) || (customer.email ? `${customer.email.split("@")[0]} organization` : "CivicFlow Customer");

  return {
    provider: "stripe",
    stripeEventId: event?.id || null,
    stripeSessionId: session?.id || null,
    checkoutSessionId: session?.id || null,
    stripePaymentIntentId: session?.payment_intent || null,
    stripeCustomerId: session?.customer || null,
    stripePriceId: priceId,
    priceId,
    customerEmail: customer.email || metadata.customerEmail || null,
    orgName,
    purchasedAt: session?.created ? new Date(Number(session.created) * 1000).toISOString() : new Date().toISOString(),
    metadata,
    rawPayload: event,
    livemode: !!(event?.livemode ?? session?.livemode),
    environment: event?.livemode ? "prod" : "test",
    purchaseKind,
    targetLicenseKey,
    amountTotal: session?.amount_total ?? null,
    currency: session?.currency || null,
  };
}

async function processLicensePurchase(purchaseData) {
  const purchaseKind = parsePurchaseKindArg(purchaseData?.purchaseKind || "new_purchase");
  const environment = normalizeEnvironment(purchaseData?.environment || (purchaseData?.livemode ? "prod" : "test"));
  const priceId = String(purchaseData?.priceId || purchaseData?.stripePriceId || "").trim();

  let purchaseRecord = await findPurchaseRecord({
    stripeEventId: purchaseData?.stripeEventId,
    stripeSessionId: purchaseData?.stripeSessionId,
    checkoutSessionId: purchaseData?.checkoutSessionId,
  });

  if (purchaseRecord?.license_id && String(purchaseRecord.status || "").toLowerCase() === "processed") {
    const existingDetails = await fetchLicenseDetails(purchaseRecord.license_id);
    return {
      created: false,
      duplicate: true,
      details: existingDetails,
      purchase: mapPurchaseRow(purchaseRecord),
      emailDelivery: { skipped: true, reason: "duplicate-purchase" },
    };
  }

  if (!purchaseRecord) {
    purchaseRecord = await createOrReusePurchaseRecord({
      provider: "stripe",
      stripeEventId: purchaseData?.stripeEventId,
      stripeSessionId: purchaseData?.stripeSessionId,
      checkoutSessionId: purchaseData?.checkoutSessionId,
      stripePaymentIntentId: purchaseData?.stripePaymentIntentId,
      stripeCustomerId: purchaseData?.stripeCustomerId,
      stripePriceId: priceId,
      priceId,
      customerEmail: purchaseData?.customerEmail,
      orgName: purchaseData?.orgName,
      status: "processing",
      rawPayload: purchaseData?.rawPayload,
      environment,
      purchaseKind,
      amountTotal: purchaseData?.amountTotal,
      currency: purchaseData?.currency,
    });
  }

  try {
    const targetLicense = purchaseKind === "new_purchase"
      ? null
      : await findLicenseByKey(purchaseData?.targetLicenseKey);
    const priceConfig = resolvePriceConfigForPurchase({ priceId, purchaseKind, targetLicense });
    const purchaseDate = purchaseData?.purchasedAt ? new Date(purchaseData.purchasedAt) : new Date();
    if (Number.isNaN(purchaseDate.getTime())) {
      throw new Error("Stripe purchase date is invalid.");
    }

    const purchaseDateOnly = purchaseDate.toISOString().slice(0, 10);
    const actorId = purchaseData?.stripeEventId || purchaseData?.stripeSessionId || purchaseData?.checkoutSessionId || "stripe";
    const eventMetadata = {
      purchaseEventId: purchaseRecord.id,
      stripeEventId: purchaseData?.stripeEventId || null,
      stripeSessionId: purchaseData?.stripeSessionId || null,
      checkoutSessionId: purchaseData?.checkoutSessionId || null,
      paymentIntentId: purchaseData?.stripePaymentIntentId || null,
      priceId,
      purchaseKind,
      amountTotal: purchaseData?.amountTotal ?? null,
      currency: purchaseData?.currency || null,
      environment,
    };

    let details;
    let emailDelivery;
    let linkedLicenseId = null;
    let targetLicenseId = targetLicense?.id || null;

    if (purchaseKind === "new_purchase") {
      const expiryDate = priceConfig.licenseType === "annual"
        ? addDays(purchaseDateOnly, priceConfig.durationDays)
        : null;
      const supportExpiryDate = priceConfig.licenseType === "perpetual"
        ? addDays(purchaseDateOnly, priceConfig.supportDays)
        : null;

      details = await createLicense({
        orgName: purchaseData?.orgName,
        customerEmail: purchaseData?.customerEmail,
        plan: priceConfig.plan,
        licenseType: priceConfig.licenseType,
        seatsAllowed: priceConfig.seatsAllowed,
        expiryDate,
        supportExpiryDate,
        notes: `Stripe session ${purchaseData?.stripeSessionId || purchaseData?.checkoutSessionId || "unknown"}`,
        issuedAt: purchaseDate.toISOString(),
        environment,
        actorType: "stripe",
        actorId,
        metadata: eventMetadata,
      });
      linkedLicenseId = details.license.id;

      await recordLicenseEvent({
        licenseId: linkedLicenseId,
        eventType: "purchase_processed",
        actorType: "stripe",
        actorId,
        metadata: eventMetadata,
      });

      emailDelivery = await sendNewLicenseEmail(details.summary);
    } else if (purchaseKind === "annual_renewal") {
      details = await extendAnnualLicense({
        licenseId: targetLicense.id,
        days: 365,
        actorType: "stripe",
        actorId,
        metadata: eventMetadata,
      });
      linkedLicenseId = targetLicense.id;
      emailDelivery = await sendRenewalConfirmationEmail(details.summary);
    } else {
      details = await extendMaintenance({
        licenseId: targetLicense.id,
        days: 365,
        actorType: "stripe",
        actorId,
        metadata: eventMetadata,
      });
      linkedLicenseId = targetLicense.id;
      emailDelivery = await sendRenewalConfirmationEmail(details.summary);
    }

    purchaseRecord = await finalizePurchaseRecord(purchaseRecord.id, {
      stripeEventId: purchaseData?.stripeEventId,
      stripeSessionId: purchaseData?.stripeSessionId,
      checkoutSessionId: purchaseData?.checkoutSessionId,
      stripePaymentIntentId: purchaseData?.stripePaymentIntentId,
      stripeCustomerId: purchaseData?.stripeCustomerId,
      stripePriceId: priceId,
      priceId,
      customerEmail: purchaseData?.customerEmail,
      orgName: purchaseData?.orgName,
      licenseId: linkedLicenseId,
      targetLicenseId,
      status: "processed",
      rawPayload: purchaseData?.rawPayload,
      environment,
      purchaseKind,
      amountTotal: purchaseData?.amountTotal,
      currency: purchaseData?.currency,
    });

    return {
      created: purchaseKind === "new_purchase",
      duplicate: false,
      details,
      purchase: mapPurchaseRow(purchaseRecord),
      emailDelivery,
    };
  } catch (err) {
    await finalizePurchaseRecord(purchaseRecord.id, {
      stripeEventId: purchaseData?.stripeEventId,
      stripeSessionId: purchaseData?.stripeSessionId,
      checkoutSessionId: purchaseData?.checkoutSessionId,
      stripePaymentIntentId: purchaseData?.stripePaymentIntentId,
      stripeCustomerId: purchaseData?.stripeCustomerId,
      stripePriceId: priceId,
      priceId,
      customerEmail: purchaseData?.customerEmail,
      orgName: purchaseData?.orgName,
      targetLicenseId: purchaseRecord.target_license_id || null,
      status: "failed",
      rawPayload: {
        ...(purchaseData?.rawPayload || {}),
        processingError: err?.message || String(err),
      },
      environment,
      purchaseKind,
      amountTotal: purchaseData?.amountTotal,
      currency: purchaseData?.currency,
    });
    throw err;
  }
}

function isProcessableStripeEvent(event) {
  const type = String(event?.type || "").trim();
  return type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded";
}

module.exports = {
  getStripe,
  setStripeClientForTests,
  isStripeConfigured,
  getPriceCatalog,
  resolvePriceConfigForPurchase,
  createCheckoutSessionForLicensePurchase,
  extractPurchaseFromCheckoutSession,
  processLicensePurchase,
  isProcessableStripeEvent,
};

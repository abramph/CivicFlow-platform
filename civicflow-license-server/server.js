const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const {
  activateLicenseSeat,
  buildLicenseClientPayload,
  createLicense,
  createOrReusePurchaseRecord,
  ensureSchema,
  extendLicense,
  extendMaintenance,
  fetchLicenseDetails,
  getAsync,
  getLicenseByKey,
  isLicenseExpired,
  listRecentLicenseEvents,
  listLicenses,
  listRecentPurchaseEvents,
  parseEnvironmentArg,
  parsePurchaseKindArg,
  releaseActivation,
  reissueLicense,
  revokeLicense,
  runAsync,
  validateLicenseRecord,
} = require("./license-service");
const { envNumber } = require("./config");
const {
  clearSessionCookie,
  isAdminConfigured,
  requireAdminSession,
  setSessionCookie,
  validateCredentials,
} = require("./admin-auth");
const {
  renderLicenseDetailPage,
  renderLicensesPage,
  renderLoginPage,
} = require("./admin-ui");
const {
  sendLicenseResendEmail,
  sendNewLicenseEmail,
  sendReissuedLicenseEmail,
  sendRenewalConfirmationEmail,
} = require("./license-mailer");
const {
  createCheckoutSessionForLicensePurchase,
  extractPurchaseFromCheckoutSession,
  getPriceCatalog,
  getStripe,
  isProcessableStripeEvent,
  isStripeConfigured,
  processLicensePurchase,
} = require("./stripe-license-service");

const OFFLINE_GRACE_DAYS = envNumber("OFFLINE_GRACE_DAYS", 37);
const WARN_AFTER_DAYS = envNumber("WARN_AFTER_DAYS", 30);
const PORT = envNumber("PORT", 4000);

function normalizeActivationBody(req, _res, next) {
  normalizeLicenseRequestBody(req);
  if (req.body && req.body.licenseKey && !req.body.key) {
    req.body.key = req.body.licenseKey;
  }
  next();
}

function normalizeRefreshBody(req, _res, next) {
  normalizeLicenseRequestBody(req);
  next();
}

function normalizeDeactivateBody(req, _res, next) {
  normalizeLicenseRequestBody(req);
  next();
}

function normalizeLicenseRequestBody(req) {
  if (!req.body || typeof req.body !== "object") {
    req.body = {};
  }

  const body = req.body;
  const normalized = {
    licenseKey: firstTrimmed(body.licenseKey, body.license_key, body.key),
    deviceId: firstTrimmed(body.deviceId, body.device_id, body.deviceFingerprint, body.device_fingerprint),
    deviceName: firstTrimmed(body.deviceName, body.device_name),
    activationToken: firstTrimmed(body.activationToken, body.activation_token, body.token),
    email: firstTrimmed(body.email),
  };

  Object.assign(body, normalized);
}

function firstTrimmed(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function maskLicenseKey(licenseKey) {
  const value = String(licenseKey || "").trim().toUpperCase();
  if (!value) return null;

  const parts = value.split("-");
  if (parts.length >= 5) {
    return `${parts[0]}-${parts[1]}-****-${parts[parts.length - 1]}`;
  }

  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function buildLicenseApiError(status, reason, error, extras = {}) {
  return {
    status,
    payload: {
      success: false,
      valid: false,
      reason,
      error,
      ...extras,
    },
  };
}

function respondLicenseApiError(res, status, reason, error, extras = {}) {
  const response = buildLicenseApiError(status, reason, error, extras);
  return res.status(response.status).json(response.payload);
}

function mapValidatedLicenseFailure(reason) {
  const normalizedReason = String(reason || "").trim();
  const lower = normalizedReason.toLowerCase();

  if (!normalizedReason || lower === "invalid key") {
    return buildLicenseApiError(404, "not_found", "License key not recognized");
  }
  if (lower.includes("revoked")) {
    return buildLicenseApiError(403, "revoked", "License revoked");
  }
  if (lower.includes("superseded")) {
    return buildLicenseApiError(409, "superseded", "License superseded");
  }
  if (lower.includes("expired")) {
    return buildLicenseApiError(403, "expired", "License expired");
  }
  if (lower.includes("inactive")) {
    return buildLicenseApiError(403, "inactive", "License inactive");
  }
  return buildLicenseApiError(400, "invalid_license", normalizedReason || "Invalid license");
}

function logLicenseApiRequest(route, body, reason) {
  console.info("[license-api]", {
    route,
    licenseKey: maskLicenseKey(body?.licenseKey),
    deviceIdPresent: !!String(body?.deviceId || "").trim(),
    reason,
  });
}

function respondLicenseApiNotFound(req, res) {
  logLicenseApiRequest(req.originalUrl || req.path, req.body, "route_not_found");
  return respondLicenseApiError(res, 404, "route_not_found", "License API route not found");
}

function buildServerLicenseResponse(license, activations = [], overrides = {}) {
  return {
    ...buildLicenseClientPayload(license, activations, overrides),
    offlineGraceDays: OFFLINE_GRACE_DAYS,
    warnAfterDays: WARN_AFTER_DAYS,
  };
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "").toLowerCase();
  return accept.includes("application/json") || req.path.startsWith("/admin/api");
}

function redirectWithFlash(res, path, type, message) {
  const target = new URL(`http://localhost${path}`);
  target.searchParams.set("flashType", type);
  target.searchParams.set("flashMessage", message);
  res.redirect(`${target.pathname}${target.search}`);
}

function readFlash(req) {
  const flashMessage = String(req.query.flashMessage || "").trim();
  if (!flashMessage) return null;
  return {
    type: String(req.query.flashType || "info").trim() || "info",
    message: flashMessage,
  };
}

function normalizeBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function durationToDays(value, unit) {
  const numeric = Math.max(0, Number(value) || 0);
  if (!numeric) return null;
  return unit === "years" ? numeric * 365 : numeric;
}

async function loadValidatedLicense(licenseKey) {
  try {
    const license = await getLicenseByKey(licenseKey);
    const validated = validateLicenseRecord(license);
    if (!validated.ok) {
      return { ok: false, reason: validated.reason };
    }
    if (validated.license.status === "revoked") {
      return { ok: false, reason: "License revoked" };
    }
    if (validated.license.status === "superseded") {
      return { ok: false, reason: "License superseded" };
    }
    if (validated.license.status !== "active") {
      return { ok: false, reason: "License inactive" };
    }
    if (isLicenseExpired(validated.license)) {
      return { ok: false, reason: "License expired" };
    }
    return { ok: true, license: validated.license };
  } catch (_err) {
    return { ok: false, reason: "Invalid key" };
  }
}

function buildManualLicenseInput(body = {}, actorType = "admin", actorId = null) {
  return {
    orgName: body.orgName,
    customerEmail: body.customerEmail,
    plan: body.plan,
    licenseType: body.licenseType || body.type,
    seatsAllowed: body.seatsAllowed,
    expiryDate: body.expiryDate || body.expiry_date || null,
    supportExpiryDate: body.supportExpiryDate || body.support_expiry_date || null,
    environment: body.environment || "test",
    notes: body.notes,
    actorType,
    actorId,
    metadata: { source: "admin_manual_issue" },
  };
}

function parseListLimit(value, fallback = 50) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(200, Math.floor(numeric));
}

function buildLicenseDetailJson(detail) {
  return {
    success: true,
    license: detail.summary,
    activations: detail.activations,
    purchaseEvents: detail.purchaseEvents,
    licenseEvents: detail.licenseEvents,
  };
}

async function resolveActivationForAdminRequest(licenseId, body = {}) {
  const activationId = String(body.activationId || body.activation_id || "").trim();
  const deviceId = String(body.deviceId || body.device_id || "").trim();

  if (activationId) {
    const activation = await getAsync(`
      SELECT *
      FROM activations
      WHERE id = ? AND license_id = ?
      LIMIT 1
    `, [activationId, licenseId]);

    if (!activation) {
      throw new Error("Activation not found for this license.");
    }
    if (activation.deactivated_at) {
      throw new Error("Activation is already inactive.");
    }
    return activation;
  }

  if (deviceId) {
    const activation = await getAsync(`
      SELECT *
      FROM activations
      WHERE license_id = ? AND device_id = ? AND deactivated_at IS NULL
      ORDER BY id DESC
      LIMIT 1
    `, [licenseId, deviceId]);

    if (!activation) {
      throw new Error("Active device activation not found for this license.");
    }
    return activation;
  }

  throw new Error("activationId or deviceId is required.");
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(cors());

  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    if (!isStripeConfigured()) {
      return res.status(503).json({ success: false, error: "Stripe webhook is not configured." });
    }

    try {
      const signature = req.headers["stripe-signature"];
      if (!signature) {
        return res.status(400).json({ success: false, error: "Missing Stripe signature." });
      }

      const stripe = getStripe();
      const event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        String(process.env.STRIPE_WEBHOOK_SECRET || "")
      );

      if (!isProcessableStripeEvent(event)) {
        return res.json({ success: true, ignored: true, type: event.type });
      }

      const session = event.data?.object || {};
      const paymentStatus = String(session.payment_status || "").trim().toLowerCase();
      if (event.type === "checkout.session.completed" && paymentStatus && paymentStatus !== "paid") {
        return res.json({ success: true, ignored: true, reason: `payment_status:${paymentStatus}` });
      }

      const purchase = await extractPurchaseFromCheckoutSession(stripe, event, session);
      const result = await processLicensePurchase(purchase);
      return res.json({
        success: true,
        created: result.created,
        duplicate: result.duplicate,
        licenseId: result.details?.summary?.id || null,
        licenseKey: result.details?.summary?.licenseKey || null,
        emailDelivery: result.emailDelivery || null,
      });
    } catch (err) {
      console.error("Stripe webhook error:", err?.message || err);
      return res.status(400).json({ success: false, error: err?.message || "Webhook processing failed." });
    }
  });

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.post("/api/store/checkout", async (req, res) => {
    try {
      const priceId = String(req.body.priceId || "").trim();
      const purchaseKind = parsePurchaseKindArg(req.body.purchaseKind || "new_purchase");
      const customerEmail = String(req.body.customerEmail || "").trim() || null;
      const organizationName = String(req.body.organizationName || "").trim() || null;
      const targetLicenseKey = String(req.body.targetLicenseKey || "").trim() || null;
      const environment = parseEnvironmentArg(req.body.environment || "test", "test");
      const successUrl = String(req.body.successUrl || "").trim();
      const cancelUrl = String(req.body.cancelUrl || "").trim();

      if (!priceId) {
        return res.status(400).json({ success: false, error: "priceId is required." });
      }
      if (purchaseKind !== "new_purchase" && !targetLicenseKey) {
        return res.status(400).json({ success: false, error: "targetLicenseKey is required for renewals." });
      }
      if (!getPriceCatalog()[priceId]) {
        return res.status(400).json({ success: false, error: "Unsupported CivicFlow priceId." });
      }

      const session = await createCheckoutSessionForLicensePurchase({
        priceId,
        purchaseKind,
        customerEmail,
        organizationName,
        targetLicenseKey,
        environment,
        successUrl,
        cancelUrl,
      });

      await createOrReusePurchaseRecord({
        provider: "stripe",
        stripeSessionId: session.id,
        checkoutSessionId: session.id,
        stripePriceId: priceId,
        priceId,
        customerEmail,
        orgName: organizationName,
        status: "checkout_created",
        rawPayload: {
          type: "checkout_session_created",
          checkoutSessionId: session.id,
          checkoutUrl: session.url,
          metadata: {
            priceId,
            purchaseKind,
            targetLicenseKey,
            customerEmail,
            organizationName,
            environment,
          },
        },
        environment,
        purchaseKind,
        targetLicenseId: session.targetLicenseId,
        amountTotal: session.amountTotal,
        currency: session.currency,
      });

      return res.json({ checkoutUrl: session.url });
    } catch (err) {
      return res.status(400).json({ success: false, error: err?.message || "Checkout session creation failed." });
    }
  });

  async function activationHandler(req, res) {
    const route = req.originalUrl || req.path;
    try {
      const licenseKey = String(req.body.licenseKey || "").trim();
      const deviceId = String(req.body.deviceId || "").trim();
      const deviceName = String(req.body.deviceName || "unknown-device").trim();
      const email = String(req.body.email || "").trim() || null;

      if (!licenseKey || !deviceId) {
        logLicenseApiRequest(route, req.body, "missing_fields");
        return respondLicenseApiError(res, 400, "missing_fields", "Missing licenseKey or deviceId");
      }

      const validated = await loadValidatedLicense(licenseKey);
      if (!validated.ok) {
        const failure = mapValidatedLicenseFailure(validated.reason);
        logLicenseApiRequest(route, req.body, failure.payload.reason);
        return res.status(failure.status).json(failure.payload);
      }
      const activeLicense = validated.license;

      const activation = await activateLicenseSeat({
        licenseId: activeLicense.id,
        deviceId,
        deviceName,
        email,
        actorType: "device",
        actorId: deviceId,
        metadata: { endpoint: "activate" },
      });

      const details = await fetchLicenseDetails(activeLicense.id);
      logLicenseApiRequest(route, req.body, "ok");
      return res.json(buildServerLicenseResponse(details.license, details.activations, {
        activationToken: activation.activationToken,
      }));
    } catch (err) {
      const message = err?.message || "Activation failed";
      if (message.includes("Seat limit reached")) {
        logLicenseApiRequest(route, req.body, "seat_limit");
        return res.status(409).json({
          success: false,
          valid: false,
          reason: message,
          error: message,
          code: "seat_limit",
        });
      }
      logLicenseApiRequest(route, req.body, "server_error");
      return respondLicenseApiError(res, 500, "server_error", err?.message || "Activation failed");
    }
  }

  app.post("/api/license/activate", normalizeActivationBody, activationHandler);
  app.post("/api/licenses/activate", normalizeActivationBody, activationHandler);

  async function refreshHandler(req, res) {
    const route = req.originalUrl || req.path;
    try {
      const licenseKey = String(req.body.licenseKey || "").trim();
      const activationToken = String(req.body.activationToken || "").trim();
      const deviceId = String(req.body.deviceId || "").trim();

      if (!licenseKey || !activationToken || !deviceId) {
        logLicenseApiRequest(route, req.body, "missing_fields");
        return respondLicenseApiError(res, 400, "missing_fields", "Missing licenseKey, activationToken, or deviceId");
      }

      const validated = await loadValidatedLicense(licenseKey);
      if (!validated.ok) {
        const failure = mapValidatedLicenseFailure(validated.reason);
        logLicenseApiRequest(route, req.body, failure.payload.reason);
        return res.status(failure.status).json(failure.payload);
      }
      const activeLicense = validated.license;

      const activation = await getAsync(`
        SELECT *
        FROM activations
        WHERE license_id = ? AND device_id = ? AND activation_token = ? AND deactivated_at IS NULL
      `, [activeLicense.id, deviceId, activationToken]);

      if (!activation) {
        logLicenseApiRequest(route, req.body, "activation_not_found");
        return respondLicenseApiError(res, 404, "activation_not_found", "Activation not found for this device");
      }

      await runAsync(
        "UPDATE activations SET last_check_in_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [activation.id]
      );

      const details = await fetchLicenseDetails(activeLicense.id);
      logLicenseApiRequest(route, req.body, "ok");
      return res.json(buildServerLicenseResponse(details.license, details.activations, { activationToken }));
    } catch (err) {
      logLicenseApiRequest(route, req.body, "server_error");
      return respondLicenseApiError(res, 500, "server_error", err?.message || "Refresh failed");
    }
  }

  app.post("/api/license/refresh", normalizeRefreshBody, refreshHandler);
  app.post("/api/licenses/refresh", normalizeRefreshBody, refreshHandler);
  app.post("/api/licenses/validate", normalizeRefreshBody, refreshHandler);

  async function deactivateHandler(req, res) {
    const route = req.originalUrl || req.path;
    try {
      const licenseKey = String(req.body.licenseKey || "").trim();
      const activationToken = String(req.body.activationToken || "").trim();
      const deviceId = String(req.body.deviceId || "").trim();

      if (!licenseKey || !activationToken || !deviceId) {
        logLicenseApiRequest(route, req.body, "skipped_missing_fields");
        return res.json({ success: true, skipped: true });
      }

      try {
        const license = await getLicenseByKey(licenseKey);
        const activation = await getAsync(`
          SELECT *
          FROM activations
          WHERE license_id = ? AND device_id = ? AND activation_token = ? AND deactivated_at IS NULL
          LIMIT 1
        `, [license.id, deviceId, activationToken]);

        if (!activation) {
          logLicenseApiRequest(route, req.body, "already_released");
          return res.json({ success: true, alreadyReleased: true });
        }

        await releaseActivation({
          licenseId: license.id,
          activationId: activation.id,
          actorType: "device",
          actorId: deviceId,
          metadata: { endpoint: "deactivate" },
        });
      } catch (_err) {
        logLicenseApiRequest(route, req.body, "already_released");
        return res.json({ success: true, alreadyReleased: true });
      }

      logLicenseApiRequest(route, req.body, "ok");
      return res.json({ success: true });
    } catch (err) {
      logLicenseApiRequest(route, req.body, "server_error");
      return respondLicenseApiError(res, 500, "server_error", err?.message || "Deactivate failed");
    }
  }

  app.post("/api/license/deactivate", normalizeDeactivateBody, deactivateHandler);
  app.post("/api/licenses/deactivate", normalizeDeactivateBody, deactivateHandler);

  app.use("/api/license", respondLicenseApiNotFound);
  app.use("/api/licenses", respondLicenseApiNotFound);

  app.get("/admin/login", (req, res) => {
    res.send(renderLoginPage({
      error: String(req.query.error || "").trim() || null,
      next: String(req.query.next || "/admin/licenses").trim() || "/admin/licenses",
      configured: isAdminConfigured(),
    }));
  });

  app.post("/admin/login", (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "").trim();
    const nextUrl = String(req.body.next || "/admin/licenses").trim() || "/admin/licenses";

    if (!validateCredentials(username, password)) {
      return res.status(401).send(renderLoginPage({
        error: "Invalid admin credentials.",
        next: nextUrl,
        configured: isAdminConfigured(),
      }));
    }

    setSessionCookie(res, req, username);
    return res.redirect(nextUrl.startsWith("/") ? nextUrl : "/admin/licenses");
  });

  app.post("/admin/logout", (req, res) => {
    clearSessionCookie(res, req);
    res.redirect("/admin/login");
  });

  app.get("/admin", requireAdminSession, (_req, res) => {
    res.redirect("/admin/licenses");
  });

  app.get("/admin/licenses", requireAdminSession, async (req, res) => {
    try {
      const filters = {
        search: req.query.search,
        plan: req.query.plan,
        type: req.query.type,
        status: req.query.status,
        environment: req.query.environment,
      };
      const [licenses, recentPurchaseEvents, recentLicenseEvents] = await Promise.all([
        listLicenses(filters),
        listRecentPurchaseEvents(12),
        listRecentLicenseEvents(12),
      ]);
      res.send(renderLicensesPage({
        filters,
        licenses,
        recentPurchaseEvents,
        recentLicenseEvents,
        flash: readFlash(req),
        user: req.adminSession,
      }));
    } catch (err) {
      res.status(500).send(renderLicensesPage({
        filters: {},
        licenses: [],
        recentPurchaseEvents: [],
        recentLicenseEvents: [],
        flash: { type: "error", message: err?.message || "Failed to load licenses." },
        user: req.adminSession,
      }));
    }
  });

  app.post("/admin/licenses/create", requireAdminSession, async (req, res) => {
    try {
      const details = await createLicense(buildManualLicenseInput(
        req.body,
        "admin",
        req.adminSession?.username || "admin"
      ));

      if (normalizeBoolean(req.body.sendEmail || req.body.send_email)) {
        await sendNewLicenseEmail(details.summary);
      }

      redirectWithFlash(res, `/admin/licenses/${details.summary.id}`, "success", "License created.");
    } catch (err) {
      redirectWithFlash(res, "/admin/licenses", "error", err?.message || "Failed to create license.");
    }
  });

  app.get("/admin/licenses/:id", requireAdminSession, async (req, res) => {
    try {
      const detail = await fetchLicenseDetails(req.params.id);
      res.send(renderLicenseDetailPage({
        detail,
        flash: readFlash(req),
        user: req.adminSession,
      }));
    } catch (err) {
      redirectWithFlash(res, "/admin/licenses", "error", err?.message || "License not found.");
    }
  });

  app.post("/admin/licenses/:id/revoke", requireAdminSession, async (req, res) => {
    try {
      await revokeLicense(req.params.id, {
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "success", "License revoked.");
    } catch (err) {
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "error", err?.message || "Failed to revoke license.");
    }
  });

  app.post("/admin/licenses/:id/reset-activations", requireAdminSession, async (req, res) => {
    try {
      const detail = await fetchLicenseDetails(req.params.id);
      let released = 0;
      for (const activation of detail.activations.filter((row) => !row.deactivatedAt)) {
        await releaseActivation({
          licenseId: detail.summary.id,
          activationId: activation.id,
          actorType: "admin",
          actorId: req.adminSession?.username || "admin",
          metadata: { bulkReset: true },
        });
        released += 1;
      }
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "success", `Reset ${released} active activation(s).`);
    } catch (err) {
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "error", err?.message || "Failed to reset activations.");
    }
  });

  app.post("/admin/licenses/:id/activations/:activationId/release", requireAdminSession, async (req, res) => {
    try {
      await releaseActivation({
        licenseId: req.params.id,
        activationId: req.params.activationId,
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "success", "Device activation released.");
    } catch (err) {
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "error", err?.message || "Failed to release device.");
    }
  });

  app.post("/admin/licenses/:id/extend", requireAdminSession, async (req, res) => {
    try {
      const detail = await extendLicense(req.params.id, {
        days: durationToDays(req.body.daysValue, req.body.daysUnit),
        expiryDate: req.body.expiryDate || null,
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      if (normalizeBoolean(req.body.notifyCustomer)) {
        await sendRenewalConfirmationEmail(detail.summary);
      }
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "success", "License expiry extended.");
    } catch (err) {
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "error", err?.message || "Failed to extend license.");
    }
  });

  app.post("/admin/licenses/:id/renew-maintenance", requireAdminSession, async (req, res) => {
    try {
      const detail = await extendMaintenance({
        licenseId: req.params.id,
        days: durationToDays(req.body.supportValue || req.body.daysValue || 365, req.body.supportUnit || req.body.daysUnit || "days") || 365,
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      if (normalizeBoolean(req.body.notifyCustomer)) {
        await sendRenewalConfirmationEmail(detail.summary);
      }
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "success", "Support coverage renewed.");
    } catch (err) {
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "error", err?.message || "Failed to renew support coverage.");
    }
  });

  app.post("/admin/licenses/:id/reissue", requireAdminSession, async (req, res) => {
    try {
      const result = await reissueLicense({
        licenseId: req.params.id,
        clearActivations: normalizeBoolean(req.body.clearActivations || req.body.clear_activations),
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      if (normalizeBoolean(req.body.sendEmail || req.body.send_email)) {
        await sendReissuedLicenseEmail(result.details.summary, result.previousDetails.summary.licenseKey);
      }
      redirectWithFlash(
        res,
        `/admin/licenses/${result.details.summary.id}`,
        "success",
        `License reissued as ${result.details.summary.licenseKey}.`
      );
    } catch (err) {
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "error", err?.message || "Failed to reissue license.");
    }
  });

  app.post("/admin/licenses/:id/resend-email", requireAdminSession, async (req, res) => {
    try {
      const detail = await fetchLicenseDetails(req.params.id);
      await sendLicenseResendEmail(detail.summary);
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "success", "License email resent.");
    } catch (err) {
      redirectWithFlash(res, `/admin/licenses/${req.params.id}`, "error", err?.message || "Failed to resend email.");
    }
  });

  app.get("/admin/api/licenses", requireAdminSession, async (req, res) => {
    try {
      const licenses = await listLicenses({
        search: req.query.search || req.query.query,
        plan: req.query.plan,
        type: req.query.type,
        status: req.query.status,
        environment: req.query.environment,
        limit: req.query.limit,
      });
      res.json({ success: true, licenses });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "Failed to list licenses." });
    }
  });

  app.get("/admin/api/licenses/:id", requireAdminSession, async (req, res) => {
    try {
      const detail = await fetchLicenseDetails(req.params.id);
      res.json(buildLicenseDetailJson(detail));
    } catch (err) {
      res.status(404).json({ success: false, error: err?.message || "License not found." });
    }
  });

  app.post("/admin/api/licenses", requireAdminSession, async (req, res) => {
    try {
      const detail = await createLicense(buildManualLicenseInput(
        req.body,
        "admin",
        req.adminSession?.username || "admin"
      ));
      if (normalizeBoolean(req.body.sendEmail || req.body.send_email)) {
        await sendNewLicenseEmail(detail.summary);
      }
      res.status(201).json({ success: true, license: detail.summary });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to create license." });
    }
  });

  app.post("/admin/api/licenses/:id/revoke", requireAdminSession, async (req, res) => {
    try {
      const detail = await revokeLicense(req.params.id, {
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      res.json({ success: true, license: detail.summary });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to revoke license." });
    }
  });

  app.post("/admin/api/licenses/:id/reset-activations", requireAdminSession, async (req, res) => {
    try {
      const detail = await fetchLicenseDetails(req.params.id);
      let released = 0;
      for (const activation of detail.activations.filter((row) => !row.deactivatedAt)) {
        await releaseActivation({
          licenseId: detail.summary.id,
          activationId: activation.id,
          actorType: "admin",
          actorId: req.adminSession?.username || "admin",
          metadata: { bulkReset: true },
        });
        released += 1;
      }
      const nextDetail = await fetchLicenseDetails(req.params.id);
      res.json({ success: true, license: nextDetail.summary, resetCount: released });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to reset activations." });
    }
  });

  app.post("/admin/api/licenses/:id/activations/:activationId/release", requireAdminSession, async (req, res) => {
    try {
      const detail = await releaseActivation({
        licenseId: req.params.id,
        activationId: req.params.activationId,
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      res.json({ success: true, license: detail.summary, activations: detail.activations });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to release device." });
    }
  });

  app.post("/admin/api/licenses/:id/extend", requireAdminSession, async (req, res) => {
    try {
      const detail = await extendLicense(req.params.id, {
        days: req.body.days,
        years: req.body.years,
        expiryDate: req.body.expiryDate,
        supportDays: req.body.supportDays,
        supportYears: req.body.supportYears,
        supportExpiryDate: req.body.supportExpiryDate,
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      if (normalizeBoolean(req.body.notifyCustomer)) {
        await sendRenewalConfirmationEmail(detail.summary);
      }
      res.json({ success: true, license: detail.summary });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to extend license." });
    }
  });

  app.post("/admin/api/licenses/:id/renew-maintenance", requireAdminSession, async (req, res) => {
    try {
      const detail = await extendMaintenance({
        licenseId: req.params.id,
        days: req.body.days || 365,
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      if (normalizeBoolean(req.body.notifyCustomer)) {
        await sendRenewalConfirmationEmail(detail.summary);
      }
      res.json({ success: true, license: detail.summary });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to renew support coverage." });
    }
  });

  app.post("/admin/api/licenses/:id/reissue", requireAdminSession, async (req, res) => {
    try {
      const result = await reissueLicense({
        licenseId: req.params.id,
        clearActivations: normalizeBoolean(req.body.clearActivations || req.body.clear_activations),
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
      });
      if (normalizeBoolean(req.body.sendEmail || req.body.send_email)) {
        await sendReissuedLicenseEmail(result.details.summary, result.previousDetails.summary.licenseKey);
      }
      res.json({
        success: true,
        license: result.details.summary,
        previousLicense: result.previousDetails.summary,
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to reissue license." });
    }
  });

  app.post("/admin/api/licenses/:id/resend-email", requireAdminSession, async (req, res) => {
    try {
      const detail = await fetchLicenseDetails(req.params.id);
      const delivery = await sendLicenseResendEmail(detail.summary);
      res.json({ success: true, license: detail.summary, emailDelivery: delivery });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to resend email." });
    }
  });

  app.get("/api/admin/licenses", requireAdminSession, async (req, res) => {
    try {
      const licenses = await listLicenses({
        search: req.query.query || req.query.search,
        plan: req.query.plan,
        type: req.query.type,
        status: req.query.status,
        environment: req.query.environment,
        limit: req.query.limit,
      });
      res.json({ success: true, licenses });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "Failed to list licenses." });
    }
  });

  app.get("/api/admin/purchase-events", requireAdminSession, async (req, res) => {
    try {
      const events = await listRecentPurchaseEvents(parseListLimit(req.query.limit, 50));
      res.json({ success: true, purchaseEvents: events });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "Failed to load purchase events." });
    }
  });

  app.get("/api/admin/license-events", requireAdminSession, async (req, res) => {
    try {
      const events = await listRecentLicenseEvents(parseListLimit(req.query.limit, 50));
      res.json({ success: true, licenseEvents: events });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "Failed to load license events." });
    }
  });

  app.post("/api/admin/licenses/:licenseKey/resend", requireAdminSession, async (req, res) => {
    try {
      const detail = await fetchLicenseDetails(req.params.licenseKey);
      const delivery = await sendLicenseResendEmail(detail.summary);
      res.json({ success: true, license: detail.summary, emailDelivery: delivery });
    } catch (err) {
      res.status(400).json({ success: false, error: err?.message || "Failed to resend license email." });
    }
  });

  app.post("/api/admin/licenses/:licenseKey/deactivate-device", requireAdminSession, async (req, res) => {
    try {
      const license = await getLicenseByKey(req.params.licenseKey);
      const activation = await resolveActivationForAdminRequest(license.id, req.body);
      const detail = await releaseActivation({
        licenseId: license.id,
        activationId: activation.id,
        actorType: "admin",
        actorId: req.adminSession?.username || "admin",
        metadata: {
          source: "api_admin_deactivate_device",
          requestedDeviceId: String(req.body.deviceId || req.body.device_id || "").trim() || null,
        },
      });
      res.json({ success: true, license: detail.summary, activations: detail.activations });
    } catch (err) {
      const message = err?.message || "Failed to deactivate device.";
      const status = message.includes("not found") ? 404 : 400;
      res.status(status).json({ success: false, error: message });
    }
  });

  app.get("/api/admin/licenses/:licenseKey", requireAdminSession, async (req, res) => {
    try {
      const detail = await fetchLicenseDetails(req.params.licenseKey);
      res.json(buildLicenseDetailJson(detail));
    } catch (err) {
      res.status(404).json({ success: false, error: err?.message || "License not found." });
    }
  });

  app.get("/", (_req, res) => {
    res.send("CivicFlow License Server is running");
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      offlineGraceDays: OFFLINE_GRACE_DAYS,
      warnAfterDays: WARN_AFTER_DAYS,
      adminConfigured: isAdminConfigured(),
      stripeConfigured: isStripeConfigured(),
    });
  });

  return app;
}

async function start(port = PORT) {
  await ensureSchema();
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`CivicFlow License Server running on port ${port}`);
      resolve({ app, server });
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to initialize license server schema:", err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  buildServerLicenseResponse,
  createApp,
  loadValidatedLicense,
  normalizeActivationBody,
  normalizeDeactivateBody,
  normalizeRefreshBody,
  start,
  wantsJson,
};

const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");
const { app, dialog, ipcMain } = require("electron");
const { initializeDatabase, getDatabase, closeDatabase, getDbPath } = require("./db");
const { calculateMemberDuesStatus } = require("./dues");
const { getDeviceId } = require("./device");
const branding = require("./branding");
const licenseService = require("./licenseService");
const campaignsService = require("./services/campaigns");
const orgService = require("./services/organization");
const { API_BASE, API_KEY } = require("./config/apiConfig");
const { syncPayments } = require("./services/paymentSyncService");
const { ImportService, buildFileHash } = require("./services/importService");
const { buildPeriodReportPDF } = require("./pdf-service");
const { createCheckoutSession } = require("./stripe-payments");
const {
  PRODUCTION_REPORT_PAYMENT_URL,
  CIVICFLOW_DEEP_LINK_URL,
  renderPaymentReminder,
} = require("./email/renderTemplate");

let registerCount = 0;

function trialFilePath() {
  const userData = app.getPath("userData");
  return path.join(userData, "trial.json");
}

function loadTrial() {
  try {
    const fp = trialFilePath();
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch (_e) {
    return null;
  }
}

function saveTrial(data) {
  const fp = trialFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}

function computeTrialStatus(trial) {
  if (!trial?.startedAt || !trial?.expiresAt) return null;
  const now = Date.now();
  const expiresAt = Number(trial.expiresAt);
  const startedAt = Number(trial.startedAt);
  const expired = now >= expiresAt;

  const msLeft = Math.max(0, expiresAt - now);
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  return {
    startedAt,
    expiresAt,
    expired,
    daysLeft,
  };
}

const ALL_PRELOAD_CHANNELS = [
  "admin:assignOrphanTransaction",
  "admin:deleteSampleData",
  "admin:getSampleDataCounts",
  "admin:listOrphanTransactions",
  "audit:list",
  "autopay:cancel_end",
  "autopay:cancel_now",
  "autopay:pause",
  "autopay:resume",
  "analytics:getSummary",
  "backup:db",
  "db:attendance:getAllMembersForMeeting",
  "db:attendance:getForMeeting",
  "db:attendance:getForMember",
  "db:attendance:set",
  "db:campaigns:archive",
  "db:campaigns:create",
  "db:campaigns:list",
  "db:campaigns:listActive",
  "db:campaigns:update",
  "db:categories:create",
  "db:categories:list",
  "db:categories:update",
  "db:events:archive",
  "db:events:create",
  "db:events:get",
  "db:events:list",
  "db:events:listActive",
  "db:events:update",
  "db:meetings:create",
  "db:meetings:delete",
  "db:meetings:get",
  "db:meetings:getSummary",
  "db:meetings:list",
  "db:meetings:update",
  "db:members:archive",
  "db:members:create",
  "db:members:deletePermanent",
  "db:members:get",
  "db:members:list",
  "db:members:restore",
  "db:members:update",
  "db:transactions:create",
  "db:transactions:delete",
  "db:transactions:list",
  "db:transactions:update",
  "email:outbox:list",
  "email:processOutbox",
  "email:queue",
  "email:resolveRecipients",
  "email:send:test",
  "email:sendDuesReminder",
  "email:sendReport",
  "email:sendReportToAllMembers",
  "email:settings:get",
  "email:settings:update",
  "expenditures:create",
  "expenditures:delete",
  "expenditures:list",
  "expenditures:summary",
  "expenditures:update",
  "export:members-csv",
  "export:transactions-csv",
  "features:getEnabled",
  "features:isEnabled",
  "finance:txns:adjust",
  "finance:txns:correct",
  "finance:txns:create",
  "finance:txns:delete",
  "finance:txns:getById",
  "finance:txns:list",
  "finance:txns:listAll",
  "finance:txns:reverse",
  "finance:txns:update",
  "finance:txns:updateNotes",
  "generate-period-report",
  "generate-receipt",
  "generate-receipt-buffer",
  "get-campaign-details",
  "get-cbo-branding",
  "get-dashboard-stats",
  "get-device-id",
  "get-event-details",
  "get-member-details",
  "get-member-dues-status",
  "grantReports:create",
  "grantReports:delete",
  "grantReports:listForGrant",
  "grantReports:markSubmitted",
  "grantReports:update",
  "grants:allocate",
  "grants:archive",
  "grants:create",
  "grants:deletePermanent",
  "grants:getById",
  "grants:list",
  "grants:restore",
  "grants:summary",
  "grants:update",
  "import:commit",
  "import:execute",
  "import:file:parse",
  "import:getTemplate",
  "import:parseFile",
  "import:preview",
  "import:runs:get",
  "import:runs:list",
  "import:templates:download",
  "import:templates:list",
  "import:validate",
  "license:activate",
  "license:can-activate",
  "license:deactivate",
  "license:getStatus",
  "license:refresh",
  "license:startTrial",
  "license:start-trial",
  "license:status",
  "membership:getCurrentStatus",
  "membership:listPeriods",
  "membership:reinstate",
  "membership:setInactive",
  "membership:startNewPeriod",
  "membership:terminate",
  "organization:completeSetup",
  "organization:get",
  "organization:getSettings",
  "organization:getSetupStatus",
  "organization:set",
  "organization:updateSettings",
  "organization:upload-logo",
  "payments:approveExternal",
  "payments:connectStripe",
  "payments:createCheckout",
  "payments:createCheckoutSession",
  "payments:createExternalPayment",
  "payments:createSubscription",
  "payments:listPendingExternal",
  "payments:rejectExternal",
  "payments:sendReceipt",
  "payments:syncFromCloud",
  "receipt:email-receipt",
  "receipt:is-email-configured",
  "receipt:save-pdf-dialog",
  "reports:by_member",
  "reports:by_type",
  "reports:campaign",
  "reports:campaign-contribution-csv",
  "reports:campaign-contribution-pdf",
  "reports:campaignTopMembers",
  "reports:event",
  "reports:event-contribution-csv",
  "reports:event-contribution-pdf",
  "reports:exportCsv",
  "reports:generateReportBuffer",
  "reports:getPaymentMethods",
  "reports:kpis",
  "reports:member-contribution-csv",
  "reports:member-contribution-pdf",
  "reports:member-monthly-csv",
  "reports:member-monthly-pdf",
  "reports:org-financial-csv",
  "reports:org-financial-pdf",
  "reports:recent",
  "reports:roster-active-csv",
  "reports:roster-active-pdf",
  "reports:roster-combined-csv",
  "reports:roster-combined-pdf",
  "reports:roster-inactive-csv",
  "reports:roster-inactive-pdf",
  "reports:timeseries",
  "restore:db",
  "roles:getCurrent",
  "roles:setCurrent",
  "set-cbo-branding",
  "transaction:addManualPayment",
  "transaction:getById",
  "transaction:update",
  "transactions:importCSV",
  "update-member-profile",
];

function db() {
  return getDatabase() || initializeDatabase();
}

function toCents(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) > 1000) return Math.round(n);
  return Math.round(n * 100);
}

function decodeBase64ToBuffer(base64) {
  if (!base64 || typeof base64 !== "string") {
    throw new Error("Missing import file payload.");
  }
  return Buffer.from(base64, "base64");
}

function savePaymentProofImage(base64OrDataUrl, originalName = "proof.png") {
  const raw = String(base64OrDataUrl || "").trim();
  if (!raw) return null;

  let mime = "image/png";
  let b64 = raw;
  const m = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) {
    mime = String(m[1] || "image/png").toLowerCase();
    b64 = m[2] || "";
  }

  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : (mime.includes("webp") ? "webp" : "png");
  const safeBase = String(originalName || "proof")
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 40) || "proof";

  const userData = app.getPath("userData");
  const proofsDir = path.join(userData, "payment-proofs");
  fs.mkdirSync(proofsDir, { recursive: true });
  const fileName = `${Date.now()}-${safeBase}.${ext}`;
  const filePath = path.join(proofsDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
  return filePath;
}

function normalizeTransactionType(value) {
  const t = String(value || "").trim().toUpperCase();
  if (!t) return "DONATION";
  if (t === "DUES" || t === "DUES_PAYMENT" || t === "RECEIPT" || t === "INVOICE") return "DUES";
  if (t === "DONATION" || t === "CONTRIBUTION") return "DONATION";
  if (t === "CAMPAIGN_CONTRIBUTION" || t === "CAMPAIGN_REVENUE") return "CAMPAIGN_CONTRIBUTION";
  if (t === "EVENT_REVENUE") return "EVENT_REVENUE";
  if (t === "OTHER_INCOME") return "OTHER_INCOME";
  return "DONATION";
}

function mapTxnTypeToLedgerType(transactionType) {
  const t = normalizeTransactionType(transactionType);
  if (t === "DUES") return "dues";
  if (t === "EVENT_REVENUE") return "donation";
  if (t === "CAMPAIGN_CONTRIBUTION") return "donation";
  if (t === "OTHER_INCOME") return "donation";
  return "donation";
}

function toCsv(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const str = String(value ?? "");
    if (str.includes(",") || str.includes("\n") || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(","));
  }
  return lines.join("\n");
}

function monthToRange(month) {
  const m = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [year, mon] = m.split("-").map(Number);
  const start = `${year}-${String(mon).padStart(2, "0")}-01`;
  const endDate = new Date(year, mon, 0);
  const end = `${year}-${String(mon).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { startDate: start, endDate: end };
}

function normalizeDateRange(startDate, endDate) {
  const start = String(startDate || "").trim() || "1970-01-01";
  const end = String(endDate || "").trim() || new Date().toISOString().slice(0, 10);
  return { startDate: start, endDate: end };
}

function toOptionalPositiveId(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function validateContributionAttribution(database, payload = {}, options = {}) {
  const allowNonMember = options.allowNonMember !== false;
  const requireNonMemberName = options.requireNonMemberName === true;

  const memberId = toOptionalPositiveId(payload.memberId ?? payload.member_id);
  const eventId = toOptionalPositiveId(payload.eventId ?? payload.event_id);
  const campaignId = toOptionalPositiveId(payload.campaignId ?? payload.campaign_id);

  const contributorTypeInput = String(payload.contributorType ?? payload.contributor_type ?? "").trim().toUpperCase();
  const contributorName = String(payload.contributorName ?? payload.contributor_name ?? "").trim();

  if (!memberId && !eventId && !campaignId && (!allowNonMember || contributorTypeInput !== "NON_MEMBER")) {
    throw new Error("Every contribution must be attributed to a Member, Non-Member, or Event.");
  }

  if (memberId) {
    const member = database.prepare("SELECT id FROM members WHERE id = ?").get(memberId);
    if (!member) throw new Error("Selected member does not exist.");
  }
  if (eventId) {
    const event = database.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
    if (!event) throw new Error("Selected event does not exist.");
  }
  if (campaignId) {
    const campaign = database.prepare("SELECT id FROM campaigns WHERE id = ?").get(campaignId);
    if (!campaign) throw new Error("Selected campaign does not exist.");
  }

  if (requireNonMemberName && !memberId && !eventId && !campaignId && contributorTypeInput === "NON_MEMBER" && !contributorName) {
    throw new Error("Non-member contributions require a contributor name.");
  }

  let contributorType = contributorTypeInput;
  if (!contributorType) {
    contributorType = memberId ? "MEMBER" : (campaignId ? "CAMPAIGN_REVENUE" : (eventId ? "EVENT_REVENUE" : "NON_MEMBER"));
  }

  return {
    memberId,
    eventId,
    campaignId,
    contributorType,
    contributorName: contributorName || null,
  };
}

function ensureDuesAttributedToMember(transactionType, attribution = {}) {
  const normalizedType = normalizeTransactionType(transactionType);
  if (normalizedType === "DUES" && !toOptionalPositiveId(attribution.memberId)) {
    throw new Error("Dues payments must be attributed to a member.");
  }
}

function getEmailSettingsRow(database) {
  return database.prepare("SELECT * FROM email_settings WHERE id = 1").get() || null;
}

function buildEmailTransport(database) {
  const settings = getEmailSettingsRow(database);
  if (!settings) {
    throw new Error("Email settings not found.");
  }
  if (!Number(settings.enabled || 0)) {
    throw new Error("Email sending is disabled in settings.");
  }

  const host = String(settings.smtp_host || "").trim();
  const fromEmail = String(settings.from_email || "").trim();
  if (!host || !fromEmail) {
    throw new Error("Email settings are incomplete. Configure SMTP host and From Email.");
  }

  const port = Number(settings.smtp_port || 587);
  const secure = Number(settings.smtp_secure || 0) === 1;
  const user = String(settings.smtp_user || "").trim() || undefined;
  const pass = String(settings.smtp_password_ref || "").trim() || undefined;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  const fromName = String(settings.from_name || "").trim();
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  return { transport, from, settings };
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPaymentOptionsForReminder(org = {}, { stripeCheckoutUrl, includeStripeAchNote = false } = {}) {
  const options = [];

  const rawCashApp = String(org.cashapp_handle || "").trim();
  if (rawCashApp) {
    const clean = rawCashApp.replace(/^\$/, "");
    if (clean) {
      const label = `$${clean}`;
      const url = `https://cash.app/$${encodeURIComponent(clean)}`;
      options.push({
        text: `Cash App: ${label}\n${url}`,
        html: `Cash App: <a href="${url}">${escapeHtml(label)}</a>`,
      });
    }
  }

  const rawVenmo = String(org.venmo_handle || "").trim();
  if (rawVenmo) {
    const clean = rawVenmo.replace(/^@/, "");
    if (clean) {
      const label = `@${clean}`;
      const url = `https://venmo.com/u/${encodeURIComponent(clean)}`;
      options.push({
        text: `Venmo: ${label}\n${url}`,
        html: `Venmo: <a href="${url}">${escapeHtml(label)}</a>`,
      });
    }
  }

  const zelle = String(org.zelle_contact || "").trim();
  if (zelle) {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(zelle);
    const digits = zelle.replace(/\D/g, "");
    if (isEmail) {
      const url = `mailto:${encodeURIComponent(zelle)}`;
      options.push({
        text: `Zelle: ${zelle}\n${url}`,
        html: `Zelle: <a href="${url}">${escapeHtml(zelle)}</a>`,
      });
    } else if (digits.length >= 10) {
      const tel = `+${digits}`;
      const url = `tel:${tel}`;
      options.push({
        text: `Zelle: ${zelle}\n${url}`,
        html: `Zelle: <a href="${url}">${escapeHtml(zelle)}</a>`,
      });
    } else {
      options.push({
        text: `Zelle: ${zelle}`,
        html: `Zelle: ${escapeHtml(zelle)}`,
      });
    }
  }

  if (stripeCheckoutUrl) {
    options.push({
      text: `Stripe / ACH:\n${stripeCheckoutUrl}`,
      html: `Stripe / ACH: <a href="${stripeCheckoutUrl}">Pay online securely</a>`,
    });
  } else if (includeStripeAchNote) {
    options.push({
      text: "Stripe / ACH: Use your member payment link to pay online by card or ACH bank transfer.",
      html: "Stripe / ACH: Use your member payment link to pay online by card or ACH bank transfer.",
    });
  }

  return options;
}

function buildReportPaymentDeepLink(memberId) {
  void memberId;
  return CIVICFLOW_DEEP_LINK_URL;
}

function buildReportPaymentHttpsLink(invoiceId) {
  void invoiceId;
  return PRODUCTION_REPORT_PAYMENT_URL;
}

function buildReportPaymentBlocks(memberId) {
  const reportLink = buildReportPaymentHttpsLink(memberId);
  return {
    text: `\n\nAfter sending Cash App, Zelle, or Venmo, report it in CivicFlow:\n${reportLink}\nIf your email app does not make that clickable, copy/paste it into your browser address bar, or open CivicFlow and go to Report Payment.`,
    html: `<p>After sending Cash App, Zelle, or Venmo, report it in CivicFlow:<br/><a href="${reportLink}">Open Report Payment Form</a><br/><span>${escapeHtml(reportLink)}</span><br/>If your email app does not make that clickable, copy/paste it into your browser address bar, or open CivicFlow and go to <strong>Report Payment</strong>.</p>`,
  };
}

function buildPaymentMethodsForTemplate(org = {}) {
  const rawCashApp = String(org.cashapp_handle || "").trim().replace(/^\$/, "");
  const rawVenmo = String(org.venmo_handle || "").trim().replace(/^@/, "");
  const rawZelle = String(org.zelle_contact || "").trim();

  const zelleText = rawZelle ? `Zelle: ${rawZelle}` : "Zelle";
  const cashAppText = rawCashApp ? `CashApp: $${rawCashApp}` : "CashApp";
  const venmoText = rawVenmo ? `Venmo: @${rawVenmo}` : "Venmo";

  const zelleHtml = rawZelle ? `<strong>Zelle:</strong> ${escapeHtml(rawZelle)}` : "<strong>Zelle</strong>";
  const cashAppHtml = rawCashApp
    ? `<strong>CashApp:</strong> <a href="https://cash.app/$${encodeURIComponent(rawCashApp)}">$${escapeHtml(rawCashApp)}</a>`
    : "<strong>CashApp</strong>";
  const venmoHtml = rawVenmo
    ? `<strong>Venmo:</strong> <a href="https://venmo.com/u/${encodeURIComponent(rawVenmo)}">@${escapeHtml(rawVenmo)}</a>`
    : "<strong>Venmo</strong>";

  return {
    text: `- ${zelleText}\n- ${cashAppText}\n- ${venmoText}`,
    html: `<ul style="margin:0 0 0 20px;padding:0;"><li style="margin:0 0 6px 0;">${zelleHtml}</li><li style="margin:0 0 6px 0;">${cashAppHtml}</li><li style="margin:0 0 6px 0;">${venmoHtml}</li></ul>`,
  };
}

function buildPrefilledReportPaymentUrl({ memberName, memberId, invoiceId, amountDue, dueDate, orgId = "default-org" } = {}) {
  const params = new URLSearchParams();
  if (orgId) params.set("org_id", String(orgId));
  if (memberName) params.set("member_name", String(memberName));
  if (memberName) params.set("member", String(memberName));
  if (memberName) params.set("name", String(memberName));
  if (memberId && Number.isFinite(Number(memberId)) && Number(memberId) > 0) params.set("member_id", String(memberId));
  if (invoiceId && String(invoiceId).trim() && String(invoiceId).trim().toUpperCase() !== "N/A") {
    params.set("invoice_id", String(invoiceId));
    params.set("invoice", String(invoiceId));
    params.set("inv", String(invoiceId));
  }
  if (amountDue && String(amountDue).trim()) {
    params.set("amount", String(amountDue));
    params.set("amount_due", String(amountDue));
    params.set("amt", String(amountDue));
  }
  if (dueDate && String(dueDate).trim() && String(dueDate).trim().toUpperCase() !== "N/A") {
    params.set("due_date", String(dueDate));
  }
  const query = params.toString();
  return query ? `${PRODUCTION_REPORT_PAYMENT_URL}?${query}` : PRODUCTION_REPORT_PAYMENT_URL;
}

function buildReminderInvoiceReference(memberId, dueDate) {
  const id = Number(memberId || 0);
  const safeId = Number.isFinite(id) && id > 0 ? String(id) : "0";
  const normalizedDue = String(dueDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDue)) {
    return `DUES-${safeId}-${normalizedDue.replace(/-/g, "")}`;
  }
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `DUES-${safeId}-${today}`;
}

function tableHasColumn(database, tableName, columnName) {
  try {
    const rows = database.prepare(`PRAGMA table_info(${tableName})`).all();
    return rows.some((row) => String(row?.name || "").toLowerCase() === String(columnName || "").toLowerCase());
  } catch {
    return false;
  }
}

function runAutoArchive(database) {
  const org = database.prepare(`
    SELECT
      auto_archive_enabled,
      auto_archive_events_days,
      auto_archive_campaigns_days
    FROM organization
    WHERE id = 1
  `).get() || {};

  const enabled = Number(org.auto_archive_enabled || 0) === 1;
  if (!enabled) return { enabled: false, archivedEvents: 0, archivedCampaigns: 0 };

  const eventDays = Math.max(0, Number(org.auto_archive_events_days ?? 90) || 90);
  const campaignDays = Math.max(0, Number(org.auto_archive_campaigns_days ?? 90) || 90);

  const archivedEvents = database.prepare(`
    UPDATE events
    SET is_active = 0
    WHERE COALESCE(is_active, 1) = 1
      AND date IS NOT NULL
      AND date(date) <= date('now', '-' || ? || ' day')
  `).run(eventDays).changes;

  const archivedCampaigns = database.prepare(`
    UPDATE campaigns
    SET is_active = 0
    WHERE COALESCE(is_active, 1) = 1
      AND end_date IS NOT NULL
      AND date(end_date) <= date('now', '-' || ? || ' day')
  `).run(campaignDays).changes;

  return { enabled: true, archivedEvents, archivedCampaigns, eventDays, campaignDays };
}

function register(registry, channel, handler) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_event, ...args) => handler(...args));
  registry.add(channel);
}

function registerServiceHandlers() {
  ipcMain.removeHandler("license:getStatus");
  ipcMain.handle("license:getStatus", async () => {
    return licenseService.getLicenseStatus();
  });

  ipcMain.removeHandler("license:refresh");
  ipcMain.handle("license:refresh", async () => {
    return licenseService.refreshLicense();
  });

  ipcMain.removeHandler("license:deactivate");
  ipcMain.handle("license:deactivate", async () => {
    return licenseService.deactivateLicense();
  });

  ipcMain.removeHandler("license:startTrial");
  ipcMain.handle("license:startTrial", async () => {
    return licenseService.startTrial();
  });

  ipcMain.removeHandler("campaigns:list");
  ipcMain.handle("campaigns:list", async () => {
    return await campaignsService.listCampaigns();
  });

  ipcMain.removeHandler("campaigns:create");
  ipcMain.handle("campaigns:create", async (_event, data) => {
    return await campaignsService.createCampaign(data);
  });

  ipcMain.removeHandler("campaigns:delete");
  ipcMain.handle("campaigns:delete", async (_event, id) => {
    return await campaignsService.deleteCampaign(id);
  });

  ipcMain.removeHandler("org:getSetupStatus");
  ipcMain.handle("org:getSetupStatus", async () => {
    return await orgService.getSetupStatus();
  });
}

function defaultForChannel(channel) {
  if (channel === "features:isEnabled") return true;
  if (channel === "features:getEnabled") return {};
  if (channel === "import:templates:list") return { ok: true, templates: [] };
  if (channel === "organization:getSetupStatus") return { completed: false };
  if (channel.endsWith(":list") || channel.includes(":list")) return [];
  if (channel.includes(":get") || channel.startsWith("get-")) return null;
  if (channel.includes(":summary") || channel.endsWith(":kpis")) return {};
  if (channel.includes(":create") || channel.includes(":update") || channel.includes(":delete")) return { success: true };
  if (channel.includes(":archive") || channel.includes(":restore")) return { success: true };
  if (channel.includes("reports:")) return [];
  return { success: true };
}

function registerIpcHandlers() {
  const registry = new Set();
  const database = db();
  const importService = new ImportService(database);
  registerCount += 1;

  registerServiceHandlers();

  try {
    runAutoArchive(database);
  } catch {
  }

  register(registry, "get-dashboard-stats", () => {
    const scalar = (sql, params = [], field = "c") => {
      try {
        const row = database.prepare(sql).get(...params);
        return Number(row?.[field] ?? 0) || 0;
      } catch {
        return 0;
      }
    };

    const activeMemberRows = (() => {
      try {
        return database.prepare("SELECT id FROM members WHERE LOWER(COALESCE(status, 'active')) = 'active' ORDER BY id ASC").all();
      } catch {
        return [];
      }
    })();

    let currentMembers = 0;
    let pastDueMembers = 0;
    let delinquentMembers = 0;
    let totalDuesOutstandingCents = 0;

    for (const row of activeMemberRows) {
      const memberId = Number(row?.id || 0);
      if (!memberId) continue;
      const dues = calculateMemberDuesStatus(memberId);
      const balanceCents = Number(dues?.balanceCents || 0);
      const status = String(dues?.status || "").toLowerCase();

      if (balanceCents < 0) {
        totalDuesOutstandingCents += Math.abs(balanceCents);
        pastDueMembers += 1;
      }

      if (status === "delinquent") {
        delinquentMembers += 1;
      }

      if (balanceCents >= 0) {
        currentMembers += 1;
      }
    }

    const totalMembers = activeMemberRows.length;
    const upcomingEventsCount = scalar("SELECT COUNT(*) AS c FROM events WHERE date(date) BETWEEN date('now') AND date('now', '+30 day')");

    const txnTypeExpr = "CASE WHEN LOWER(COALESCE(type, '')) IN ('dues','dues_payment','invoice','receipt') THEN 'DUES' ELSE UPPER(COALESCE(transaction_type, type, '')) END";
    const txnDateExpr = "date(COALESCE(occurred_on, created_at))";
    const validTxWhere = `COALESCE(is_deleted, 0) = 0 AND ${txnTypeExpr} <> 'GENERAL_CONTRIBUTION' AND (member_id IS NOT NULL OR event_id IS NOT NULL OR campaign_id IS NOT NULL OR UPPER(COALESCE(contributor_type, '')) = 'NON_MEMBER')`;
    const totalTransactionsCents = scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM transactions WHERE ${validTxWhere}`);
    const duesCollectedLast30DaysCents = scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM transactions WHERE ${validTxWhere} AND member_id IS NOT NULL AND amount_cents > 0 AND ${txnTypeExpr} = 'DUES' AND ${txnDateExpr} >= date('now', '-30 day')`);
    const totalDuesCents = scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM transactions WHERE ${validTxWhere} AND member_id IS NOT NULL AND amount_cents > 0 AND ${txnTypeExpr} = 'DUES'`);
    const totalDonationsCents = scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM transactions WHERE ${validTxWhere} AND amount_cents > 0 AND ${txnTypeExpr} = 'DONATION'`);
    const totalCampaignRevenueCents = scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM transactions WHERE ${validTxWhere} AND amount_cents > 0 AND ${txnTypeExpr} = 'CAMPAIGN_CONTRIBUTION'`);
    const totalEventRevenueCents = scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM transactions WHERE ${validTxWhere} AND amount_cents > 0 AND ${txnTypeExpr} = 'EVENT_REVENUE'`);
    const expenseLast30DaysCents = Math.abs(scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM transactions WHERE ${validTxWhere} AND amount_cents < 0 AND ${txnDateExpr} >= date('now', '-30 day')`));

    const expenditureCents = (dateField, rangeSql) => {
      const centsFromCentsColumn = scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenditures WHERE date(${dateField}) >= ${rangeSql}`);
      if (centsFromCentsColumn !== 0) return centsFromCentsColumn;
      const dollars = scalar(`SELECT COALESCE(SUM(amount), 0) AS c FROM expenditures WHERE date(${dateField}) >= ${rangeSql}`);
      return Math.round(dollars * 100);
    };

    const allExpendituresCents = (whereSql, params = []) => {
      const centsFromCentsColumn = scalar(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM expenditures ${whereSql}`, params);
      if (centsFromCentsColumn !== 0) return centsFromCentsColumn;
      const dollars = scalar(`SELECT COALESCE(SUM(amount), 0) AS c FROM expenditures ${whereSql}`, params);
      return Math.round(dollars * 100);
    };

    const totalExpendituresCurrentMonth = expenditureCents("date", "date('now', 'start of month')");
    const totalExpendituresYTD = expenditureCents("date", "date('now', 'start of year')");
    const totalMemberPayouts = allExpendituresCents("WHERE LOWER(COALESCE(payee_type, '')) = 'member'");
    const totalOperationalExpenses = allExpendituresCents("WHERE LOWER(COALESCE(payee_type, '')) <> 'member'");

    const campaignProgress = (() => {
      try {
        return database.prepare(`
          SELECT
            c.id,
            c.name,
            COALESCE(c.goal_amount_cents, 0) AS goal_amount_cents,
            COALESCE(SUM(CASE WHEN COALESCE(t.is_deleted, 0) = 0 THEN t.amount_cents ELSE 0 END), 0) AS raised_cents
          FROM campaigns c
          LEFT JOIN transactions t ON t.campaign_id = c.id
          GROUP BY c.id, c.name, c.goal_amount_cents
          ORDER BY c.id DESC
          LIMIT 10
        `).all();
      } catch {
        return [];
      }
    })();

    const paymentMethodBreakdown = (() => {
      try {
        return database.prepare(`
          SELECT
            COALESCE(payment_method, 'unknown') AS payment_method,
            COUNT(*) AS count,
            COALESCE(SUM(amount_cents), 0) AS total
          FROM transactions
          WHERE COALESCE(is_deleted, 0) = 0
          GROUP BY COALESCE(payment_method, 'unknown')
          ORDER BY total DESC
        `).all();
      } catch {
        return [];
      }
    })();

    return {
      totalMembers,
      currentMembers,
      pastDueMembers,
      delinquentMembers,
      totalDuesOutstandingCents,
      duesCollectedLast30DaysCents,
      expenseLast30DaysCents,
      totalTransactionsCents,
      upcomingEventsCount,
      campaignProgress,
      totalCampaignContributionsCents: totalCampaignRevenueCents,
      totalEventContributionsCents: totalEventRevenueCents,
      totalDuesCents,
      totalDonationsCents,
      totalCampaignRevenueCents,
      totalEventRevenueCents,
      totalExpendituresCurrentMonth,
      totalExpendituresYTD,
      totalMemberPayouts,
      totalOperationalExpenses,
      paymentMethodBreakdown,
    };
  });

  register(registry, "organization:get", () => {
    const row = database.prepare("SELECT * FROM organization WHERE id = 1").get();
    return row || { id: 1, name: "Civicflow" };
  });

  register(registry, "backup:db", async () => {
    try {
      const databaseForBackup = db();
      try {
        databaseForBackup.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
      }

      const sourcePath = getDbPath();
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const suggestedName = `civicflow-backup-${stamp}.db`;

      const save = await dialog.showSaveDialog({
        title: "Save Database Backup",
        defaultPath: path.join(app.getPath("documents"), suggestedName),
        filters: [
          { name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (save.canceled || !save.filePath) {
        return { canceled: true };
      }

      fs.copyFileSync(sourcePath, save.filePath);
      return { success: true, path: save.filePath };
    } catch (err) {
      return { success: false, error: err?.message || "Backup failed." };
    }
  });

  register(registry, "restore:db", async () => {
    const targetDbPath = getDbPath();
    let preRestoreBackupPath = null;
    let stagedRestorePath = null;

    try {
      const open = await dialog.showOpenDialog({
        title: "Select Database Backup to Restore",
        properties: ["openFile"],
        filters: [
          { name: "SQLite Database", extensions: ["db", "sqlite", "sqlite3"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (open.canceled || !Array.isArray(open.filePaths) || open.filePaths.length === 0) {
        return { canceled: true };
      }

      const sourcePath = open.filePaths[0];
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: "Selected backup file does not exist." };
      }

      try {
        const sourceReal = fs.realpathSync(sourcePath);
        const targetReal = fs.existsSync(targetDbPath) ? fs.realpathSync(targetDbPath) : targetDbPath;
        if (sourceReal === targetReal) {
          return { success: false, error: "Selected file is already the active database. Choose a backup file instead." };
        }
      } catch {
      }

      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      preRestoreBackupPath = path.join(path.dirname(targetDbPath), `app.pre-restore-${stamp}.db`);

      const liveDb = getDatabase();
      if (liveDb) {
        try {
          liveDb.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
        }
      }

      if (fs.existsSync(targetDbPath)) {
        fs.copyFileSync(targetDbPath, preRestoreBackupPath);
      }

      closeDatabase();

      stagedRestorePath = `${targetDbPath}.restore.tmp`;
      if (fs.existsSync(stagedRestorePath)) {
        try {
          fs.rmSync(stagedRestorePath, { force: true });
        } catch {
        }
      }

      fs.copyFileSync(sourcePath, stagedRestorePath);

      try {
        if (fs.existsSync(`${targetDbPath}-wal`)) fs.rmSync(`${targetDbPath}-wal`, { force: true });
        if (fs.existsSync(`${targetDbPath}-shm`)) fs.rmSync(`${targetDbPath}-shm`, { force: true });
      } catch {
      }

      if (fs.existsSync(targetDbPath)) {
        try {
          fs.rmSync(targetDbPath, { force: true });
        } catch {
        }
      }

      try {
        fs.renameSync(stagedRestorePath, targetDbPath);
      } catch {
        fs.copyFileSync(stagedRestorePath, targetDbPath);
        try {
          fs.rmSync(stagedRestorePath, { force: true });
        } catch {
        }
      }

      try {
        fs.chmodSync(targetDbPath, 0o666);
      } catch {
      }

      initializeDatabase();
      registerIpcHandlers();

      return {
        success: true,
        restoredFrom: sourcePath,
        safetyBackupPath: preRestoreBackupPath,
      };
    } catch (err) {
      try {
        if (stagedRestorePath && fs.existsSync(stagedRestorePath)) {
          fs.rmSync(stagedRestorePath, { force: true });
        }
      } catch {
      }

      try {
        if (preRestoreBackupPath && fs.existsSync(preRestoreBackupPath)) {
          closeDatabase();
          try {
            if (fs.existsSync(targetDbPath)) fs.rmSync(targetDbPath, { force: true });
          } catch {
          }
          fs.copyFileSync(preRestoreBackupPath, targetDbPath);
        }
      } catch {
      }

      try {
        initializeDatabase();
        registerIpcHandlers();
      } catch {
      }
      const baseError = err?.message || "Restore failed.";
      return { success: false, error: `Restore failed: ${baseError}` };
    }
  });

  register(registry, "organization:set", (data = {}) => {
    database
      .prepare(`
        INSERT INTO organization (
          id,
          name,
          logo_path,
          email_display_name,
          email_from_address,
          payments_enabled,
          stripe_account_id,
          cashapp_handle,
          zelle_contact,
          venmo_handle,
          auto_archive_enabled,
          auto_archive_events_days,
          auto_archive_campaigns_days,
          updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          name = COALESCE(excluded.name, organization.name),
          logo_path = COALESCE(excluded.logo_path, organization.logo_path),
          email_display_name = COALESCE(excluded.email_display_name, organization.email_display_name),
          email_from_address = COALESCE(excluded.email_from_address, organization.email_from_address),
          payments_enabled = COALESCE(excluded.payments_enabled, organization.payments_enabled),
          stripe_account_id = COALESCE(excluded.stripe_account_id, organization.stripe_account_id),
          cashapp_handle = COALESCE(excluded.cashapp_handle, organization.cashapp_handle),
          zelle_contact = COALESCE(excluded.zelle_contact, organization.zelle_contact),
          venmo_handle = COALESCE(excluded.venmo_handle, organization.venmo_handle),
            auto_archive_enabled = COALESCE(excluded.auto_archive_enabled, organization.auto_archive_enabled),
            auto_archive_events_days = COALESCE(excluded.auto_archive_events_days, organization.auto_archive_events_days),
            auto_archive_campaigns_days = COALESCE(excluded.auto_archive_campaigns_days, organization.auto_archive_campaigns_days),
          updated_at = datetime('now')
      `)
      .run(
        data.name ?? null,
        data.logo_path ?? null,
        data.email_display_name ?? null,
        data.email_from_address ?? null,
        data.payments_enabled == null ? null : (data.payments_enabled ? 1 : 0),
        data.stripe_account_id ?? null,
        data.cashapp_handle ?? null,
        data.zelle_contact ?? null,
        data.venmo_handle ?? null,
        data.auto_archive_enabled == null ? null : (data.auto_archive_enabled ? 1 : 0),
        data.auto_archive_events_days == null ? null : Math.max(0, Number(data.auto_archive_events_days) || 0),
        data.auto_archive_campaigns_days == null ? null : Math.max(0, Number(data.auto_archive_campaigns_days) || 0),
      );

    try {
      runAutoArchive(database);
    } catch {
    }

    return { success: true };
  });

  register(registry, "organization:getSetupStatus", () => {
    const row = database.prepare("SELECT setup_completed FROM organization_settings WHERE id = 1").get();
    return { completed: Number(row?.setup_completed ?? 0) === 1 };
  });

  register(registry, "organization:getSettings", () => {
    return database.prepare("SELECT * FROM organization_settings WHERE id = 1").get() || {};
  });

  register(registry, "organization:updateSettings", (data = {}) => {
    database
      .prepare("INSERT INTO organization_settings (id, organization_name, email_from_name, email_from_address, setup_completed, updated_at) VALUES (1, ?, ?, ?, COALESCE(?, 0), datetime('now')) ON CONFLICT(id) DO UPDATE SET organization_name = COALESCE(excluded.organization_name, organization_settings.organization_name), email_from_name = COALESCE(excluded.email_from_name, organization_settings.email_from_name), email_from_address = COALESCE(excluded.email_from_address, organization_settings.email_from_address), setup_completed = COALESCE(excluded.setup_completed, organization_settings.setup_completed), updated_at = datetime('now')")
      .run(data.organization_name ?? null, data.email_from_name ?? null, data.email_from_address ?? null, data.setup_completed ?? null);
    return { success: true };
  });

  register(registry, "organization:completeSetup", () => {
    database.prepare("UPDATE organization_settings SET setup_completed = 1, updated_at = datetime('now') WHERE id = 1").run();
    return { success: true };
  });

  register(registry, "organization:upload-logo", (base64OrPath) => {
    if (!base64OrPath) return { success: false, error: "No logo payload provided" };
    const userData = app.getPath("userData");
    const orgDir = path.join(userData, "logos");
    fs.mkdirSync(orgDir, { recursive: true });
    let logoPath = base64OrPath;
    if (typeof base64OrPath === "string" && base64OrPath.startsWith("data:image/")) {
      const data = base64OrPath.split(",")[1] || "";
      const file = path.join(orgDir, `logo-${Date.now()}.png`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      logoPath = file;
    }
    database.prepare("UPDATE organization SET logo_path = ?, updated_at = datetime('now') WHERE id = 1").run(logoPath);
    return { success: true, logo_path: logoPath };
  });

  register(registry, "db:categories:list", () => database.prepare("SELECT * FROM categories ORDER BY name").all());

  register(registry, "db:categories:create", (data) => {
    const name = typeof data === "string" ? data : data?.name ?? "";
    const dues = typeof data === "object" && data ? Number(data.monthly_dues_cents ?? 0) : 0;
    const result = database.prepare("INSERT OR IGNORE INTO categories (name, monthly_dues_cents) VALUES (?, ?)").run(name, dues);
    if (!result.lastInsertRowid) {
      return database.prepare("SELECT id FROM categories WHERE name = ?").get(name)?.id ?? null;
    }
    return result.lastInsertRowid;
  });

  register(registry, "db:categories:update", (id, updates = {}) => {
    database.prepare("UPDATE categories SET name = COALESCE(?, name), monthly_dues_cents = COALESCE(?, monthly_dues_cents), updated_at = datetime('now') WHERE id = ?").run(updates.name ?? null, updates.monthly_dues_cents ?? null, id);
    return true;
  });

  register(registry, "db:members:list", (filters = {}) => {
    const where = [];
    const params = [];

    const status = String(filters?.status || "").trim().toLowerCase();
    if (status && status !== "all") {
      where.push("LOWER(COALESCE(m.status, 'active')) = ?");
      params.push(status);
    }

    const search = String(filters?.search || "").trim();
    if (search) {
      where.push("(LOWER(COALESCE(m.first_name, '')) LIKE LOWER(?) OR LOWER(COALESCE(m.last_name, '')) LIKE LOWER(?) OR LOWER(COALESCE(m.email, '')) LIKE LOWER(?) OR LOWER(COALESCE(m.phone, '')) LIKE LOWER(?))");
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const city = String(filters?.city || "").trim();
    if (city) {
      where.push("LOWER(COALESCE(m.city, '')) LIKE LOWER(?)");
      params.push(`%${city}%`);
    }

    const state = String(filters?.state || "").trim();
    if (state) {
      where.push("LOWER(COALESCE(m.state, '')) LIKE LOWER(?)");
      params.push(`%${state}%`);
    }

    const zip = String(filters?.zip || "").trim();
    if (zip) {
      where.push("LOWER(COALESCE(m.zip, '')) LIKE LOWER(?)");
      params.push(`%${zip}%`);
    }

    const sortByInput = String(filters?.sortBy || "last_name").trim().toLowerCase();
    const sortDir = String(filters?.sortDir || "asc").trim().toLowerCase() === "desc" ? "DESC" : "ASC";
    const sortExprByKey = {
      last_name: "LOWER(COALESCE(m.last_name, '')), LOWER(COALESCE(m.first_name, '')), m.id",
      first_name: "LOWER(COALESCE(m.first_name, '')), LOWER(COALESCE(m.last_name, '')), m.id",
      join_date: "date(COALESCE(m.join_date, m.created_at, '1970-01-01')), LOWER(COALESCE(m.last_name, '')), LOWER(COALESCE(m.first_name, '')), m.id",
      status: "LOWER(COALESCE(m.status, 'active')), LOWER(COALESCE(m.last_name, '')), LOWER(COALESCE(m.first_name, '')), m.id",
      city: "LOWER(COALESCE(m.city, '')), LOWER(COALESCE(m.last_name, '')), LOWER(COALESCE(m.first_name, '')), m.id",
      created_at: "datetime(COALESCE(m.created_at, '1970-01-01')), LOWER(COALESCE(m.last_name, '')), LOWER(COALESCE(m.first_name, '')), m.id",
    };
    const sortExpr = sortExprByKey[sortByInput] || sortExprByKey.last_name;

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = database.prepare(`
      SELECT m.*, c.name AS category_name
      FROM members m
      LEFT JOIN categories c ON m.category_id = c.id
      ${whereSql}
      ORDER BY ${sortExpr} ${sortDir}
    `).all(...params);

    if (!filters?.includeDuesStatus) {
      return rows;
    }

    return rows.map((member) => {
      try {
        return { ...member, duesStatus: calculateMemberDuesStatus(Number(member.id)) };
      } catch {
        return { ...member, duesStatus: null };
      }
    });
  });
  register(registry, "db:members:get", (id) => database.prepare("SELECT m.*, c.name AS category_name FROM members m LEFT JOIN categories c ON m.category_id = c.id WHERE m.id = ?").get(id) || null);

  register(registry, "email:settings:get", () => {
    const row = getEmailSettingsRow(database) || {};
    return {
      ...row,
      hasPassword: !!String(row.smtp_password_ref || "").trim(),
      smtp_password_ref: undefined,
    };
  });

  register(registry, "email:settings:update", (payload = {}) => {
    database.prepare(`
      INSERT INTO email_settings (
        id, provider, from_name, from_email, smtp_host, smtp_port,
        smtp_secure, smtp_user, smtp_password_ref, enabled, updated_at
      ) VALUES (1, 'SMTP', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        from_name = COALESCE(excluded.from_name, email_settings.from_name),
        from_email = COALESCE(excluded.from_email, email_settings.from_email),
        smtp_host = COALESCE(excluded.smtp_host, email_settings.smtp_host),
        smtp_port = COALESCE(excluded.smtp_port, email_settings.smtp_port),
        smtp_secure = COALESCE(excluded.smtp_secure, email_settings.smtp_secure),
        smtp_user = COALESCE(excluded.smtp_user, email_settings.smtp_user),
        smtp_password_ref = COALESCE(excluded.smtp_password_ref, email_settings.smtp_password_ref),
        enabled = COALESCE(excluded.enabled, email_settings.enabled),
        updated_at = datetime('now')
    `).run(
      payload.from_name ?? null,
      payload.from_email ?? null,
      payload.smtp_host ?? null,
      payload.smtp_port ?? null,
      payload.smtp_secure == null ? null : (payload.smtp_secure ? 1 : 0),
      payload.smtp_user ?? null,
      payload.smtp_password ? String(payload.smtp_password) : null,
      payload.enabled == null ? null : (payload.enabled ? 1 : 0),
    );
    return { success: true };
  });

  register(registry, "email:resolveRecipients", (group = "active") => {
    const normalizedGroup = String(group || "active").trim().toLowerCase();
    const where = ["NULLIF(TRIM(COALESCE(m.email, '')), '') IS NOT NULL"];

    if (normalizedGroup === "active") {
      where.push("LOWER(COALESCE(m.status, 'active')) = 'active'");
    } else if (normalizedGroup === "active_inactive") {
      where.push("LOWER(COALESCE(m.status, 'active')) IN ('active', 'inactive')");
    }

    const rows = database.prepare(`
      SELECT DISTINCT LOWER(TRIM(m.email)) AS email
      FROM members m
      WHERE ${where.join(" AND ")}
      ORDER BY email
    `).all();

    return rows
      .map((row) => String(row?.email || "").trim())
      .filter(Boolean);
  });

  register(registry, "email:queue", async (payload = {}) => {
    let toEmails = String(payload.to_emails || payload.toEmails || "").trim();
    const emailType = String(payload.email_type || payload.emailType || "NOTICE").trim().toUpperCase();
    const subject = String(payload.subject || "").trim();
    if (emailType !== "DUES_REMINDER" && !subject) return { success: false, error: "Subject is required." };
    let bodyText = payload.body_text ?? payload.bodyText ?? null;
    let bodyHtml = payload.body_html ?? payload.bodyHtml ?? null;

    if (emailType === "DUES_REMINDER") {
      const orgId = Number(payload.orgId || payload.organizationId || 1) || 1;
      const recipientGroup = String(payload.recipient_group || payload.recipientGroup || "active").trim().toLowerCase();

      const dueWhere = [
        "NULLIF(TRIM(COALESCE(m.email, '')), '') IS NOT NULL",
      ];
      if (recipientGroup === "active") {
        dueWhere.push("LOWER(COALESCE(m.status, 'active')) = 'active'");
      } else if (recipientGroup === "active_inactive") {
        dueWhere.push("LOWER(COALESCE(m.status, 'active')) IN ('active', 'inactive')");
      }

      const dueCandidates = database.prepare(`
        SELECT
          m.id,
          LOWER(TRIM(m.email)) AS email,
          COALESCE(NULLIF(TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')), ''), 'Member') AS member_name
        FROM members m
        WHERE ${dueWhere.join(" AND ")}
        ORDER BY m.id ASC
      `).all();

      const dueMembers = [];
      for (const row of dueCandidates) {
        const balance = Number(calculateMemberDuesStatus(Number(row.id))?.balanceCents || 0);
        if (balance < 0) {
          dueMembers.push({
            id: Number(row.id),
            email: String(row.email || "").trim(),
            name: String(row.member_name || "Member").trim() || "Member",
            balanceCents: balance,
          });
        }
      }

      if (!dueMembers.length) {
        return { success: false, error: "No members with balance due were found for this group." };
      }

      const org = database.prepare(`
        SELECT
          id,
          name,
          payments_enabled,
          stripe_account_id,
          cashapp_handle,
          zelle_contact,
          venmo_handle
        FROM organization
        WHERE id = ?
      `).get(orgId) || {};

      const stripeEnabled = Number(org.payments_enabled || 0) === 1 && !!String(org.stripe_account_id || "").trim();
      const insertEmail = database.prepare(`
        INSERT INTO email_outbox (
          email_type, to_emails, subject, body_html, body_text, attachments_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED')
      `);

      const ids = [];
      for (const member of dueMembers) {
        let stripeCheckoutUrl = null;
        const amountDue = (Math.abs(Number(member.balanceCents || 0)) / 100).toFixed(2);
        if (stripeEnabled) {
          try {
            const checkout = await createCheckoutSession({
              orgId,
              memberId: member.id,
              amount: amountDue,
              description: `Membership Dues - ${member.name}`,
              type: "DUES",
            });
            if (checkout?.url) stripeCheckoutUrl = String(checkout.url);
          } catch {
          }
        }

        const paymentMethods = buildPaymentMethodsForTemplate(org);
        const dueDate = String(payload.due_date || payload.dueDate || "N/A").trim() || "N/A";
        const invoiceId = String(payload.invoice_id || payload.invoiceId || "").trim() || buildReminderInvoiceReference(member.id, dueDate);
        const reportPaymentUrl = buildPrefilledReportPaymentUrl({
          memberName: member.name,
          memberId: member.id,
          invoiceId,
          amountDue,
          dueDate,
        });
        const rendered = renderPaymentReminder({
          member_name: member.name,
          invoice_id: invoiceId,
          amount_due: amountDue,
          due_date: dueDate,
          organization_name: String(org.name || "CivicFlow").trim() || "CivicFlow",
          payment_methods: paymentMethods,
          report_payment_url: reportPaymentUrl,
          deep_link_url: CIVICFLOW_DEEP_LINK_URL,
        });

        const out = insertEmail.run(
          emailType,
          member.email,
          rendered.subject,
          rendered.html || null,
          rendered.text || null,
          payload.attachments_json ?? payload.attachmentsJson ?? null,
        );
        ids.push(Number(out.lastInsertRowid));
      }

      return { success: true, queued: ids.length, ids };
    }

    if (!toEmails) return { success: false, error: "Recipient email(s) required." };

    const id = database.prepare(`
      INSERT INTO email_outbox (
        email_type, to_emails, subject, body_html, body_text, attachments_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED')
    `).run(
      emailType,
      toEmails,
      subject,
      bodyHtml,
      bodyText,
      payload.attachments_json ?? payload.attachmentsJson ?? null,
    ).lastInsertRowid;

    return { success: true, id };
  });

  register(registry, "email:outbox:list", (filters = {}) => {
    const limit = Math.max(1, Math.min(500, Number(filters?.limit ?? 100) || 100));
    const status = String(filters?.status || "").trim().toUpperCase();
    if (status) {
      return database.prepare("SELECT * FROM email_outbox WHERE status = ? ORDER BY id DESC LIMIT ?").all(status, limit);
    }
    return database.prepare("SELECT * FROM email_outbox ORDER BY id DESC LIMIT ?").all(limit);
  });

  register(registry, "email:send:test", async (toEmail) => {
    const to = String(toEmail || "").trim();
    if (!to) return { error: "Recipient email is required." };
    try {
      const { transport, from } = buildEmailTransport(database);
      await transport.sendMail({
        from,
        to,
        subject: "CivicFlow Test Email",
        text: "This is a test email from CivicFlow.",
        html: "<p>This is a test email from <strong>CivicFlow</strong>.</p>",
      });
      return { success: true };
    } catch (err) {
      return { error: err?.message || "Failed to send test email." };
    }
  });

  register(registry, "email:sendReport", async (data = {}) => {
    try {
      const to = String(data.to || "").trim();
      const subject = String(data.subject || "").trim();
      const pdfBase64 = String(data.pdfBase64 || "").trim();
      if (!to) return { success: false, error: "Recipient email is required." };
      if (!subject) return { success: false, error: "Subject is required." };
      if (!pdfBase64) return { success: false, error: "Report attachment is required." };

      const { transport, from } = buildEmailTransport(database);
      await transport.sendMail({
        from,
        to,
        cc: data.cc || undefined,
        bcc: data.bcc || undefined,
        subject,
        text: String(data.bodyText || "").trim() || undefined,
        html: String(data.bodyHtml || "").trim() || undefined,
        attachments: [
          {
            filename: data.pdfFilename || "Report.pdf",
            content: Buffer.from(pdfBase64, "base64"),
            contentType: "application/pdf",
          },
        ],
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || "Failed to send report email." };
    }
  });

  register(registry, "email:sendReportToAllMembers", async (data = {}) => {
    try {
      const reportType = String(data.reportType || "").trim();
      const subject = String(data.subject || "").trim();
      if (!reportType) return { success: false, error: "reportType is required." };
      if (!subject) return { success: false, error: "subject is required." };

      const recipients = database.prepare(`
        SELECT DISTINCT LOWER(TRIM(email)) AS email
        FROM members
        WHERE NULLIF(TRIM(COALESCE(email, '')), '') IS NOT NULL
          AND LOWER(COALESCE(status, 'active')) IN ('active','inactive')
        ORDER BY email
      `).all().map((row) => row.email).filter(Boolean);

      if (!recipients.length) {
        return { success: false, error: "No members with email addresses found." };
      }

      const p = data.params || {};
      let startDate = p.startDate;
      let endDate = p.endDate;
      if ((!startDate || !endDate) && reportType === "member_monthly" && p.month) {
        const range = monthToRange(p.month);
        if (range) {
          startDate = range.startDate;
          endDate = range.endDate;
        }
      }
      const range = normalizeDateRange(startDate, endDate);
      const pdf = await buildPeriodReportPDF(database, range.startDate, range.endDate, reportType);

      const { transport, from } = buildEmailTransport(database);
      const bodyText = String(data.bodyText || "").trim() || "Please see attached report.";
      const bodyHtml = String(data.bodyHtml || "").trim() || `<p>${bodyText.replace(/\n/g, "<br>")}</p>`;

      let sent = 0;
      const errors = [];
      for (const email of recipients) {
        try {
          await transport.sendMail({
            from,
            to: email,
            subject,
            text: bodyText,
            html: bodyHtml,
            attachments: [
              {
                filename: `${reportType}_${range.startDate}_to_${range.endDate}.pdf`,
                content: pdf,
                contentType: "application/pdf",
              },
            ],
          });
          sent += 1;
        } catch (err) {
          errors.push({ email, error: err?.message || "Send failed" });
        }
      }

      if (!sent) {
        return { success: false, error: errors[0]?.error || "Failed to send report emails.", sent: 0, failed: recipients.length, errors };
      }
      return { success: true, sent, failed: recipients.length - sent, errors };
    } catch (err) {
      return { success: false, error: err?.message || "Failed to send bulk report emails." };
    }
  });

  register(registry, "email:sendDuesReminder", async (member = {}) => {
    try {
      const memberId = Number(member.id || member.memberId || 0);
      const to = String(member.email || "").trim();
      if (!memberId) return { success: false, error: "Member id is required." };
      if (!to) return { success: false, error: "Member email is required." };

      const dues = calculateMemberDuesStatus(memberId);
      const balance = Number(dues?.balanceCents || 0);
      if (balance >= 0) {
        return { success: true, skipped: true };
      }

      const amountDueCents = Math.abs(balance);
      const amountDue = (amountDueCents / 100).toFixed(2);
      const memberName = String(member.name || "").trim() || "Member";
      const orgId = Number(member.orgId || member.organizationId || 1) || 1;

      const org = database.prepare(`
        SELECT
          id,
          name,
          payments_enabled,
          stripe_account_id,
          cashapp_handle,
          zelle_contact,
          venmo_handle
        FROM organization
        WHERE id = ?
      `).get(orgId) || {};

      let stripeCheckoutUrl = null;
      const stripeEnabled = Number(org.payments_enabled || 0) === 1 && String(org.stripe_account_id || "").trim();
      if (stripeEnabled) {
        try {
          const checkout = await createCheckoutSession({
            orgId,
            memberId,
            amount: amountDue,
            description: `Membership Dues - ${memberName}`,
            type: "DUES",
          });
          if (checkout?.url) stripeCheckoutUrl = String(checkout.url);
        } catch {
        }
      }

      const paymentMethods = buildPaymentMethodsForTemplate(org);
      const dueDate = String(member.due_date || member.dueDate || "N/A").trim() || "N/A";
      const invoiceId = String(member.invoice_id || member.invoiceId || "").trim() || buildReminderInvoiceReference(memberId, dueDate);
      const reportPaymentUrl = buildPrefilledReportPaymentUrl({
        memberName,
        memberId,
        invoiceId,
        amountDue,
        dueDate,
      });
      const rendered = renderPaymentReminder({
        member_name: memberName,
        invoice_id: invoiceId,
        amount_due: amountDue,
        due_date: dueDate,
        organization_name: String(org.name || "CivicFlow").trim() || "CivicFlow",
        payment_methods: paymentMethods,
        report_payment_url: reportPaymentUrl,
        deep_link_url: CIVICFLOW_DEEP_LINK_URL,
      });

      const { transport, from } = buildEmailTransport(database);
      await transport.sendMail({
        from,
        to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });

      return { success: true, skipped: false };
    } catch (err) {
      return { success: false, error: err?.message || "Failed to send dues reminder." };
    }
  });

  register(registry, "email:processOutbox", async () => {
    const queued = database.prepare("SELECT * FROM email_outbox WHERE status = 'QUEUED' ORDER BY id ASC LIMIT 100").all();
    if (!queued.length) {
      return { success: true, processed: 0, sent: 0, failed: 0, message: "No queued emails to process." };
    }

    let transport = null;
    let from = null;
    let transportError = null;
    try {
      const built = buildEmailTransport(database);
      transport = built.transport;
      from = built.from;
    } catch (err) {
      transportError = err?.message || "Email transport unavailable.";
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const email of queued) {
      const to = String(email.to_emails || "").trim();
      if (!to) {
        failed += 1;
        const errMsg = "Missing recipient email(s).";
        errors.push({ id: email.id, error: errMsg });
        database.prepare("UPDATE email_outbox SET status = 'FAILED', error = ? WHERE id = ?").run(errMsg, email.id);
        continue;
      }

      if (!transport) {
        failed += 1;
        errors.push({ id: email.id, error: transportError });
        database.prepare("UPDATE email_outbox SET status = 'FAILED', error = ? WHERE id = ?").run(transportError, email.id);
        continue;
      }

      try {
        let finalText = email.body_text || undefined;
        let finalHtml = email.body_html || undefined;
        let finalSubject = String(email.subject || "").trim();

        if (String(email.email_type || "").trim().toUpperCase() === "DUES_REMINDER") {
          const firstRecipient = String(to.split(",")[0] || "").trim().toLowerCase();
          const recipientMember = firstRecipient
            ? database.prepare(`
                SELECT id,
                invoice_id,
                       COALESCE(NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), 'Member') AS member_name
                FROM members
                WHERE LOWER(TRIM(COALESCE(email, ''))) = ?
                ORDER BY id DESC
                LIMIT 1
              `).get(firstRecipient)
            : null;

          const org = database.prepare(`
            SELECT id, name, payments_enabled, stripe_account_id, cashapp_handle, zelle_contact, venmo_handle
            FROM organization
            WHERE id = 1
          `).get() || {};

          let stripeCheckoutUrl = null;
          const stripeEnabled = Number(org.payments_enabled || 0) === 1 && !!String(org.stripe_account_id || "").trim();

          if (stripeEnabled && recipientMember?.id) {
            try {
              const balanceCents = Number(calculateMemberDuesStatus(Number(recipientMember.id))?.balanceCents || 0);
              if (balanceCents < 0) {
                const amountDue = (Math.abs(balanceCents) / 100).toFixed(2);
                const checkout = await createCheckoutSession({
                  orgId: 1,
                  memberId: Number(recipientMember.id),
                  amount: amountDue,
                  description: `Membership Dues - ${String(recipientMember.member_name || "Member")}`,
                  type: "DUES",
                });
                if (checkout?.url) stripeCheckoutUrl = String(checkout.url);
              }
            } catch {
            }
          }

          const paymentMethods = buildPaymentMethodsForTemplate(org);
          const balanceCents = recipientMember?.id
            ? Number(calculateMemberDuesStatus(Number(recipientMember.id))?.balanceCents || 0)
            : 0;
          const amountDue = balanceCents < 0 ? (Math.abs(balanceCents) / 100).toFixed(2) : "0.00";
          const dueDate = "N/A";
          const invoiceId = String(recipientMember?.invoice_id || "").trim() || buildReminderInvoiceReference(recipientMember?.id, dueDate);
          const reportPaymentUrl = buildPrefilledReportPaymentUrl({
            memberName: String(recipientMember?.member_name || "Member").trim() || "Member",
            memberId: recipientMember?.id,
            invoiceId,
            amountDue,
            dueDate,
          });
          const rendered = renderPaymentReminder({
            member_name: String(recipientMember?.member_name || "Member").trim() || "Member",
            invoice_id: invoiceId,
            amount_due: amountDue,
            due_date: dueDate,
            organization_name: String(org.name || "CivicFlow").trim() || "CivicFlow",
            payment_methods: paymentMethods,
            report_payment_url: reportPaymentUrl,
            deep_link_url: CIVICFLOW_DEEP_LINK_URL,
          });

          finalSubject = rendered.subject;
          finalText = rendered.text;
          finalHtml = rendered.html;
        }

        await transport.sendMail({
          from,
          to,
          subject: finalSubject || email.subject,
          text: finalText,
          html: finalHtml,
        });
        sent += 1;
        database.prepare("UPDATE email_outbox SET status = 'SENT', error = NULL, sent_at = datetime('now') WHERE id = ?").run(email.id);
      } catch (err) {
        failed += 1;
        const errMsg = err?.message || "Send failed.";
        errors.push({ id: email.id, error: errMsg });
        database.prepare("UPDATE email_outbox SET status = 'FAILED', error = ? WHERE id = ?").run(errMsg, email.id);
      }
    }

    return { success: true, processed: queued.length, sent, failed, errors };
  });
  register(registry, "db:members:create", (member = {}) => database.prepare("INSERT INTO members (first_name, last_name, email, phone, address, city, state, zip, category_id, status, join_date, dob) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(member.first_name ?? "", member.last_name ?? "", member.email ?? null, member.phone ?? null, member.address ?? null, member.city ?? null, member.state ?? null, member.zip ?? null, member.category_id ?? null, member.status ?? "active", member.join_date ?? null, member.dob ?? null).lastInsertRowid);
  register(registry, "db:members:update", (id, member = {}) => {
    database.prepare("UPDATE members SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), email = COALESCE(?, email), phone = COALESCE(?, phone), address = COALESCE(?, address), city = COALESCE(?, city), state = COALESCE(?, state), zip = COALESCE(?, zip), category_id = COALESCE(?, category_id), status = COALESCE(?, status), join_date = COALESCE(?, join_date), dob = COALESCE(?, dob), updated_at = datetime('now') WHERE id = ?").run(member.first_name ?? null, member.last_name ?? null, member.email ?? null, member.phone ?? null, member.address ?? null, member.city ?? null, member.state ?? null, member.zip ?? null, member.category_id ?? null, member.status ?? null, member.join_date ?? null, member.dob ?? null, id);
    return true;
  });
  register(registry, "db:members:archive", (id) => !!database.prepare("UPDATE members SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(id));
  register(registry, "db:members:restore", (id) => !!database.prepare("UPDATE members SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id));
  register(registry, "db:members:deletePermanent", (id) => {
    const memberId = Number(id || 0);
    if (!memberId) return { success: false, error: "Missing member id" };

    const member = database.prepare("SELECT id, first_name, last_name FROM members WHERE id = ?").get(memberId);
    if (!member) return { success: false, error: "Member not found" };

    const fullName = [member.first_name, member.last_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || null;

    const runDelete = database.transaction(() => {
      database.prepare(`
        UPDATE transactions
        SET
          contributor_name = COALESCE(NULLIF(TRIM(COALESCE(contributor_name, '')), ''), ?),
          contributor_type = CASE WHEN ? = member_id THEN 'NON_MEMBER' ELSE COALESCE(contributor_type, 'NON_MEMBER') END,
          member_id = CASE WHEN ? = member_id THEN NULL ELSE member_id END,
          updated_at = datetime('now')
        WHERE member_id = ?
      `).run(fullName, memberId, memberId, memberId);

      return database.prepare("DELETE FROM members WHERE id = ?").run(memberId).changes > 0;
    });

    const deleted = runDelete();
    if (!deleted) return { success: false, error: "Failed to delete member." };
    return { success: true };
  });

  register(registry, "admin:listOrphanTransactions", () => {
    return database.prepare(`
      SELECT
        t.id,
        t.occurred_on,
        t.type,
        t.transaction_type,
        t.amount_cents,
        t.note,
        t.status,
        t.member_id,
        t.campaign_id,
        t.event_id,
        t.contributor_name,
        m.first_name,
        m.last_name,
        c.name AS campaign_name,
        e.name AS event_name,
        CASE
          WHEN t.member_id IS NULL OR m.id IS NULL THEN 'ORPHAN'
          ELSE 'ASSIGNED'
        END AS attribution_status,
        COALESCE(
          NULLIF(TRIM(COALESCE(t.contributor_name, '')), ''),
          NULLIF(TRIM(COALESCE(t.note, '')), '')
        ) AS previous_contributor_name,
        NULL AS suggested_member_id
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      LEFT JOIN campaigns c ON c.id = t.campaign_id
      LEFT JOIN events e ON e.id = t.event_id
      WHERE COALESCE(t.is_deleted, 0) = 0
        AND (t.member_id IS NULL OR m.id IS NULL)
      ORDER BY date(t.occurred_on) DESC, t.id DESC
    `).all();
  });

  register(registry, "admin:assignOrphanTransaction", (transactionId, memberId) => {
    const txnId = Number(transactionId || 0);
    const nextMemberId = Number(memberId || 0);
    if (!txnId) return { success: false, error: "Missing transaction id" };
    if (!nextMemberId) return { success: false, error: "Missing member id" };

    const txn = database.prepare("SELECT id FROM transactions WHERE id = ? AND COALESCE(is_deleted, 0) = 0").get(txnId);
    if (!txn) return { success: false, error: "Transaction not found" };

    const targetMember = database.prepare("SELECT id, first_name, last_name FROM members WHERE id = ?").get(nextMemberId);
    if (!targetMember) return { success: false, error: "Member not found" };

    const result = database.prepare(`
      UPDATE transactions
      SET
        member_id = ?,
        contributor_type = 'MEMBER',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(nextMemberId, txnId);

    if (!result.changes) return { success: false, error: "No transaction updated" };
    return { success: true, transactionId: txnId, memberId: nextMemberId };
  });

  register(registry, "db:events:list", () => {
    if (tableHasColumn(database, "events", "is_active")) {
      return database.prepare("SELECT * FROM events WHERE COALESCE(is_active, 1) = 1 ORDER BY date DESC, id DESC").all();
    }
    return database.prepare("SELECT * FROM events ORDER BY date DESC, id DESC").all();
  });
  register(registry, "db:events:listActive", () => {
    if (tableHasColumn(database, "events", "is_active")) {
      return database.prepare("SELECT * FROM events WHERE COALESCE(is_active, 1) = 1 ORDER BY date DESC, id DESC").all();
    }
    return database.prepare("SELECT * FROM events ORDER BY date DESC, id DESC").all();
  });
  register(registry, "db:events:get", (id) => database.prepare("SELECT * FROM events WHERE id = ?").get(id) || null);
  register(registry, "db:events:create", (event = {}) => database.prepare("INSERT INTO events (name, date, location, notes) VALUES (?, ?, ?, ?)").run(event.name ?? event.title ?? "", event.date ?? event.event_date ?? new Date().toISOString().slice(0, 10), event.location ?? null, event.notes ?? null).lastInsertRowid);
  register(registry, "db:events:update", (id, updates = {}) => {
    database.prepare("UPDATE events SET name = COALESCE(?, name), date = COALESCE(?, date), location = COALESCE(?, location), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?").run(updates.name ?? updates.title ?? null, updates.date ?? updates.event_date ?? null, updates.location ?? null, updates.notes ?? null, id);
    return true;
  });
  register(registry, "db:events:archive", (id) => {
    if (tableHasColumn(database, "events", "is_active")) {
      return database.prepare("UPDATE events SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id).changes > 0;
    }
    return database.prepare("DELETE FROM events WHERE id = ?").run(id).changes > 0;
  });

  register(registry, "db:campaigns:list", () => {
    if (tableHasColumn(database, "campaigns", "is_active")) {
      return database.prepare("SELECT * FROM campaigns WHERE COALESCE(is_active, 1) = 1 ORDER BY COALESCE(start_date, created_at) DESC, id DESC").all();
    }
    return database.prepare("SELECT * FROM campaigns ORDER BY COALESCE(start_date, created_at) DESC, id DESC").all();
  });
  register(registry, "db:campaigns:listActive", () => {
    if (tableHasColumn(database, "campaigns", "is_active")) {
      return database.prepare("SELECT * FROM campaigns WHERE COALESCE(is_active, 1) = 1 AND (end_date IS NULL OR date(end_date) >= date('now')) ORDER BY name").all();
    }
    return database.prepare("SELECT * FROM campaigns WHERE end_date IS NULL OR date(end_date) >= date('now') ORDER BY name").all();
  });
  register(registry, "db:campaigns:create", (campaign = {}) => database.prepare("INSERT INTO campaigns (name, start_date, end_date, notes, goal_amount_cents) VALUES (?, ?, ?, ?, ?)").run(campaign.name ?? "", campaign.start_date ?? null, campaign.end_date ?? null, campaign.notes ?? null, Number(campaign.goal_amount_cents ?? 0)).lastInsertRowid);
  register(registry, "db:campaigns:update", (id, updates = {}) => {
    database.prepare("UPDATE campaigns SET name = COALESCE(?, name), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), notes = COALESCE(?, notes), goal_amount_cents = COALESCE(?, goal_amount_cents), updated_at = datetime('now') WHERE id = ?").run(updates.name ?? null, updates.start_date ?? null, updates.end_date ?? null, updates.notes ?? null, updates.goal_amount_cents ?? null, id);
    return true;
  });
  register(registry, "db:campaigns:archive", (id) => {
    if (tableHasColumn(database, "campaigns", "is_active")) {
      return database.prepare("UPDATE campaigns SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id).changes > 0;
    }
    return database.prepare("DELETE FROM campaigns WHERE id = ?").run(id).changes > 0;
  });

  register(registry, "db:transactions:list", (filters = {}) => {
    const where = [
      "COALESCE(t.is_deleted, 0) = 0",
      "UPPER(COALESCE(t.transaction_type, '')) <> 'GENERAL_CONTRIBUTION'",
      "UPPER(COALESCE(t.type, '')) <> 'GENERAL_CONTRIBUTION'",
      "(t.member_id IS NOT NULL OR t.event_id IS NOT NULL OR t.campaign_id IS NOT NULL OR UPPER(COALESCE(t.contributor_type, '')) = 'NON_MEMBER')",
    ];
    const params = [];
    if (filters.startDate) {
      where.push("date(t.occurred_on) >= date(?)");
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      where.push("date(t.occurred_on) <= date(?)");
      params.push(filters.endDate);
    }
    if (filters.type) {
      where.push("(COALESCE(t.transaction_type, '') = ? OR COALESCE(t.type, '') = ?)");
      params.push(filters.type, filters.type);
    }
    const sql = `
      SELECT t.*, m.first_name AS member_first_name, m.last_name AS member_last_name,
             c.name AS campaign_name, e.name AS event_name
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      LEFT JOIN campaigns c ON c.id = t.campaign_id
      LEFT JOIN events e ON e.id = t.event_id
      WHERE ${where.join(" AND ")}
      ORDER BY t.occurred_on DESC, t.id DESC
    `;
    return database.prepare(sql).all(...params);
  });
  register(registry, "db:transactions:create", (txn = {}) => {
    const normalizedTxnType = normalizeTransactionType(txn.transaction_type ?? txn.txn_type ?? txn.type ?? "DONATION");
    const normalizedType = mapTxnTypeToLedgerType(txn.type ?? normalizedTxnType);
    const attribution = validateContributionAttribution(database, txn, { allowNonMember: true, requireNonMemberName: false });
    ensureDuesAttributedToMember(normalizedTxnType, attribution);
    return database.prepare("INSERT INTO transactions (type, transaction_type, amount_cents, occurred_on, member_id, event_id, campaign_id, note, contributor_name, contributor_email, payment_method, status, contributor_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(normalizedType, normalizedTxnType, toCents(txn.amount_cents ?? txn.amount), txn.occurred_on ?? txn.date ?? new Date().toISOString().slice(0, 10), attribution.memberId, attribution.eventId, attribution.campaignId, txn.note ?? null, attribution.contributorName ?? (txn.contributor_name ?? null), txn.contributor_email ?? null, txn.payment_method ?? null, txn.status ?? "COMPLETED", attribution.contributorType).lastInsertRowid;
  });
  register(registry, "db:transactions:update", (id, updates = {}) => {
    const normalizedTxnType = updates.transaction_type || updates.txn_type || updates.type
      ? normalizeTransactionType(updates.transaction_type ?? updates.txn_type ?? updates.type)
      : null;
    const normalizedType = updates.type || normalizedTxnType
      ? mapTxnTypeToLedgerType(updates.type ?? normalizedTxnType)
      : null;
    database.prepare("UPDATE transactions SET type = COALESCE(?, type), transaction_type = COALESCE(?, transaction_type), amount_cents = COALESCE(?, amount_cents), occurred_on = COALESCE(?, occurred_on), member_id = COALESCE(?, member_id), event_id = COALESCE(?, event_id), campaign_id = COALESCE(?, campaign_id), note = COALESCE(?, note), payment_method = COALESCE(?, payment_method), status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?").run(normalizedType, normalizedTxnType, updates.amount_cents != null || updates.amount != null ? toCents(updates.amount_cents ?? updates.amount) : null, updates.occurred_on ?? updates.date ?? null, updates.member_id ?? null, updates.event_id ?? null, updates.campaign_id ?? null, updates.note ?? null, updates.payment_method ?? null, updates.status ?? null, id);
    return true;
  });
  register(registry, "db:transactions:delete", (id) => database.prepare("UPDATE transactions SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?").run(id).changes > 0);

  register(registry, "transaction:getById", (id) => database.prepare("SELECT * FROM transactions WHERE id = ?").get(id) || null);
  register(registry, "transaction:update", (data = {}) => {
    if (!data.id) return { success: false, error: "Missing id" };
    const normalizedTxnType = data.transaction_type || data.txn_type || data.type
      ? normalizeTransactionType(data.transaction_type ?? data.txn_type ?? data.type)
      : null;
    const normalizedType = data.type || normalizedTxnType
      ? mapTxnTypeToLedgerType(data.type ?? normalizedTxnType)
      : null;
    database.prepare("UPDATE transactions SET type = COALESCE(?, type), transaction_type = COALESCE(?, transaction_type), amount_cents = COALESCE(?, amount_cents), occurred_on = COALESCE(?, occurred_on), member_id = COALESCE(?, member_id), event_id = COALESCE(?, event_id), campaign_id = COALESCE(?, campaign_id), note = COALESCE(?, note), payment_method = COALESCE(?, payment_method), status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?").run(normalizedType, normalizedTxnType, data.amount_cents != null || data.amount != null ? toCents(data.amount_cents ?? data.amount) : null, data.occurred_on ?? data.date ?? null, data.member_id ?? null, data.event_id ?? null, data.campaign_id ?? null, data.note ?? null, data.payment_method ?? null, data.status ?? null, data.id);
    return { success: true };
  });
  register(registry, "transaction:addManualPayment", (data = {}) => {
    const attribution = validateContributionAttribution(database, data, { allowNonMember: true, requireNonMemberName: true });
    const paymentMethod = data.payment_method ?? data.method ?? null;
    const note = data.note ?? data.notes ?? null;
    const normalizedTxnType = normalizeTransactionType(data.transaction_type ?? data.type ?? "DUES");
    ensureDuesAttributedToMember(normalizedTxnType, attribution);
    const normalizedType = mapTxnTypeToLedgerType(normalizedTxnType);
    const id = database.prepare("INSERT INTO transactions (type, transaction_type, amount_cents, occurred_on, member_id, campaign_id, event_id, note, payment_method, status, contributor_type, contributor_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(normalizedType, normalizedTxnType, toCents(data.amount_cents ?? data.amount), data.occurred_on ?? data.date ?? new Date().toISOString().slice(0, 10), attribution.memberId, attribution.campaignId, attribution.eventId, note, paymentMethod ?? "manual", data.status ?? "COMPLETED", attribution.contributorType, attribution.contributorName ?? data.contributor_name ?? data.contributorName ?? null).lastInsertRowid;
    return { success: true, id };
  });

  register(registry, "finance:txns:list", (memberId, includeVoided = false) => {
    if (!memberId) return [];
    const sql = includeVoided
      ? `SELECT t.id, t.member_id, t.amount_cents, t.occurred_on AS txn_date,
             CASE
               WHEN LOWER(COALESCE(t.type, '')) IN ('dues','dues_payment','invoice','receipt') THEN 'DUES'
               WHEN UPPER(COALESCE(t.transaction_type, '')) <> '' THEN UPPER(COALESCE(t.transaction_type, ''))
               WHEN UPPER(COALESCE(t.type, '')) <> '' THEN UPPER(COALESCE(t.type, ''))
               ELSE 'DONATION'
             END AS txn_type,
             t.reference, t.note AS notes, t.payment_method, t.status, COALESCE(t.is_deleted, 0) AS is_deleted, t.deleted_at,
             t.campaign_id, t.event_id, c.name AS campaign_name, e.name AS event_name
        FROM transactions t
        LEFT JOIN campaigns c ON c.id = t.campaign_id
        LEFT JOIN events e ON e.id = t.event_id
          WHERE t.member_id = ?
          ORDER BY date(t.occurred_on) DESC, t.id DESC`
      : `SELECT t.id, t.member_id, t.amount_cents, t.occurred_on AS txn_date,
             CASE
               WHEN LOWER(COALESCE(t.type, '')) IN ('dues','dues_payment','invoice','receipt') THEN 'DUES'
               WHEN UPPER(COALESCE(t.transaction_type, '')) <> '' THEN UPPER(COALESCE(t.transaction_type, ''))
               WHEN UPPER(COALESCE(t.type, '')) <> '' THEN UPPER(COALESCE(t.type, ''))
               ELSE 'DONATION'
             END AS txn_type,
             t.reference, t.note AS notes, t.payment_method, t.status, COALESCE(t.is_deleted, 0) AS is_deleted, t.deleted_at,
             t.campaign_id, t.event_id, c.name AS campaign_name, e.name AS event_name
        FROM transactions t
        LEFT JOIN campaigns c ON c.id = t.campaign_id
        LEFT JOIN events e ON e.id = t.event_id
          WHERE t.member_id = ? AND COALESCE(t.is_deleted, 0) = 0
          ORDER BY date(t.occurred_on) DESC, t.id DESC`;
    return database.prepare(sql).all(memberId);
  });

  register(registry, "finance:txns:getById", (id) => {
    if (!id) return null;
    return database.prepare(`
      SELECT id,
             member_id,
             amount_cents,
             occurred_on AS txn_date,
             CASE
               WHEN LOWER(COALESCE(type, '')) IN ('dues','dues_payment','invoice','receipt') THEN 'DUES'
               WHEN UPPER(COALESCE(transaction_type, '')) <> '' THEN UPPER(COALESCE(transaction_type, ''))
               WHEN UPPER(COALESCE(type, '')) <> '' THEN UPPER(COALESCE(type, ''))
               ELSE 'DONATION'
             END AS txn_type,
             reference,
             note AS notes,
             payment_method,
             status,
             COALESCE(is_deleted, 0) AS is_deleted,
             deleted_at
      FROM transactions
      WHERE id = ?
    `).get(id) || null;
  });

  register(registry, "finance:txns:create", (data = {}) => {
    const attribution = validateContributionAttribution(database, data, { allowNonMember: true, requireNonMemberName: true });
    const amount = toCents(data.amount_cents ?? data.amount);
    const txnType = normalizeTransactionType(data.txn_type ?? data.transaction_type ?? data.type ?? "DONATION");
    ensureDuesAttributedToMember(txnType, attribution);
    if (!Number.isFinite(amount) || amount === 0) return { success: false, error: "Amount must be non-zero" };

    const id = database.prepare(`
      INSERT INTO transactions (
        type,
        transaction_type,
        amount_cents,
        occurred_on,
        member_id,
        reference,
        note,
        payment_method,
        status,
        contributor_type,
        is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      mapTxnTypeToLedgerType(txnType),
      txnType,
      amount,
      data.txn_date ?? data.date ?? data.occurred_on ?? new Date().toISOString().slice(0, 10),
      attribution.memberId,
      data.reference ?? null,
      data.notes ?? data.note ?? null,
      String(data.payment_method || "manual").toUpperCase(),
      data.status ?? "COMPLETED",
      attribution.contributorType,
    ).lastInsertRowid;

    return { success: true, id };
  });

  register(registry, "finance:txns:update", (id, updates = {}) => {
    if (!id) return { success: false, error: "Missing id" };
    const txnType = updates.txn_type || updates.transaction_type || updates.type;
    const normalizedType = txnType ? normalizeTransactionType(txnType) : null;
    database.prepare(`
      UPDATE transactions
      SET transaction_type = COALESCE(?, transaction_type),
          type = COALESCE(?, type),
          amount_cents = COALESCE(?, amount_cents),
          occurred_on = COALESCE(?, occurred_on),
          reference = COALESCE(?, reference),
          note = COALESCE(?, note),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      normalizedType,
      normalizedType ? mapTxnTypeToLedgerType(normalizedType) : null,
      updates.amount_cents != null || updates.amount != null ? toCents(updates.amount_cents ?? updates.amount) : null,
      updates.txn_date ?? updates.date ?? updates.occurred_on ?? null,
      updates.reference ?? null,
      updates.notes ?? updates.note ?? null,
      id,
    );
    return { success: true };
  });

  register(registry, "finance:txns:updateNotes", (id, notes) => {
    if (!id) return { success: false, error: "Missing id" };
    database.prepare("UPDATE transactions SET note = ?, updated_at = datetime('now') WHERE id = ?").run(notes ?? null, id);
    return { success: true };
  });

  register(registry, "finance:txns:reverse", (id, reason, date) => {
    const original = database.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
    if (!original) return { success: false, error: "Original transaction not found" };
    const reversalNote = ["REVERSAL", reason ? `Reason: ${reason}` : null, `Reverses #${id}`].filter(Boolean).join(" | ");
    const reversalId = database.prepare(`
      INSERT INTO transactions (
        type, transaction_type, amount_cents, occurred_on, member_id, event_id, campaign_id,
        reference, note, payment_method, status, contributor_type, contributor_name, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      original.type,
      original.transaction_type,
      -Math.abs(Number(original.amount_cents || 0)),
      date || new Date().toISOString().slice(0, 10),
      original.member_id,
      original.event_id,
      original.campaign_id,
      original.reference || null,
      reversalNote,
      original.payment_method,
      "COMPLETED",
      original.contributor_type,
      original.contributor_name,
    ).lastInsertRowid;
    return { success: true, id: reversalId };
  });

  register(registry, "finance:txns:delete", (id) => {
    if (!id) return { success: false, error: "Missing id" };
    database.prepare("UPDATE transactions SET is_deleted = 1, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  register(registry, "finance:txns:correct", (originalId, correctAmount, correctDate, reason) => {
    const original = database.prepare("SELECT * FROM transactions WHERE id = ?").get(originalId);
    if (!original) return { success: false, error: "Original transaction not found" };
    const amount = toCents(correctAmount);
    if (!Number.isFinite(amount) || amount === 0) return { success: false, error: "Correct amount is required" };
    const note = [reason ? `Correction: ${reason}` : "Correction", `Original #${originalId}`].join(" | ");
    const id = database.prepare(`
      INSERT INTO transactions (
        type, transaction_type, amount_cents, occurred_on, member_id, event_id, campaign_id,
        reference, note, payment_method, status, contributor_type, contributor_name, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      original.type,
      original.transaction_type,
      amount,
      correctDate || new Date().toISOString().slice(0, 10),
      original.member_id,
      original.event_id,
      original.campaign_id,
      original.reference || null,
      note,
      original.payment_method,
      "COMPLETED",
      original.contributor_type,
      original.contributor_name,
    ).lastInsertRowid;
    return { success: true, id };
  });

  register(registry, "finance:txns:adjust", (originalId, deltaAmount, reason) => {
    const original = database.prepare("SELECT * FROM transactions WHERE id = ?").get(originalId);
    if (!original) return { success: false, error: "Original transaction not found" };
    const delta = toCents(deltaAmount);
    if (!Number.isFinite(delta) || delta === 0) return { success: false, error: "Adjustment amount is required" };
    const note = [reason ? `Adjustment: ${reason}` : "Adjustment", `Original #${originalId}`].join(" | ");
    const id = database.prepare(`
      INSERT INTO transactions (
        type, transaction_type, amount_cents, occurred_on, member_id, event_id, campaign_id,
        reference, note, payment_method, status, contributor_type, contributor_name, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      original.type,
      original.transaction_type,
      delta,
      new Date().toISOString().slice(0, 10),
      original.member_id,
      original.event_id,
      original.campaign_id,
      original.reference || null,
      note,
      original.payment_method,
      "COMPLETED",
      original.contributor_type,
      original.contributor_name,
    ).lastInsertRowid;
    return { success: true, id };
  });

  register(registry, "expenditures:list", (filters = {}) => {
    const where = [];
    const params = [];

    if (filters.startDate) {
      where.push("date(e.date) >= date(?)");
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      where.push("date(e.date) <= date(?)");
      params.push(filters.endDate);
    }
    if (filters.category) {
      where.push("e.category = ?");
      params.push(filters.category);
    }
    if (filters.sourceType) {
      where.push("e.source_type = ?");
      params.push(filters.sourceType);
    }
    if (filters.payeeType) {
      where.push("e.payee_type = ?");
      params.push(filters.payeeType);
    }
    if (filters.payeeMemberId) {
      where.push("e.payee_member_id = ?");
      params.push(Number(filters.payeeMemberId));
    }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return database.prepare(`
      SELECT e.*, m.first_name, m.last_name,
             CASE WHEN m.id IS NOT NULL THEN trim(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) ELSE NULL END AS payee_member_name
      FROM expenditures e
      LEFT JOIN members m ON m.id = e.payee_member_id
      ${clause}
      ORDER BY date(e.date) DESC, e.id DESC
    `).all(...params);
  });

  register(registry, "expenditures:create", (payload = {}) => {
    const amount = Number(payload.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Amount must be greater than 0." };
    }
    if (!payload.category || !payload.description) {
      return { success: false, error: "Category and description are required." };
    }

    const expenditureId = database.prepare(`
      INSERT INTO expenditures (
        date, amount, category, description, payee_type, payee_member_id, payee_name,
        source_type, source_id, payment_method, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      payload.date || new Date().toISOString().slice(0, 10),
      amount,
      payload.category,
      payload.description,
      payload.payee_type || null,
      payload.payee_member_id || null,
      payload.payee_name || null,
      payload.source_type || "organization",
      payload.source_id || null,
      payload.payment_method || null,
      payload.status || "paid",
    ).lastInsertRowid;

    const txnNote = `[EXP:${expenditureId}] ${payload.category} - ${payload.description}`;
    const amountCents = -Math.abs(Math.round(amount * 100));
    database.prepare(`
      INSERT INTO transactions (
        type, transaction_type, amount_cents, occurred_on, member_id, event_id, campaign_id,
        note, payment_method, status, contributor_type, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      "expense",
      "EXPENDITURE",
      amountCents,
      payload.date || new Date().toISOString().slice(0, 10),
      payload.payee_type === "member" ? (payload.payee_member_id || null) : null,
      payload.source_type === "event" ? (payload.source_id || null) : null,
      payload.source_type === "campaign" ? (payload.source_id || null) : null,
      txnNote,
      String(payload.payment_method || "manual").toUpperCase(),
      "COMPLETED",
      payload.payee_type === "member" ? "MEMBER" : "NON_MEMBER",
    );

    return { success: true, id: expenditureId };
  });

  register(registry, "expenditures:update", (id, payload = {}) => {
    if (!id) return { success: false, error: "Missing expenditure id" };
    const amount = Number(payload.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Amount must be greater than 0." };
    }

    database.prepare(`
      UPDATE expenditures
      SET date = ?, amount = ?, category = ?, description = ?, payee_type = ?, payee_member_id = ?, payee_name = ?,
          source_type = ?, source_id = ?, payment_method = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      payload.date || new Date().toISOString().slice(0, 10),
      amount,
      payload.category || "Other",
      payload.description || "",
      payload.payee_type || null,
      payload.payee_member_id || null,
      payload.payee_name || null,
      payload.source_type || "organization",
      payload.source_id || null,
      payload.payment_method || null,
      payload.status || "paid",
      id,
    );

    const txnNote = `[EXP:${id}] ${payload.category || 'Other'} - ${payload.description || ''}`;
    const amountCents = -Math.abs(Math.round(amount * 100));
    const existingTxn = database.prepare("SELECT id FROM transactions WHERE note LIKE ? AND COALESCE(is_deleted, 0) = 0 ORDER BY id DESC LIMIT 1").get(`%[EXP:${id}]%`);
    if (existingTxn?.id) {
      database.prepare(`
        UPDATE transactions
        SET amount_cents = ?, occurred_on = ?, member_id = ?, event_id = ?, campaign_id = ?,
            note = ?, payment_method = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        amountCents,
        payload.date || new Date().toISOString().slice(0, 10),
        payload.payee_type === "member" ? (payload.payee_member_id || null) : null,
        payload.source_type === "event" ? (payload.source_id || null) : null,
        payload.source_type === "campaign" ? (payload.source_id || null) : null,
        txnNote,
        String(payload.payment_method || "manual").toUpperCase(),
        existingTxn.id,
      );
    }

    return { success: true };
  });

  register(registry, "expenditures:delete", (id) => {
    if (!id) return { success: false, error: "Missing expenditure id" };
    database.prepare("DELETE FROM expenditures WHERE id = ?").run(id);
    database.prepare("UPDATE transactions SET is_deleted = 1, deleted_at = datetime('now'), updated_at = datetime('now') WHERE note LIKE ?").run(`%[EXP:${id}]%`);
    return { success: true };
  });

  register(registry, "expenditures:summary", (filters = {}) => {
    const where = [];
    const params = [];
    if (filters.startDate) {
      where.push("date >= date(?)");
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      where.push("date <= date(?)");
      params.push(filters.endDate);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = database.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenditures ${clause}`).get(...params)?.total ?? 0;
    const byCategory = database.prepare(`SELECT category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM expenditures ${clause} GROUP BY category ORDER BY total DESC`).all(...params);
    return { total, byCategory };
  });

  register(registry, "grants:list", (filters = {}) => {
    const includeArchived = !!filters.includeArchived;
    const includeSample = !!filters.includeSample;
    const rows = database.prepare(`
      SELECT * FROM grants
      WHERE (? = 1 OR COALESCE(archived, 0) = 0)
        AND (? = 1 OR COALESCE(is_sample, 0) = 0)
      ORDER BY id DESC
    `).all(includeArchived ? 1 : 0, includeSample ? 1 : 0);
    return rows;
  });

  register(registry, "grants:getById", (id) => {
    if (!id) return null;
    const grant = database.prepare("SELECT * FROM grants WHERE id = ?").get(id);
    if (!grant) return null;
    const reports = database.prepare("SELECT * FROM grant_reports WHERE grant_id = ? ORDER BY due_date ASC, id ASC").all(id);
    return { ...grant, reports };
  });

  register(registry, "grants:create", (grant = {}) => {
    const id = database.prepare(`
      INSERT INTO grants (grant_name, funder_name, amount_requested, amount_awarded, status, start_date, end_date, reporting_due_date, notes, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      grant.grant_name,
      grant.funder_name || null,
      grant.amount_requested ?? null,
      grant.amount_awarded ?? null,
      grant.status || "Draft",
      grant.start_date || null,
      grant.end_date || null,
      grant.reporting_due_date || null,
      grant.notes || null,
    ).lastInsertRowid;
    return { success: true, id };
  });

  register(registry, "grants:update", (id, updates = {}) => {
    database.prepare(`
      UPDATE grants
      SET grant_name = COALESCE(?, grant_name), funder_name = COALESCE(?, funder_name),
          amount_requested = COALESCE(?, amount_requested), amount_awarded = COALESCE(?, amount_awarded),
          status = COALESCE(?, status), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date),
          reporting_due_date = COALESCE(?, reporting_due_date), notes = COALESCE(?, notes),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      updates.grant_name ?? null,
      updates.funder_name ?? null,
      updates.amount_requested ?? null,
      updates.amount_awarded ?? null,
      updates.status ?? null,
      updates.start_date ?? null,
      updates.end_date ?? null,
      updates.reporting_due_date ?? null,
      updates.notes ?? null,
      id,
    );
    return { success: true };
  });

  register(registry, "grants:archive", (id) => {
    database.prepare("UPDATE grants SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  register(registry, "grants:restore", (id) => {
    database.prepare("UPDATE grants SET archived = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  register(registry, "grants:deletePermanent", (id) => {
    database.prepare("DELETE FROM grants WHERE id = ?").run(id);
    return { success: true };
  });

  register(registry, "grants:allocate", (allocation = {}) => {
    const amount = Number(allocation.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: "Allocation amount must be greater than 0." };
    const txnId = database.prepare(`
      INSERT INTO transactions (type, transaction_type, amount_cents, occurred_on, note, payment_method, status, contributor_type, is_deleted)
      VALUES ('expense', 'EXPENDITURE', ?, ?, ?, 'MANUAL', 'COMPLETED', 'NON_MEMBER', 0)
    `).run(
      -Math.abs(Math.round(amount * 100)),
      allocation.date || new Date().toISOString().slice(0, 10),
      `[GRANT_ALLOC] ${allocation.program_name || 'Grant Allocation'}`,
    ).lastInsertRowid;
    return { success: true, transactionId: txnId };
  });

  register(registry, "grants:summary", () => {
    const totalAwarded = database.prepare("SELECT COALESCE(SUM(amount_awarded), 0) AS total FROM grants WHERE COALESCE(archived, 0) = 0").get()?.total ?? 0;
    const totalRequested = database.prepare("SELECT COALESCE(SUM(amount_requested), 0) AS total FROM grants WHERE COALESCE(archived, 0) = 0").get()?.total ?? 0;
    const byStatus = database.prepare("SELECT status, COUNT(*) AS count FROM grants WHERE COALESCE(archived, 0) = 0 GROUP BY status").all();
    return { totalAwarded, totalRequested, byStatus };
  });

  register(registry, "grantReports:listForGrant", (grantId) => database.prepare("SELECT * FROM grant_reports WHERE grant_id = ? ORDER BY due_date ASC, id ASC").all(grantId));
  register(registry, "grantReports:create", (report = {}) => {
    const id = database.prepare("INSERT INTO grant_reports (grant_id, report_type, due_date, submitted, submitted_date, notes) VALUES (?, ?, ?, ?, ?, ?)").run(report.grant_id, report.report_type || "Interim", report.due_date || null, report.submitted ? 1 : 0, report.submitted_date || null, report.notes || null).lastInsertRowid;
    return { success: true, id };
  });
  register(registry, "grantReports:update", (id, updates = {}) => {
    database.prepare("UPDATE grant_reports SET report_type = COALESCE(?, report_type), due_date = COALESCE(?, due_date), submitted = COALESCE(?, submitted), submitted_date = COALESCE(?, submitted_date), notes = COALESCE(?, notes) WHERE id = ?").run(updates.report_type ?? null, updates.due_date ?? null, updates.submitted == null ? null : (updates.submitted ? 1 : 0), updates.submitted_date ?? null, updates.notes ?? null, id);
    return { success: true };
  });
  register(registry, "grantReports:delete", (id) => {
    database.prepare("DELETE FROM grant_reports WHERE id = ?").run(id);
    return { success: true };
  });
  register(registry, "grantReports:markSubmitted", (id) => {
    database.prepare("UPDATE grant_reports SET submitted = 1, submitted_date = date('now') WHERE id = ?").run(id);
    return { success: true };
  });

  register(registry, "payments:createExternalPayment", (data = {}) => {
    const amount = toCents(data.amount_cents ?? data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Amount must be greater than 0." };
    }

    const attribution = validateContributionAttribution(database, data, { allowNonMember: true, requireNonMemberName: true });
    const transactionType = normalizeTransactionType(data.transaction_type ?? data.type);
    ensureDuesAttributedToMember(transactionType, attribution);
    const ledgerType = mapTxnTypeToLedgerType(transactionType);
    const paymentMethod = String(data.method || data.payment_method || "manual").trim().toUpperCase();
    const isPendingExternal = paymentMethod === "CASHAPP" || paymentMethod === "ZELLE" || paymentMethod === "VENMO";
    let proofPath = null;
    if (isPendingExternal && data.proofBase64) {
      try {
        proofPath = savePaymentProofImage(data.proofBase64, data.proofFilename || "payment-proof");
      } catch {
        proofPath = null;
      }
    }

    const result = database.prepare(`
      INSERT INTO transactions (
        type,
        transaction_type,
        amount_cents,
        occurred_on,
        member_id,
        campaign_id,
        event_id,
        note,
        reference,
        proof_url,
        payment_method,
        status,
        contributor_type,
        contributor_name,
        is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      ledgerType,
      transactionType,
      amount,
      data.date ?? data.occurred_on ?? new Date().toISOString().slice(0, 10),
      attribution.memberId,
      attribution.campaignId,
      attribution.eventId,
      data.notes ?? data.note ?? null,
      data.reference ?? null,
      proofPath,
      paymentMethod,
      isPendingExternal ? "PENDING_EXTERNAL" : "COMPLETED",
      attribution.contributorType,
      attribution.contributorName ?? data.contributorName ?? data.contributor_name ?? null,
    );

    return { success: true, id: result.lastInsertRowid, pending: isPendingExternal };
  });

  register(registry, "payments:listPendingExternal", () => {
    const pendingTransactions = database.prepare(`
      SELECT
        t.id,
        'TRANSACTION' AS review_type,
        COALESCE(NULLIF(TRIM(t.source), ''), 'LOCAL') AS source,
        t.member_id,
        t.id AS invoice_id,
        t.amount_cents,
        t.payment_method,
        t.occurred_on,
        t.reference,
        t.note,
        t.proof_url,
        t.status,
        m.first_name AS member_first_name,
        m.last_name AS member_last_name,
        m.email AS member_email
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      WHERE COALESCE(t.is_deleted, 0) = 0
        AND COALESCE(t.status, '') = 'PENDING_EXTERNAL'
        AND UPPER(COALESCE(t.payment_method, '')) IN ('CASHAPP', 'ZELLE', 'VENMO')
      ORDER BY date(t.occurred_on) DESC, t.id DESC
    `).all();

    const pendingSubmissions = database.prepare(`
      SELECT
        ps.id,
        'SUBMISSION' AS review_type,
        COALESCE(NULLIF(TRIM(ps.source), ''), 'CLOUD') AS source,
        ps.member_id,
        ps.invoice_id,
        CAST(ROUND(COALESCE(ps.amount, 0) * 100) AS INTEGER) AS amount_cents,
        ps.method AS payment_method,
        ps.paid_date AS occurred_on,
        ps.cloud_id AS reference,
        ps.note,
        ps.screenshot_path AS proof_url,
        ps.status,
        m.first_name AS member_first_name,
        m.last_name AS member_last_name,
        m.email AS member_email
      FROM payment_submissions ps
      LEFT JOIN members m ON m.id = ps.member_id
      WHERE UPPER(COALESCE(ps.status, '')) = 'PENDING_VERIFICATION'
      ORDER BY datetime(COALESCE(ps.created_at, CURRENT_TIMESTAMP)) DESC, ps.id DESC
    `).all();

    return [...pendingSubmissions, ...pendingTransactions];
  });

  register(registry, "payments:approveExternal", (payload) => {
    const isObjectPayload = payload && typeof payload === "object";
    const id = Number(isObjectPayload ? payload.id : payload);
    const reviewType = String(isObjectPayload ? payload.review_type : "TRANSACTION").toUpperCase();
    const reviewedBy = Number(isObjectPayload ? payload.reviewed_by : 1) || 1;

    if (!Number.isFinite(id) || id <= 0) return { success: false, error: "Invalid payment id." };

    if (reviewType === "SUBMISSION") {
      const submission = database.prepare("SELECT * FROM payment_submissions WHERE id = ?").get(id);
      if (!submission) return { success: false, error: "Submission not found." };
      if (String(submission.status || "").toUpperCase() !== "PENDING_VERIFICATION") {
        return { success: false, error: "Only pending submissions can be approved." };
      }

      const invoiceId = Number(submission.invoice_id || 0);
      if (invoiceId > 0) {
        database.prepare("UPDATE transactions SET status = 'COMPLETED', updated_at = datetime('now') WHERE id = ?").run(invoiceId);
      }
      if (Number(submission.member_id || 0) > 0) {
        database.prepare("UPDATE members SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(submission.member_id);
      }
      database.prepare(`
        UPDATE payment_submissions
        SET status = 'COMPLETED',
            reviewed_by = ?,
            reviewed_at = datetime('now')
        WHERE id = ?
      `).run(reviewedBy, id);

      return { success: true, source: "SUBMISSION" };
    }

    const txn = database.prepare("SELECT id, status, member_id FROM transactions WHERE id = ? AND COALESCE(is_deleted, 0) = 0").get(id);
    if (!txn) return { success: false, error: "Payment not found." };
    if (String(txn.status || "").toUpperCase() !== "PENDING_EXTERNAL") {
      return { success: false, error: "Only pending external payments can be approved." };
    }
    database.prepare("UPDATE transactions SET status = 'COMPLETED', updated_at = datetime('now') WHERE id = ?").run(id);
    if (Number(txn.member_id || 0) > 0) {
      database.prepare("UPDATE members SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(txn.member_id);
    }
    return { success: true, source: "TRANSACTION" };
  });

  register(registry, "payments:rejectExternal", (payload) => {
    const isObjectPayload = payload && typeof payload === "object";
    const id = Number(isObjectPayload ? payload.id : payload);
    const reviewType = String(isObjectPayload ? payload.review_type : "TRANSACTION").toUpperCase();
    const reviewedBy = Number(isObjectPayload ? payload.reviewed_by : 1) || 1;
    const adminNote = String(isObjectPayload ? payload.note : "").trim();

    if (!Number.isFinite(id) || id <= 0) return { success: false, error: "Invalid payment id." };

    if (reviewType === "SUBMISSION") {
      const submission = database.prepare("SELECT id, note, status FROM payment_submissions WHERE id = ?").get(id);
      if (!submission) return { success: false, error: "Submission not found." };
      if (String(submission.status || "").toUpperCase() !== "PENDING_VERIFICATION") {
        return { success: false, error: "Only pending submissions can be rejected." };
      }

      const mergedNote = [String(submission.note || "").trim(), adminNote ? `Admin note: ${adminNote}` : ""]
        .filter(Boolean)
        .join("\n\n");

      database.prepare(`
        UPDATE payment_submissions
        SET status = 'REJECTED',
            note = ?,
            reviewed_by = ?,
            reviewed_at = datetime('now')
        WHERE id = ?
      `).run(mergedNote || null, reviewedBy, id);

      return { success: true, source: "SUBMISSION" };
    }

    const txn = database.prepare("SELECT id, status, note FROM transactions WHERE id = ? AND COALESCE(is_deleted, 0) = 0").get(id);
    if (!txn) return { success: false, error: "Payment not found." };
    if (String(txn.status || "").toUpperCase() !== "PENDING_EXTERNAL") {
      return { success: false, error: "Only pending external payments can be rejected." };
    }
    const mergedTxnNote = [String(txn.note || "").trim(), adminNote ? `Admin note: ${adminNote}` : ""]
      .filter(Boolean)
      .join("\n\n");
    database.prepare("UPDATE transactions SET status = 'REJECTED_EXTERNAL', note = ?, updated_at = datetime('now') WHERE id = ?").run(mergedTxnNote || null, id);
    return { success: true, source: "TRANSACTION" };
  });

  register(registry, "payments:syncFromCloud", async () => {
    try {
      const count = await syncPayments();
      return { success: true, count };
    } catch (err) {
      console.error("Sync error:", err);
      return { success: false, error: err?.message || "Failed to sync cloud submissions.", count: 0 };
    }
  });

  register(registry, "payments:sendReceipt", async (paymentData = {}) => {
    try {
      const response = await fetch(`${API_BASE}/payment-submissions/send-receipt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify(paymentData || {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        return { success: false, error: payload?.error || `Receipt API failed (${response.status})` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || "Failed to send receipt." };
    }
  });

  register(registry, "analytics:getSummary", async () => {
    try {
      const response = await fetch(`${API_BASE}/analytics/summary`, {
        headers: {
          "x-api-key": API_KEY,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { success: false, error: payload?.error || `Analytics API failed (${response.status})` };
      }
      return { success: true, data: payload };
    } catch (err) {
      return { success: false, error: err?.message || "Failed to load analytics." };
    }
  });

  register(registry, "import:templates:list", () => {
    const templates = [
      { importType: "members", filename: "civicflow_members_template.csv" },
      { importType: "membership_periods", filename: "civicflow_membership_periods_template.csv" },
      { importType: "financial_transactions", filename: "civicflow_financial_transactions_template.csv" },
      { importType: "campaigns", filename: "civicflow_campaigns_template.csv" },
      { importType: "grants", filename: "civicflow_grants_template.csv" },
    ];
    return { ok: true, templates };
  });

  register(registry, "import:templates:download", ({ importType } = {}) => {
    if (!importType) return { ok: false, error: "importType is required." };
    const built = importService.buildTemplate(importType);
    return {
      ok: true,
      importType,
      filename: built.filename,
      mimeType: built.mimeType,
      base64: built.buffer.toString("base64"),
    };
  });

  register(registry, "import:file:parse", (data = {}) => {
    try {
      const buffer = decodeBase64ToBuffer(data.base64);
      const parsed = importService.parseFileToRows({
        buffer,
        filename: data.filename,
        sheetName: data.sheetName,
        maxRows: Number.isFinite(Number(data.maxRows)) ? Number(data.maxRows) : undefined,
      });
      return {
        ok: true,
        headers: parsed.headers || [],
        sampleRows: (parsed.rows || []).slice(0, 50),
        totalRows: parsed.totalRows || 0,
        sheetNames: parsed.sheetNames || [],
        sheetName: parsed.sheetName || data.sheetName || null,
      };
    } catch (err) {
      return { ok: false, error: err?.message || "Failed to parse import file." };
    }
  });

  register(registry, "import:preview", (data = {}) => {
    try {
      const buffer = decodeBase64ToBuffer(data.base64);
      const parsed = importService.parseFileToRows({
        buffer,
        filename: data.filename,
        sheetName: data.sheetName,
      });
      return importService.previewImport(data.importType, data.mapping || {}, parsed.rows || [], {
        sheetName: parsed.sheetName || data.sheetName || null,
        fileName: data.filename || null,
      });
    } catch (err) {
      return { ok: false, error: err?.message || "Failed to validate import." };
    }
  });

  register(registry, "import:commit", (data = {}) => {
    try {
      const buffer = decodeBase64ToBuffer(data.base64);
      const parsed = importService.parseFileToRows({
        buffer,
        filename: data.filename,
        sheetName: data.sheetName,
      });
      return importService.commitImport(data.importType, data.mapping || {}, parsed.rows || [], {
        sheetName: parsed.sheetName || data.sheetName || null,
        fileName: data.filename || null,
        fileHash: buildFileHash(buffer),
      });
    } catch (err) {
      return { ok: false, error: err?.message || "Failed to import data." };
    }
  });

  register(registry, "import:runs:list", (filters = {}) => {
    const limit = Math.max(1, Math.min(500, Number(filters.limit ?? 100) || 100));
    return database.prepare("SELECT * FROM import_runs ORDER BY id DESC LIMIT ?").all(limit);
  });

  register(registry, "import:runs:get", (id) => {
    if (!id) return null;
    return database.prepare("SELECT * FROM import_runs WHERE id = ?").get(id) || null;
  });

  register(registry, "db:meetings:list", () => database.prepare("SELECT * FROM meetings ORDER BY meeting_date DESC, id DESC").all());
  register(registry, "db:meetings:get", (id) => database.prepare("SELECT * FROM meetings WHERE id = ?").get(id) || null);
  register(registry, "db:meetings:create", (meeting = {}) => database.prepare("INSERT INTO meetings (title, meeting_date) VALUES (?, ?)").run(meeting.title ?? "", meeting.meeting_date ?? meeting.date ?? new Date().toISOString().slice(0, 10)).lastInsertRowid);
  register(registry, "db:meetings:update", (id, updates = {}) => {
    database.prepare("UPDATE meetings SET title = COALESCE(?, title), meeting_date = COALESCE(?, meeting_date) WHERE id = ?").run(updates.title ?? null, updates.meeting_date ?? updates.date ?? null, id);
    return true;
  });
  register(registry, "db:meetings:delete", (id) => database.prepare("DELETE FROM meetings WHERE id = ?").run(id).changes > 0);
  register(registry, "db:meetings:getSummary", (id) => {
    const meeting = database.prepare("SELECT * FROM meetings WHERE id = ?").get(id);
    if (!meeting) return null;
    const total = database.prepare("SELECT COUNT(*) AS c FROM members WHERE status = 'active'").get()?.c ?? 0;
    const attended = database.prepare("SELECT COUNT(*) AS c FROM attendance WHERE meeting_id = ? AND attended = 1").get(id)?.c ?? 0;
    return { ...meeting, total_members: total, attended_count: attended, attendance_percentage: total ? Math.round((attended / total) * 100) : 0 };
  });

  register(registry, "db:attendance:getForMeeting", (meetingId) => database.prepare("SELECT a.*, m.first_name, m.last_name FROM attendance a JOIN members m ON m.id = a.member_id WHERE a.meeting_id = ? ORDER BY m.last_name, m.first_name").all(meetingId));
  register(registry, "db:attendance:getAllMembersForMeeting", (meetingId) => database.prepare("SELECT m.id, m.id AS member_id, m.first_name, m.last_name, COALESCE(a.attended, 0) AS attended FROM members m LEFT JOIN attendance a ON a.member_id = m.id AND a.meeting_id = ? WHERE m.status = 'active' ORDER BY m.last_name, m.first_name").all(meetingId));
  register(registry, "db:attendance:set", (meetingId, memberId, attended) => {
    const normalizedMemberId = Number(memberId);
    if (!Number.isFinite(normalizedMemberId) || normalizedMemberId <= 0) {
      return false;
    }
    const existing = database.prepare("SELECT id FROM attendance WHERE meeting_id = ? AND member_id = ?").get(meetingId, normalizedMemberId);
    if (existing) {
      database.prepare("UPDATE attendance SET attended = ?, recorded_at = datetime('now') WHERE id = ?").run(attended ? 1 : 0, existing.id);
    } else {
      database.prepare("INSERT INTO attendance (meeting_id, member_id, attended) VALUES (?, ?, ?)").run(meetingId, normalizedMemberId, attended ? 1 : 0);
    }
    return true;
  });
  register(registry, "db:attendance:getForMember", (memberId) => database.prepare("SELECT a.*, mt.title, mt.meeting_date FROM attendance a JOIN meetings mt ON mt.id = a.meeting_id WHERE a.member_id = ? ORDER BY mt.meeting_date DESC").all(memberId));

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const readCurrentMembershipStatus = (memberId) => {
    if (!memberId) return { status: "None", startDate: null, endDate: null, terminationReason: null, periodId: null };

    const openPeriod = database.prepare(`
      SELECT id, start_date, end_date, status, termination_reason
      FROM membership_periods
      WHERE member_id = ? AND end_date IS NULL
      ORDER BY date(start_date) DESC, id DESC
      LIMIT 1
    `).get(memberId);

    if (openPeriod) {
      return {
        status: openPeriod.status || "Active",
        startDate: openPeriod.start_date || null,
        endDate: openPeriod.end_date || null,
        terminationReason: openPeriod.termination_reason || null,
        periodId: openPeriod.id,
      };
    }

    const latestPeriod = database.prepare(`
      SELECT id, start_date, end_date, status, termination_reason
      FROM membership_periods
      WHERE member_id = ?
      ORDER BY COALESCE(date(end_date), date(start_date)) DESC, id DESC
      LIMIT 1
    `).get(memberId);

    if (latestPeriod) {
      return {
        status: latestPeriod.status || "None",
        startDate: latestPeriod.start_date || null,
        endDate: latestPeriod.end_date || null,
        terminationReason: latestPeriod.termination_reason || null,
        periodId: latestPeriod.id,
      };
    }

    const member = database.prepare("SELECT status, join_date FROM members WHERE id = ?").get(memberId);
    if (!member) return { status: "None", startDate: null, endDate: null, terminationReason: null, periodId: null };

    return {
      status: String(member.status || "").toLowerCase() === "inactive" ? "Inactive" : "None",
      startDate: member.join_date || null,
      endDate: null,
      terminationReason: null,
      periodId: null,
    };
  };

  register(registry, "membership:getCurrentStatus", (memberId) => {
    const id = Number(memberId);
    if (!Number.isFinite(id) || id <= 0) return { status: "None", startDate: null, endDate: null, terminationReason: null, periodId: null };
    return readCurrentMembershipStatus(id);
  });

  register(registry, "membership:listPeriods", (memberId) => {
    const id = Number(memberId);
    if (!Number.isFinite(id) || id <= 0) return [];
    return database.prepare(`
      SELECT id, member_id, start_date, end_date, status, termination_reason, reinstated_from_period_id, created_at, updated_at
      FROM membership_periods
      WHERE member_id = ?
      ORDER BY date(start_date) DESC, id DESC
    `).all(id);
  });

  register(registry, "membership:startNewPeriod", (memberId, startDate, reason) => {
    const id = Number(memberId);
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: "memberId is required" };
    const effectiveStart = startDate || todayIso();

    const openPeriod = database.prepare("SELECT id, status FROM membership_periods WHERE member_id = ? AND end_date IS NULL ORDER BY date(start_date) DESC, id DESC LIMIT 1").get(id);
    if (openPeriod?.id) {
      database.prepare(`
        UPDATE membership_periods
        SET end_date = ?,
            status = CASE WHEN status IN ('Terminated') THEN status ELSE 'Inactive' END,
            termination_reason = COALESCE(?, termination_reason),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(effectiveStart, reason || null, openPeriod.id);
    }

    const periodId = database.prepare(`
      INSERT INTO membership_periods (member_id, start_date, end_date, status, termination_reason)
      VALUES (?, ?, NULL, 'Active', ?)
    `).run(id, effectiveStart, reason || null).lastInsertRowid;

    database.prepare("UPDATE members SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true, periodId };
  });

  register(registry, "membership:setInactive", (memberId, reason) => {
    const id = Number(memberId);
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: "memberId is required" };

    const openPeriod = database.prepare("SELECT id FROM membership_periods WHERE member_id = ? AND end_date IS NULL ORDER BY date(start_date) DESC, id DESC LIMIT 1").get(id);
    if (openPeriod?.id) {
      database.prepare("UPDATE membership_periods SET status = 'Inactive', termination_reason = COALESCE(?, termination_reason), updated_at = datetime('now') WHERE id = ?").run(reason || null, openPeriod.id);
    } else {
      database.prepare("INSERT INTO membership_periods (member_id, start_date, end_date, status, termination_reason) VALUES (?, ?, NULL, 'Inactive', ?)").run(id, todayIso(), reason || null);
    }

    database.prepare("UPDATE members SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  register(registry, "membership:terminate", (memberId, endDate, reason) => {
    const id = Number(memberId);
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: "memberId is required" };
    const effectiveEnd = endDate || todayIso();

    const openPeriod = database.prepare("SELECT id FROM membership_periods WHERE member_id = ? AND end_date IS NULL ORDER BY date(start_date) DESC, id DESC LIMIT 1").get(id);
    if (openPeriod?.id) {
      database.prepare("UPDATE membership_periods SET end_date = ?, status = 'Terminated', termination_reason = ?, updated_at = datetime('now') WHERE id = ?").run(effectiveEnd, reason || null, openPeriod.id);
    } else {
      database.prepare("INSERT INTO membership_periods (member_id, start_date, end_date, status, termination_reason) VALUES (?, ?, ?, 'Terminated', ?)").run(id, effectiveEnd, effectiveEnd, reason || null);
    }

    database.prepare("UPDATE members SET status = 'inactive', updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  register(registry, "membership:reinstate", (memberId, mode = "NEW_PERIOD", date, reason) => {
    const id = Number(memberId);
    if (!Number.isFinite(id) || id <= 0) return { success: false, error: "memberId is required" };
    const effectiveDate = date || todayIso();
    const normalizedMode = String(mode || "NEW_PERIOD").toUpperCase();

    if (normalizedMode === "REOPEN") {
      const latestClosed = database.prepare(`
        SELECT id
        FROM membership_periods
        WHERE member_id = ? AND end_date IS NOT NULL
        ORDER BY date(end_date) DESC, id DESC
        LIMIT 1
      `).get(id);

      if (latestClosed?.id) {
        database.prepare("UPDATE membership_periods SET end_date = NULL, status = 'Reinstated', termination_reason = COALESCE(?, termination_reason), updated_at = datetime('now') WHERE id = ?").run(reason || null, latestClosed.id);
      } else {
        database.prepare("INSERT INTO membership_periods (member_id, start_date, end_date, status, termination_reason) VALUES (?, ?, NULL, 'Reinstated', ?)").run(id, effectiveDate, reason || null);
      }
    } else {
      const openPeriod = database.prepare("SELECT id FROM membership_periods WHERE member_id = ? AND end_date IS NULL ORDER BY date(start_date) DESC, id DESC LIMIT 1").get(id);
      if (openPeriod?.id) {
        database.prepare("UPDATE membership_periods SET end_date = ?, status = CASE WHEN status = 'Terminated' THEN status ELSE 'Inactive' END, termination_reason = COALESCE(?, termination_reason), updated_at = datetime('now') WHERE id = ?").run(effectiveDate, reason || null, openPeriod.id);
      }

      database.prepare("INSERT INTO membership_periods (member_id, start_date, end_date, status, termination_reason) VALUES (?, ?, NULL, 'Reinstated', ?)").run(id, effectiveDate, reason || null);
    }

    database.prepare("UPDATE members SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id);
    return { success: true };
  });

  register(registry, "get-member-details", (id) => {
    const member = database.prepare("SELECT m.*, c.name AS category_name, COALESCE(c.monthly_dues_cents, 0) AS monthly_dues_cents FROM members m LEFT JOIN categories c ON c.id = m.category_id WHERE m.id = ?").get(id);
    if (!member) return null;
    const txCount = database.prepare("SELECT COUNT(*) AS c FROM transactions WHERE member_id = ? AND COALESCE(is_deleted, 0) = 0").get(id)?.c ?? 0;
    const total = database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE member_id = ? AND COALESCE(is_deleted, 0) = 0").get(id)?.s ?? 0;
    const transactions = database.prepare(`
      SELECT t.id,
             t.occurred_on,
             CASE
               WHEN LOWER(COALESCE(t.type, '')) IN ('dues','dues_payment','invoice','receipt') THEN 'DUES'
               WHEN UPPER(COALESCE(t.transaction_type, '')) <> '' THEN UPPER(COALESCE(t.transaction_type, ''))
               WHEN UPPER(COALESCE(t.type, '')) <> '' THEN UPPER(COALESCE(t.type, ''))
               ELSE 'DONATION'
             END AS txn_type,
             t.transaction_type,
             t.type,
             t.amount_cents,
             t.note,
             t.payment_method,
             t.status,
             t.campaign_id, t.event_id, c.name AS campaign_name, e.name AS event_name
      FROM transactions t
      LEFT JOIN campaigns c ON c.id = t.campaign_id
      LEFT JOIN events e ON e.id = t.event_id
      WHERE t.member_id = ? AND COALESCE(t.is_deleted, 0) = 0
      ORDER BY date(t.occurred_on) DESC, t.id DESC
    `).all(id);
    const duesStatus = calculateMemberDuesStatus(id);
    return { ...member, transaction_count: txCount, total_amount_cents: total, transactions, duesStatus };
  });

  register(registry, "update-member-profile", (id, updates = {}) => {
    database.prepare("UPDATE members SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), email = COALESCE(?, email), phone = COALESCE(?, phone), address = COALESCE(?, address), city = COALESCE(?, city), state = COALESCE(?, state), zip = COALESCE(?, zip), category_id = COALESCE(?, category_id), status = COALESCE(?, status), join_date = COALESCE(?, join_date), dob = COALESCE(?, dob), updated_at = datetime('now') WHERE id = ?").run(updates.first_name ?? null, updates.last_name ?? null, updates.email ?? null, updates.phone ?? null, updates.address ?? null, updates.city ?? null, updates.state ?? null, updates.zip ?? null, updates.category_id ?? null, updates.status ?? null, updates.join_date ?? null, updates.dob ?? null, id);
    return { success: true };
  });
  register(registry, "get-event-details", (id) => {
    const event = database.prepare("SELECT * FROM events WHERE id = ?").get(id);
    if (!event) return null;
    const totals = database.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE event_id = ? AND COALESCE(is_deleted, 0) = 0").get(id);
    const contributions = database.prepare(`
      SELECT
        t.id,
        t.occurred_on,
        t.type,
        t.transaction_type,
        t.payment_method,
        t.amount_cents,
        t.status,
        t.note,
        t.reference,
        m.first_name,
        m.last_name,
        COALESCE(
          NULLIF(TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')), ''),
          NULLIF(TRIM(COALESCE(t.contributor_name, '')), ''),
          'Unknown'
        ) AS display_name
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      WHERE t.event_id = ? AND COALESCE(t.is_deleted, 0) = 0
      ORDER BY date(t.occurred_on) DESC, t.id DESC
    `).all(id);
    return {
      ...event,
      transaction_count: totals?.count ?? 0,
      total_amount_cents: totals?.total ?? 0,
      raised_cents: totals?.total ?? 0,
      contributions,
    };
  });

  register(registry, "get-campaign-details", (id) => {
    const campaign = database.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
    if (!campaign) return null;
    const totals = database.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE campaign_id = ? AND COALESCE(is_deleted, 0) = 0").get(id);
    const contributions = database.prepare(`
      SELECT
        t.id,
        t.occurred_on,
        t.type,
        t.transaction_type,
        t.payment_method,
        t.amount_cents,
        t.status,
        t.note,
        t.reference,
        m.first_name,
        m.last_name,
        COALESCE(
          NULLIF(TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')), ''),
          NULLIF(TRIM(COALESCE(t.contributor_name, '')), ''),
          'Unknown'
        ) AS display_name
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      WHERE t.campaign_id = ? AND COALESCE(t.is_deleted, 0) = 0
      ORDER BY date(t.occurred_on) DESC, t.id DESC
    `).all(id);
    return {
      ...campaign,
      transaction_count: totals?.count ?? 0,
      total_amount_cents: totals?.total ?? 0,
      raised_cents: totals?.total ?? 0,
      contributions,
    };
  });

  const buildReportsTxnWhere = (filters = {}, alias = "t") => {
    const typeExpr = `CASE WHEN LOWER(COALESCE(${alias}.type, '')) IN ('dues','dues_payment','invoice','receipt') THEN 'DUES' ELSE UPPER(COALESCE(${alias}.transaction_type, ${alias}.type, '')) END`;
    const dateExpr = `date(COALESCE(${alias}.occurred_on, ${alias}.created_at))`;
    const where = [
      `COALESCE(${alias}.is_deleted, 0) = 0`,
      `${typeExpr} <> 'GENERAL_CONTRIBUTION'`,
      `(
        ${alias}.member_id IS NOT NULL
        OR ${alias}.event_id IS NOT NULL
        OR ${alias}.campaign_id IS NOT NULL
        OR UPPER(COALESCE(${alias}.contributor_type, '')) = 'NON_MEMBER'
      )`,
      `(${alias}.member_id IS NULL OR EXISTS (SELECT 1 FROM members _m WHERE _m.id = ${alias}.member_id))`,
      `(${alias}.event_id IS NULL OR EXISTS (SELECT 1 FROM events _e WHERE _e.id = ${alias}.event_id))`,
      `(${alias}.campaign_id IS NULL OR EXISTS (SELECT 1 FROM campaigns _c WHERE _c.id = ${alias}.campaign_id))`,
    ];
    const params = [];

    const startDate = String(filters?.startDate || "").trim();
    const endDate = String(filters?.endDate || "").trim();
    if (startDate) {
      where.push(`${dateExpr} >= date(?)`);
      params.push(startDate);
    }
    if (endDate) {
      where.push(`${dateExpr} <= date(?)`);
      params.push(endDate);
    }

    const types = Array.isArray(filters?.types)
      ? filters.types.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
      : [];
    if (types.length > 0) {
      where.push(`${typeExpr} IN (${types.map(() => "?").join(",")})`);
      params.push(...types);
    }

    const paymentMethod = String(filters?.paymentMethod || "").trim().toUpperCase();
    if (paymentMethod) {
      where.push(`UPPER(COALESCE(${alias}.payment_method, '')) = ?`);
      params.push(paymentMethod);
    }

    const memberId = Number(filters?.memberId || 0);
    if (Number.isFinite(memberId) && memberId > 0) {
      where.push(`${alias}.member_id = ?`);
      params.push(memberId);
    }

    return { whereSql: where.join(" AND "), params };
  };

  register(registry, "reports:kpis", (filters = {}) => {
    const members = database.prepare("SELECT COUNT(*) AS c FROM members WHERE status = 'active'").get()?.c ?? 0;
    const { whereSql, params } = buildReportsTxnWhere(filters, "t");

    const transactions = database.prepare(`SELECT COUNT(*) AS c FROM transactions t WHERE ${whereSql}`).get(...params)?.c ?? 0;
    const revenue = database.prepare(`SELECT COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS s FROM transactions t WHERE ${whereSql}`).get(...params)?.s ?? 0;
    const expenses = database.prepare(`SELECT COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0) AS s FROM transactions t WHERE ${whereSql}`).get(...params)?.s ?? 0;
    const duesCollected = database.prepare(`
      SELECT COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND t.member_id IS NOT NULL AND (LOWER(COALESCE(t.type, '')) = 'dues' OR UPPER(COALESCE(t.transaction_type, '')) = 'DUES') THEN t.amount_cents ELSE 0 END), 0) AS s
      FROM transactions t
      WHERE ${whereSql}
    `).get(...params)?.s ?? 0;
    return {
      members,
      transactions,
      revenue_cents: revenue,
      expenses_cents: Math.abs(expenses),
      net_cents: revenue + expenses,
      dues_collected: duesCollected,
    };
  });

  register(registry, "reports:timeseries", (filters = {}) => {
    const { whereSql, params } = buildReportsTxnWhere(filters, "t");
    const groupBy = String(filters?.groupBy || "month").toLowerCase();
    const periodExpr = groupBy === "day"
      ? "date(COALESCE(t.occurred_on, t.created_at))"
      : groupBy === "week"
        ? "strftime('%Y-W%W', date(COALESCE(t.occurred_on, t.created_at)))"
        : "strftime('%Y-%m', date(COALESCE(t.occurred_on, t.created_at)))";

    return database.prepare(`
      SELECT ${periodExpr} AS period,
             COALESCE(SUM(t.amount_cents), 0) AS total_cents,
             COUNT(*) AS count
      FROM transactions t
      WHERE ${whereSql}
      GROUP BY ${periodExpr}
      ORDER BY period
    `).all(...params);
  });

  register(registry, "reports:by_type", (filters = {}) => {
    const { whereSql, params } = buildReportsTxnWhere(filters, "t");
    return database.prepare(`
      SELECT COALESCE(t.transaction_type, t.type, '') AS transaction_type,
             COUNT(*) AS count,
             COALESCE(SUM(t.amount_cents), 0) AS total_cents
      FROM transactions t
      WHERE ${whereSql}
      GROUP BY COALESCE(t.transaction_type, t.type, '')
      ORDER BY total_cents DESC
    `).all(...params);
  });

  register(registry, "reports:by_member", (filters = {}) => {
    const { whereSql, params } = buildReportsTxnWhere(filters, "t");
    return database.prepare(`
      SELECT m.id AS member_id,
             m.first_name,
             m.last_name,
             COUNT(t.id) AS count,
             COALESCE(SUM(t.amount_cents), 0) AS total_cents
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      WHERE ${whereSql}
      GROUP BY m.id, m.first_name, m.last_name
      ORDER BY total_cents DESC
      LIMIT 50
    `).all(...params);
  });

  register(registry, "reports:recent", (filters = {}) => {
    const { whereSql, params } = buildReportsTxnWhere(filters, "t");
    return database.prepare(`
      SELECT t.*, m.first_name, m.last_name, c.name AS campaign_name, e.name AS event_name
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      LEFT JOIN campaigns c ON c.id = t.campaign_id
      LEFT JOIN events e ON e.id = t.event_id
      WHERE ${whereSql}
      ORDER BY t.occurred_on DESC, t.id DESC
      LIMIT 50
    `).all(...params);
  });
  register(registry, "reports:getPaymentMethods", () => database.prepare("SELECT COALESCE(payment_method, 'unknown') AS payment_method, COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total_cents FROM transactions WHERE COALESCE(is_deleted, 0) = 0 GROUP BY COALESCE(payment_method, 'unknown')").all());

  const buildTxReportRows = (whereSql, params = []) => {
    return database.prepare(`
      SELECT t.id, t.occurred_on, t.type, t.transaction_type, t.amount_cents, t.note, t.reference,
             t.payment_method, t.contributor_name,
             m.first_name, m.last_name, c.name AS campaign_name, e.name AS event_name,
             CASE
               WHEN COALESCE(t.transaction_type, '') = 'CAMPAIGN_CONTRIBUTION' AND c.name IS NOT NULL THEN ('Campaign: ' || c.name)
               WHEN COALESCE(t.transaction_type, '') = 'EVENT_REVENUE' AND e.name IS NOT NULL THEN ('Event: ' || e.name)
               WHEN COALESCE(t.transaction_type, '') <> '' THEN t.transaction_type
               ELSE COALESCE(t.type, '')
             END AS type_label,
             COALESCE(
               NULLIF(TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')), ''),
               NULLIF(TRIM(COALESCE(t.contributor_name, '')), ''),
               'Unknown'
             ) AS contributor_label
      FROM transactions t
      LEFT JOIN members m ON m.id = t.member_id
      LEFT JOIN campaigns c ON c.id = t.campaign_id
      LEFT JOIN events e ON e.id = t.event_id
      WHERE COALESCE(t.is_deleted, 0) = 0 ${whereSql}
      ORDER BY t.occurred_on DESC, t.id DESC
    `).all(...params);
  };

  const savePdfDialog = async (buffer, defaultPath) => {
    const choice = await dialog.showSaveDialog({
      title: "Save Report PDF",
      defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    fs.writeFileSync(choice.filePath, buffer);
    return { ok: true, path: choice.filePath };
  };

  register(registry, "reports:org-financial-csv", (opts = {}) => {
    const { startDate, endDate } = normalizeDateRange(opts.startDate, opts.endDate);
    const rows = buildTxReportRows("AND date(t.occurred_on) BETWEEN date(?) AND date(?)", [startDate, endDate]);
    return { success: true, csv: toCsv(rows), filename: `Org_Financial_${startDate}_to_${endDate}.csv` };
  });

  register(registry, "reports:member-contribution-csv", (opts = {}) => {
    const { startDate, endDate } = normalizeDateRange(opts.startDate, opts.endDate);
    const memberId = Number(opts.memberId || 0);
    const rows = buildTxReportRows("AND t.member_id = ? AND date(t.occurred_on) BETWEEN date(?) AND date(?)", [memberId, startDate, endDate]);
    return { success: true, csv: toCsv(rows), filename: `Member_Contribution_${memberId}_${startDate}_to_${endDate}.csv` };
  });

  register(registry, "reports:event-contribution-csv", (opts = {}) => {
    const { startDate, endDate } = normalizeDateRange(opts.startDate, opts.endDate);
    const eventId = Number(opts.eventId || 0);
    const rows = buildTxReportRows("AND t.event_id = ? AND date(t.occurred_on) BETWEEN date(?) AND date(?)", [eventId, startDate, endDate]);
    return { success: true, csv: toCsv(rows), filename: `Event_Contribution_${eventId}_${startDate}_to_${endDate}.csv` };
  });

  register(registry, "reports:campaign-contribution-csv", (opts = {}) => {
    const { startDate, endDate } = normalizeDateRange(opts.startDate, opts.endDate);
    const campaignId = Number(opts.campaignId || 0);
    const rows = buildTxReportRows("AND t.campaign_id = ? AND date(t.occurred_on) BETWEEN date(?) AND date(?)", [campaignId, startDate, endDate]);
    return { success: true, csv: toCsv(rows), filename: `Campaign_Contribution_${campaignId}_${startDate}_to_${endDate}.csv` };
  });

  register(registry, "reports:member-monthly-csv", (opts = {}) => {
    const memberId = Number(opts.memberId || 0);
    const range = monthToRange(opts.month);
    if (!range) return { success: false, error: "Invalid month format. Use YYYY-MM." };
    const rows = buildTxReportRows("AND t.member_id = ? AND date(t.occurred_on) BETWEEN date(?) AND date(?)", [memberId, range.startDate, range.endDate]);
    return { success: true, csv: toCsv(rows), filename: `Member_Monthly_${memberId}_${opts.month}.csv` };
  });

  register(registry, "reports:roster-active-csv", () => {
    const rows = database.prepare("SELECT m.id, m.first_name, m.last_name, m.email, m.phone, c.name AS category_name, m.join_date FROM members m LEFT JOIN categories c ON c.id = m.category_id WHERE LOWER(COALESCE(m.status, 'active')) = 'active' ORDER BY m.last_name, m.first_name").all();
    return { success: true, csv: toCsv(rows), filename: "Roster_Active.csv" };
  });

  register(registry, "reports:roster-inactive-csv", () => {
    const rows = database.prepare("SELECT m.id, m.first_name, m.last_name, m.email, m.phone, c.name AS category_name, m.join_date FROM members m LEFT JOIN categories c ON c.id = m.category_id WHERE LOWER(COALESCE(m.status, 'inactive')) = 'inactive' ORDER BY m.last_name, m.first_name").all();
    return { success: true, csv: toCsv(rows), filename: "Roster_Inactive.csv" };
  });

  register(registry, "reports:roster-combined-csv", () => {
    const rows = database.prepare("SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.status, c.name AS category_name, m.join_date FROM members m LEFT JOIN categories c ON c.id = m.category_id ORDER BY m.last_name, m.first_name").all();
    return { success: true, csv: toCsv(rows), filename: "Roster_Combined.csv" };
  });

  register(registry, "reports:org-financial-pdf", async (opts = {}) => {
    const { startDate, endDate } = normalizeDateRange(opts.startDate, opts.endDate);
    const pdf = await buildPeriodReportPDF(database, startDate, endDate, "Organization Financial");
    return savePdfDialog(pdf, `Org_Financial_${startDate}_to_${endDate}.pdf`);
  });

  register(registry, "reports:member-contribution-pdf", async (opts = {}) => {
    const { startDate, endDate } = normalizeDateRange(opts.startDate, opts.endDate);
    const pdf = await buildPeriodReportPDF(database, startDate, endDate, `Member Contribution #${opts.memberId || ''}`);
    return savePdfDialog(pdf, `Member_Contribution_${opts.memberId || 'member'}_${startDate}_to_${endDate}.pdf`);
  });

  register(registry, "reports:event-contribution-pdf", async (opts = {}) => {
    const { startDate, endDate } = normalizeDateRange(opts.startDate, opts.endDate);
    const pdf = await buildPeriodReportPDF(database, startDate, endDate, `Event Contribution #${opts.eventId || ''}`);
    return savePdfDialog(pdf, `Event_Contribution_${opts.eventId || 'event'}_${startDate}_to_${endDate}.pdf`);
  });

  register(registry, "reports:campaign-contribution-pdf", async (opts = {}) => {
    const { startDate, endDate } = normalizeDateRange(opts.startDate, opts.endDate);
    const pdf = await buildPeriodReportPDF(database, startDate, endDate, `Campaign Contribution #${opts.campaignId || ''}`);
    return savePdfDialog(pdf, `Campaign_Contribution_${opts.campaignId || 'campaign'}_${startDate}_to_${endDate}.pdf`);
  });

  register(registry, "reports:member-monthly-pdf", async (opts = {}) => {
    const range = monthToRange(opts.month);
    if (!range) return { ok: false, error: "Invalid month format. Use YYYY-MM." };
    const pdf = await buildPeriodReportPDF(database, range.startDate, range.endDate, `Member Monthly #${opts.memberId || ''}`);
    return savePdfDialog(pdf, `Member_Monthly_${opts.memberId || 'member'}_${opts.month || ''}.pdf`);
  });

  register(registry, "reports:roster-active-pdf", async () => {
    const now = new Date().toISOString().slice(0, 10);
    const pdf = await buildPeriodReportPDF(database, "1970-01-01", now, "Roster Active");
    return savePdfDialog(pdf, "Roster_Active.pdf");
  });

  register(registry, "reports:roster-inactive-pdf", async () => {
    const now = new Date().toISOString().slice(0, 10);
    const pdf = await buildPeriodReportPDF(database, "1970-01-01", now, "Roster Inactive");
    return savePdfDialog(pdf, "Roster_Inactive.pdf");
  });

  register(registry, "reports:roster-combined-pdf", async () => {
    const now = new Date().toISOString().slice(0, 10);
    const pdf = await buildPeriodReportPDF(database, "1970-01-01", now, "Roster Combined");
    return savePdfDialog(pdf, "Roster_Combined.pdf");
  });

  register(registry, "reports:generateReportBuffer", async ({ reportType, params } = {}) => {
    const p = params || {};
    let startDate = p.startDate;
    let endDate = p.endDate;
    if (!startDate || !endDate) {
      if (reportType === "member_monthly" && p.month) {
        const range = monthToRange(p.month);
        if (range) {
          startDate = range.startDate;
          endDate = range.endDate;
        }
      }
    }
    const range = normalizeDateRange(startDate, endDate);
    try {
      const pdf = await buildPeriodReportPDF(database, range.startDate, range.endDate, String(reportType || "report"));
      return {
        ok: true,
        pdfBase64: pdf.toString("base64"),
        filename: `${String(reportType || "report")}_${range.startDate}_to_${range.endDate}.pdf`,
      };
    } catch (err) {
      return { ok: false, error: err?.message || "Failed to generate report buffer." };
    }
  });

  register(registry, "get-member-dues-status", (memberId) => calculateMemberDuesStatus(memberId));
  register(registry, "get-cbo-branding", () => branding.getBranding());
  register(registry, "set-cbo-branding", (data) => branding.setBranding(data));

  register(registry, "license:status", () => licenseService.getLicenseStatus());
  register(registry, "license:getStatus", () => licenseService.getLicenseStatus());
  register(registry, "license:activate", async (data) => licenseService.activateLicense(data));
  register(registry, "license:can-activate", () => ({ canActivate: true }));
  register(registry, "license:deactivate", () => licenseService.deactivateLicense());
  register(registry, "license:refresh", () => licenseService.refreshLicense());
  register(registry, "license:startTrial", () => licenseService.startTrial());
  register(registry, "license:start-trial", () => licenseService.startTrial());
  register(registry, "get-device-id", () => ({ deviceId: getDeviceId() }));

  register(registry, "receipt:save-pdf-dialog", async () => dialog.showSaveDialog({ title: "Save Receipt PDF", defaultPath: "receipt.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] }));
  register(registry, "receipt:is-email-configured", () => false);
  register(registry, "receipt:email-receipt", () => ({ success: false, error: "Email receipt is not configured." }));

  ALL_PRELOAD_CHANNELS.forEach((channel) => {
    if (registry.has(channel)) return;
    register(registry, channel, () => defaultForChannel(channel));
  });

  console.log(`[IPC] registerIpcHandlers run #${registerCount} registered ${registry.size} channels`);
}

module.exports = { registerIpcHandlers };

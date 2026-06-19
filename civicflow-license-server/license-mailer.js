const nodemailer = require("nodemailer");
const { envFlag } = require("./config");

let transport = null;

function formatDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getSupportEmail() {
  return String(process.env.LICENSE_SUPPORT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER || "support@civicflow.app").trim();
}

function getFromAddress() {
  return String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
}

function isConfigured() {
  return !!String(process.env.SMTP_HOST || "").trim() && !!getFromAddress();
}

function getTransport() {
  if (transport) return transport;
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const secure = envFlag("SMTP_SECURE", port === 465);

  if (!host || !getFromAddress()) {
    throw new Error("SMTP is not configured. Set SMTP_HOST and SMTP_FROM (or SMTP_USER).");
  }

  const config = {
    host,
    port,
    secure,
  };

  if (user || pass) {
    config.auth = { user, pass };
  }

  transport = nodemailer.createTransport(config);
  return transport;
}

function buildLicenseSummary(license = {}) {
  const expires = formatDate(license.expiresAt || license.expiryDate);
  const supportExpires = formatDate(license.supportExpiresAt || license.supportExpiryDate);
  return {
    organization: license.orgName || license.organization || "CivicFlow Customer",
    email: license.customerEmail || license.email || null,
    licenseKey: license.licenseKey || null,
    plan: license.plan || "Essential",
    licenseType: String(license.licenseType || license.type || "annual").toLowerCase(),
    seatsAllowed: Number(license.seatsAllowed || license.seats || 0) || null,
    issuedAt: formatDate(license.issuedAt),
    expiresAt: expires,
    supportExpiresAt: supportExpires,
    notes: license.notes || null,
    supportEmail: getSupportEmail(),
  };
}

function buildActivationInstructions(summary) {
  const lines = [
    "Activation steps:",
    "1. Open CivicFlow.",
    "2. Go to the activation screen.",
    "3. Enter the email address used for purchase and your license key.",
    "4. Activate while online at least once so this device receives its server-managed activation token.",
    `5. Contact ${summary.supportEmail} if you need a seat released or your key reissued.`,
  ];

  return {
    text: lines.join("\n"),
    html: `
      <p><strong>Activation steps:</strong></p>
      <ol>
        <li>Open CivicFlow.</li>
        <li>Go to the activation screen.</li>
        <li>Enter the email address used for purchase and your license key.</li>
        <li>Activate while online at least once so this device receives its server-managed activation token.</li>
        <li>Contact ${summary.supportEmail} if you need a seat released or your key reissued.</li>
      </ol>
    `,
  };
}

function buildEntitlementLines(summary) {
  return [
    `Organization: ${summary.organization}`,
    `Plan: ${summary.plan}`,
    `License type: ${summary.licenseType}`,
    `License key: ${summary.licenseKey || "Unavailable"}`,
    summary.seatsAllowed ? `Seats allowed: ${summary.seatsAllowed}` : null,
    summary.licenseType === "annual"
      ? `Expiry date: ${summary.expiresAt || "Unknown"}`
      : `Support expiry date: ${summary.supportExpiresAt || "Not set"}`,
  ].filter(Boolean);
}

function buildEntitlementHtml(summary) {
  const expiryLabel = summary.licenseType === "annual" ? "Expiry date" : "Support expiry date";
  const expiryValue = summary.licenseType === "annual"
    ? (summary.expiresAt || "Unknown")
    : (summary.supportExpiresAt || "Not set");

  return `
    <p>
      <strong>Organization:</strong> ${summary.organization}<br />
      <strong>Plan:</strong> ${summary.plan}<br />
      <strong>License type:</strong> ${summary.licenseType}<br />
      <strong>License key:</strong> <code>${summary.licenseKey || "Unavailable"}</code><br />
      ${summary.seatsAllowed ? `<strong>Seats allowed:</strong> ${summary.seatsAllowed}<br />` : ""}
      <strong>${expiryLabel}:</strong> ${expiryValue}
    </p>
  `;
}

function buildMessage({ subject, introLines, introHtml, summary, footerLines = [], footerHtml = "" }) {
  const activation = buildActivationInstructions(summary);
  const text = [
    ...introLines,
    "",
    ...buildEntitlementLines(summary),
    "",
    activation.text,
    "",
    ...footerLines,
  ].filter(Boolean).join("\n");

  const html = `
    ${introHtml}
    ${buildEntitlementHtml(summary)}
    ${activation.html}
    ${footerHtml}
  `;

  return { subject, text, html };
}

function buildNewLicenseMessage(license) {
  const summary = buildLicenseSummary(license);
  return buildMessage({
    subject: "Your CivicFlow License Key",
    introLines: [
      `Hello ${summary.organization},`,
      "Thank you for purchasing CivicFlow.",
      "Your new license is ready to activate.",
    ],
    introHtml: `
      <p>Hello ${summary.organization},</p>
      <p>Thank you for purchasing <strong>CivicFlow</strong>.</p>
      <p>Your new license is ready to activate.</p>
    `,
    summary,
    footerLines: [`Need help? Contact ${summary.supportEmail}.`],
    footerHtml: `<p>Need help? Contact ${summary.supportEmail}.</p>`,
  });
}

function buildRenewalConfirmationMessage(license) {
  const summary = buildLicenseSummary(license);
  return buildMessage({
    subject: "Your CivicFlow Renewal Is Confirmed",
    introLines: [
      `Hello ${summary.organization},`,
      "Your CivicFlow renewal has been applied to your existing license key.",
      "Keep using the same key on your devices.",
    ],
    introHtml: `
      <p>Hello ${summary.organization},</p>
      <p>Your <strong>CivicFlow</strong> renewal has been applied to your existing license key.</p>
      <p>Keep using the same key on your devices.</p>
    `,
    summary,
    footerLines: [`Need help? Contact ${summary.supportEmail}.`],
    footerHtml: `<p>Need help? Contact ${summary.supportEmail}.</p>`,
  });
}

function buildReissuedLicenseMessage(license, previousLicenseKey = null) {
  const summary = buildLicenseSummary(license);
  return buildMessage({
    subject: "Your CivicFlow License Has Been Reissued",
    introLines: [
      `Hello ${summary.organization},`,
      "Your CivicFlow license has been reissued.",
      previousLicenseKey ? `The previous key ${previousLicenseKey} is no longer active.` : "The previous key is no longer active.",
      "Use the replacement key below for future activations.",
    ],
    introHtml: `
      <p>Hello ${summary.organization},</p>
      <p>Your <strong>CivicFlow</strong> license has been reissued.</p>
      <p>${previousLicenseKey ? `The previous key <code>${previousLicenseKey}</code> is no longer active.` : "The previous key is no longer active."}</p>
      <p>Use the replacement key below for future activations.</p>
    `,
    summary,
    footerLines: [`Need help? Contact ${summary.supportEmail}.`],
    footerHtml: `<p>Need help? Contact ${summary.supportEmail}.</p>`,
  });
}

function buildLicenseResendMessage(license) {
  const summary = buildLicenseSummary(license);
  return buildMessage({
    subject: "Your CivicFlow License Details",
    introLines: [
      `Hello ${summary.organization},`,
      "Here is a resend of your current CivicFlow license information.",
    ],
    introHtml: `
      <p>Hello ${summary.organization},</p>
      <p>Here is a resend of your current <strong>CivicFlow</strong> license information.</p>
    `,
    summary,
    footerLines: [`Need help? Contact ${summary.supportEmail}.`],
    footerHtml: `<p>Need help? Contact ${summary.supportEmail}.</p>`,
  });
}

async function sendMail(to, message) {
  const recipient = String(to || "").trim();
  if (!recipient) {
    return { skipped: true, reason: "missing-recipient" };
  }
  if (!isConfigured()) {
    return { skipped: true, reason: "smtp-not-configured" };
  }

  const mail = {
    from: getFromAddress(),
    to: recipient,
    subject: message.subject,
    text: message.text,
    html: message.html,
  };

  try {
    const result = await getTransport().sendMail(mail);
    return {
      success: true,
      messageId: result?.messageId || null,
    };
  } catch (err) {
    console.error("Stripe webhook error:", err?.message || err);
    return { skipped: true, reason: "smtp-error", error: err?.message || String(err) };
  }
}

async function sendNewLicenseEmail(license) {
  const summary = buildLicenseSummary(license);
  return sendMail(summary.email, buildNewLicenseMessage(summary));
}

async function sendRenewalConfirmationEmail(license) {
  const summary = buildLicenseSummary(license);
  return sendMail(summary.email, buildRenewalConfirmationMessage(summary));
}

async function sendReissuedLicenseEmail(license, previousLicenseKey = null) {
  const summary = buildLicenseSummary(license);
  return sendMail(summary.email, buildReissuedLicenseMessage(summary, previousLicenseKey));
}

async function sendLicenseResendEmail(license) {
  const summary = buildLicenseSummary(license);
  return sendMail(summary.email, buildLicenseResendMessage(summary));
}

async function sendExtensionEmail(license) {
  return sendRenewalConfirmationEmail(license);
}

module.exports = {
  isConfigured,
  buildLicenseSummary,
  buildNewLicenseMessage,
  buildRenewalConfirmationMessage,
  buildReissuedLicenseMessage,
  buildLicenseResendMessage,
  sendNewLicenseEmail,
  sendRenewalConfirmationEmail,
  sendReissuedLicenseEmail,
  sendLicenseResendEmail,
  sendExtensionEmail,
};

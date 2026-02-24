const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_REPORT_PAYMENT_URL = "https://api.civicflowapp.com/report-payment.html";
const CIVICFLOW_DEEP_LINK_URL = "civicflow://report-payment";

const TEMPLATE_DIR = path.join(__dirname, "templates");
const HTML_TEMPLATE_PATH = path.join(TEMPLATE_DIR, "paymentReminder.html");
const TEXT_TEMPLATE_PATH = path.join(TEMPLATE_DIR, "paymentReminder.txt");

const SUPPORTED_VARIABLES = [
  "member_name",
  "invoice_id",
  "amount_due",
  "due_date",
  "organization_name",
  "payment_methods",
  "report_payment_url",
  "deep_link_url",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadTemplate(templatePath) {
  return fs.readFileSync(templatePath, "utf8");
}

function replaceVariables(template, data = {}, options = {}) {
  const htmlMode = Boolean(options.htmlMode);
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
    const rawValue = data[key];
    if (rawValue == null) return "";
    if (htmlMode && key !== "payment_methods") {
      return escapeHtml(rawValue);
    }
    return String(rawValue);
  });
}

function normalizePaymentMethods(paymentMethods) {
  if (paymentMethods && typeof paymentMethods === "object" && !Array.isArray(paymentMethods)) {
    return {
      text: String(paymentMethods.text || "").trim(),
      html: String(paymentMethods.html || "").trim(),
    };
  }

  if (Array.isArray(paymentMethods)) {
    const lines = paymentMethods.map((item) => `- ${String(item || "").trim()}`).filter(Boolean);
    const text = lines.join("\n");
    const html = `<ul style="margin:0 0 0 20px;padding:0;">${lines.map((line) => `<li style="margin:0 0 6px 0;">${escapeHtml(line.replace(/^-\s*/, ""))}</li>`).join("")}</ul>`;
    return { text, html };
  }

  const asText = String(paymentMethods || "").trim();
  if (!asText) {
    const defaultText = "- Zelle\n- CashApp\n- Venmo";
    const defaultHtml = "<ul style=\"margin:0 0 0 20px;padding:0;\"><li style=\"margin:0 0 6px 0;\">Zelle</li><li style=\"margin:0 0 6px 0;\">CashApp</li><li style=\"margin:0 0 6px 0;\">Venmo</li></ul>";
    return { text: defaultText, html: defaultHtml };
  }

  return {
    text: asText,
    html: `<p style="margin:0;white-space:pre-line;">${escapeHtml(asText)}</p>`,
  };
}

function renderPaymentReminder(input = {}) {
  const paymentMethods = normalizePaymentMethods(input.payment_methods);
  const payload = {
    member_name: String(input.member_name || "Member").trim() || "Member",
    invoice_id: String(input.invoice_id || "N/A").trim() || "N/A",
    amount_due: String(input.amount_due || "0.00").trim() || "0.00",
    due_date: String(input.due_date || "N/A").trim() || "N/A",
    organization_name: String(input.organization_name || "CivicFlow").trim() || "CivicFlow",
    report_payment_url: String(input.report_payment_url || PRODUCTION_REPORT_PAYMENT_URL).trim() || PRODUCTION_REPORT_PAYMENT_URL,
    deep_link_url: String(input.deep_link_url || CIVICFLOW_DEEP_LINK_URL).trim() || CIVICFLOW_DEEP_LINK_URL,
  };

  const htmlTemplate = loadTemplate(HTML_TEMPLATE_PATH);
  const textTemplate = loadTemplate(TEXT_TEMPLATE_PATH);

  const html = replaceVariables(htmlTemplate, {
    ...payload,
    payment_methods: paymentMethods.html,
  }, { htmlMode: true }).trim();

  const text = replaceVariables(textTemplate, {
    ...payload,
    payment_methods: paymentMethods.text,
  }, { htmlMode: false }).trim();

  const subject = `Payment Reminder – ${payload.organization_name}`;
  return { html, text, subject };
}

module.exports = {
  PRODUCTION_REPORT_PAYMENT_URL,
  CIVICFLOW_DEEP_LINK_URL,
  SUPPORTED_VARIABLES,
  renderPaymentReminder,
};
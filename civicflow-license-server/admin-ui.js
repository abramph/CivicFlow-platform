function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value, includeTime = false) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
  return includeTime ? parsed.toISOString().replace("T", " ").slice(0, 16) : parsed.toISOString().slice(0, 10);
}

function formatMoney(amountTotal, currency) {
  if (amountTotal == null || currency == null) return "-";
  const value = Number(amountTotal);
  if (!Number.isFinite(value)) return "-";
  return `${(value / 100).toFixed(2)} ${String(currency).toUpperCase()}`;
}

function layout({ title, body, user = null, flash = null }) {
  const flashMarkup = flash?.message
    ? `<div class="flash ${escapeHtml(flash.type || "info")}">${escapeHtml(flash.message)}</div>`
    : "";
  const navMarkup = user
    ? `
      <header class="topbar">
        <div>
          <h1>CivicFlow Licensing Admin</h1>
          <p>Signed in as ${escapeHtml(user.username || "admin")}</p>
        </div>
        <nav>
          <a href="/admin/licenses">Licenses</a>
          <form method="post" action="/admin/logout">
            <button type="submit" class="secondary">Log out</button>
          </form>
        </nav>
      </header>
    `
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f6ef;
        --surface: #ffffff;
        --surface-muted: #f2f1ea;
        --border: #d9d6c9;
        --text: #1f2a22;
        --muted: #59655c;
        --accent: #1f7a5a;
        --accent-strong: #125743;
        --danger: #b43f32;
        --danger-bg: #fbe9e6;
        --warn: #9a6b00;
        --warn-bg: #fff4d6;
        --success: #0c6b4f;
        --success-bg: #e6f5ef;
        --shadow: 0 18px 45px rgba(25, 39, 31, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", sans-serif;
        background: radial-gradient(circle at top left, #fefcf3 0%, var(--bg) 45%, #eef1e7 100%);
        color: var(--text);
      }
      a { color: var(--accent-strong); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .shell {
        max-width: 1460px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        margin-bottom: 20px;
      }
      .topbar h1 {
        margin: 0 0 6px;
        font-size: 1.75rem;
      }
      .topbar p {
        margin: 0;
        color: var(--muted);
      }
      .topbar nav {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 18px;
        box-shadow: var(--shadow);
        padding: 20px;
      }
      .grid {
        display: grid;
        gap: 18px;
      }
      .grid.two {
        grid-template-columns: minmax(0, 1.55fr) minmax(360px, 0.95fr);
      }
      .grid.detail {
        grid-template-columns: minmax(0, 1.7fr) minmax(360px, 0.92fr);
      }
      .card h2, .card h3 {
        margin: 0 0 14px;
      }
      form.inline { display: inline-flex; gap: 8px; align-items: center; }
      form.stack { display: grid; gap: 14px; }
      .field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .field-grid.three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .field-grid.single {
        grid-template-columns: 1fr;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 0.92rem;
        color: var(--muted);
      }
      input, select, textarea, button {
        font: inherit;
      }
      input, select, textarea {
        width: 100%;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: #fffef9;
        color: var(--text);
      }
      textarea { min-height: 88px; resize: vertical; }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 16px;
        cursor: pointer;
        background: var(--accent);
        color: white;
        font-weight: 600;
      }
      button:hover { background: var(--accent-strong); }
      button.secondary {
        background: var(--surface-muted);
        color: var(--text);
        border: 1px solid var(--border);
      }
      button.danger {
        background: var(--danger);
      }
      button.danger:hover {
        background: #8f2f25;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .flash {
        margin-bottom: 18px;
        border-radius: 14px;
        padding: 12px 14px;
        border: 1px solid transparent;
      }
      .flash.info { background: #eef2ff; border-color: #c7d2fe; color: #3730a3; }
      .flash.success { background: var(--success-bg); border-color: #b7e4d2; color: var(--success); }
      .flash.error { background: var(--danger-bg); border-color: #f2c0b8; color: var(--danger); }
      .flash.warning { background: var(--warn-bg); border-color: #edd8a4; color: var(--warn); }
      .tag {
        display: inline-flex;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.01em;
        background: #ecf2ee;
        color: #244634;
      }
      .tag.revoked { background: var(--danger-bg); color: var(--danger); }
      .tag.trial { background: var(--warn-bg); color: var(--warn); }
      .tag.superseded { background: #ece9ff; color: #5a44c9; }
      .tag.test { background: #eaf2ff; color: #204da7; }
      .tag.prod { background: #edf8eb; color: #1f6b2c; }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.92rem;
      }
      th, td {
        text-align: left;
        padding: 11px 10px;
        border-bottom: 1px solid #ece7d6;
        vertical-align: top;
      }
      th { color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; }
      code, pre {
        font-family: Consolas, "Courier New", monospace;
      }
      pre {
        margin: 0;
        background: #111814;
        color: #eef6f0;
        border-radius: 14px;
        padding: 14px;
        overflow: auto;
        font-size: 0.82rem;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 16px;
      }
      .meta div {
        padding: 12px;
        border-radius: 14px;
        background: var(--surface-muted);
      }
      .meta strong {
        display: block;
        margin-bottom: 4px;
        color: var(--muted);
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .note {
        margin: 0;
        color: var(--muted);
        font-size: 0.88rem;
      }
      .checkbox {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .checkbox input {
        width: auto;
        margin: 0;
      }
      .empty {
        padding: 16px;
        border-radius: 14px;
        background: var(--surface-muted);
        color: var(--muted);
      }
      .section-stack {
        display: grid;
        gap: 18px;
      }
      @media (max-width: 980px) {
        .grid.two, .grid.detail, .field-grid, .field-grid.three, .meta { grid-template-columns: 1fr; }
        .topbar { flex-direction: column; }
        .topbar nav { width: 100%; justify-content: space-between; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      ${navMarkup}
      ${flashMarkup}
      ${body}
    </div>
  </body>
</html>`;
}

function renderLoginPage({ error = null, next = "/admin/licenses", configured = true } = {}) {
  const body = `
    <section class="card" style="max-width: 480px; margin: 80px auto 0;">
      <h2>Admin Sign In</h2>
      <p class="note">Use the environment-configured admin credentials to manage CivicFlow licenses.</p>
      ${!configured ? '<div class="flash error">ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET must be set before the dashboard can be used.</div>' : ""}
      ${error ? `<div class="flash error">${escapeHtml(error)}</div>` : ""}
      <form method="post" action="/admin/login" class="stack">
        <input type="hidden" name="next" value="${escapeHtml(next)}" />
        <label>
          Username
          <input type="text" name="username" autocomplete="username" required />
        </label>
        <label>
          Password
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Sign In</button>
      </form>
    </section>
  `;

  return layout({ title: "Admin Sign In", body });
}

function renderLicensesPage({
  filters = {},
  licenses = [],
  recentPurchaseEvents = [],
  recentLicenseEvents = [],
  flash = null,
  user = null,
} = {}) {
  const rows = licenses.length > 0
    ? licenses.map((license) => `
        <tr>
          <td><a href="/admin/licenses/${license.id}"><code>${escapeHtml(license.licenseKey)}</code></a></td>
          <td>${escapeHtml(license.orgName || "-")}</td>
          <td>${escapeHtml(license.customerEmail || "-")}</td>
          <td>${escapeHtml(license.plan)}</td>
          <td><span class="tag ${escapeHtml(license.licenseType)}">${escapeHtml(license.licenseType)}</span></td>
          <td><span class="tag ${escapeHtml(license.status)}">${escapeHtml(license.status)}</span></td>
          <td><span class="tag ${escapeHtml(license.environment || "test")}">${escapeHtml(license.environment || "test")}</span></td>
          <td>${escapeHtml(String(license.seatsAllowed || 0))}</td>
          <td>${escapeHtml(String(license.activeActivationCount || 0))}</td>
          <td>${escapeHtml(formatDate(license.expiresAt))}</td>
          <td>${escapeHtml(formatDate(license.supportExpiresAt))}</td>
          <td>${escapeHtml(formatDate(license.issuedAt, true))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="12"><div class="empty">No licenses matched the current filters.</div></td></tr>`;

  const recentPurchaseRows = recentPurchaseEvents.length > 0
    ? recentPurchaseEvents.map((event) => `
        <tr>
          <td>${escapeHtml(formatDate(event.createdAt, true))}</td>
          <td>${escapeHtml(event.purchaseKind || "-")}</td>
          <td>${escapeHtml(event.status || "-")}</td>
          <td>${escapeHtml(event.environment || "-")}</td>
          <td>${escapeHtml(event.customerEmail || "-")}</td>
          <td>${escapeHtml(event.orgName || event.linkedOrgName || event.targetOrgName || "-")}</td>
          <td>
            ${event.licenseId
              ? `<a href="/admin/licenses/${event.licenseId}"><code>${escapeHtml(event.linkedLicenseKey || "-")}</code></a>`
              : "-"}
          </td>
          <td>
            ${event.targetLicenseId
              ? `<a href="/admin/licenses/${event.targetLicenseId}"><code>${escapeHtml(event.targetLicenseKey || "-")}</code></a>`
              : "-"}
          </td>
          <td>${escapeHtml(formatMoney(event.amountTotal, event.currency))}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="9"><div class="empty">No recent purchase activity.</div></td></tr>';

  const recentLicenseRows = recentLicenseEvents.length > 0
    ? recentLicenseEvents.map((event) => `
        <tr>
          <td>${escapeHtml(formatDate(event.createdAt, true))}</td>
          <td>
            ${event.licenseId
              ? `<a href="/admin/licenses/${event.licenseId}"><code>${escapeHtml(event.licenseKey || "-")}</code></a>`
              : `<code>${escapeHtml(event.licenseKey || "-")}</code>`}
          </td>
          <td>${escapeHtml(event.orgName || "-")}</td>
          <td>${escapeHtml(event.eventType || "-")}</td>
          <td>${escapeHtml(event.actorType || "-")}</td>
          <td>${escapeHtml(event.actorId || "-")}</td>
          <td>${escapeHtml(event.deviceName || event.deviceId || "-")}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="7"><div class="empty">No recent license events.</div></td></tr>';

  const body = `
    <div class="grid two">
      <section class="card">
        <h2>Licenses</h2>
        <form method="get" action="/admin/licenses" class="stack">
          <div class="field-grid three">
            <label>
              Search
              <input type="text" name="search" value="${escapeHtml(filters.search || "")}" placeholder="License key, org, or email" />
            </label>
            <label>
              Plan
              <select name="plan">
                <option value="">All plans</option>
                <option value="Essential" ${String(filters.plan || "") === "Essential" ? "selected" : ""}>Essential</option>
                <option value="Elite" ${String(filters.plan || "") === "Elite" ? "selected" : ""}>Elite</option>
              </select>
            </label>
            <label>
              License type
              <select name="type">
                <option value="">All types</option>
                <option value="annual" ${String(filters.type || "") === "annual" ? "selected" : ""}>Annual</option>
                <option value="perpetual" ${String(filters.type || "") === "perpetual" ? "selected" : ""}>Perpetual</option>
                <option value="trial" ${String(filters.type || "") === "trial" ? "selected" : ""}>Trial</option>
              </select>
            </label>
            <label>
              Status
              <select name="status">
                <option value="">All statuses</option>
                <option value="active" ${String(filters.status || "") === "active" ? "selected" : ""}>Active</option>
                <option value="revoked" ${String(filters.status || "") === "revoked" ? "selected" : ""}>Revoked</option>
                <option value="superseded" ${String(filters.status || "") === "superseded" ? "selected" : ""}>Superseded</option>
              </select>
            </label>
            <label>
              Environment
              <select name="environment">
                <option value="">All environments</option>
                <option value="test" ${String(filters.environment || "") === "test" ? "selected" : ""}>Test</option>
                <option value="prod" ${String(filters.environment || "") === "prod" ? "selected" : ""}>Prod</option>
              </select>
            </label>
          </div>
          <div class="actions">
            <button type="submit">Apply Filters</button>
            <a href="/admin/licenses"><button type="button" class="secondary">Clear</button></a>
          </div>
        </form>
        <div style="overflow:auto; margin-top: 18px;">
          <table>
            <thead>
              <tr>
                <th>License Key</th>
                <th>Organization</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Type</th>
                <th>Status</th>
                <th>Env</th>
                <th>Seats</th>
                <th>Active Seats</th>
                <th>Expiry</th>
                <th>Support</th>
                <th>Issued</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
      <section class="card">
        <h2>Create License</h2>
        <p class="note">Annual licenses require an expiry date. Perpetual licenses can optionally track a support expiry date without affecting runtime validation.</p>
        <form method="post" action="/admin/licenses/create" class="stack">
          <div class="field-grid single">
            <label>
              Organization name
              <input type="text" name="orgName" required />
            </label>
            <label>
              Customer email
              <input type="email" name="customerEmail" placeholder="billing@organization.org" />
            </label>
          </div>
          <div class="field-grid three">
            <label>
              Plan
              <select name="plan">
                <option value="Essential">Essential</option>
                <option value="Elite">Elite</option>
              </select>
            </label>
            <label>
              License type
              <select name="licenseType">
                <option value="annual">Annual</option>
                <option value="perpetual">Perpetual</option>
              </select>
            </label>
            <label>
              Environment
              <select name="environment">
                <option value="test">Test</option>
                <option value="prod">Prod</option>
              </select>
            </label>
            <label>
              Seats allowed
              <input type="number" name="seatsAllowed" min="1" value="2" required />
            </label>
            <label>
              Expiry date
              <input type="date" name="expiryDate" />
            </label>
            <label>
              Support expiry date
              <input type="date" name="supportExpiryDate" />
            </label>
          </div>
          <label>
            Notes
            <textarea name="notes" placeholder="Optional internal or customer-facing note"></textarea>
          </label>
          <label class="checkbox">
            <input type="checkbox" name="sendEmail" value="1" checked />
            Send the customer their license email after creation
          </label>
          <button type="submit">Create License</button>
        </form>
      </section>
    </div>
    <div class="grid two" style="margin-top: 18px;">
      <section class="card">
        <h2>Recent Purchase Events</h2>
        <div style="overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Env</th>
                <th>Email</th>
                <th>Organization</th>
                <th>Issued License</th>
                <th>Target License</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>${recentPurchaseRows}</tbody>
          </table>
        </div>
      </section>
      <section class="card">
        <h2>Recent License Events</h2>
        <div style="overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>License</th>
                <th>Organization</th>
                <th>Event</th>
                <th>Actor Type</th>
                <th>Actor ID</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody>${recentLicenseRows}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  return layout({ title: "License Dashboard", body, user, flash });
}

function renderLicenseDetailPage({ detail, flash = null, user = null } = {}) {
  const license = detail?.summary || {};
  const activations = detail?.activations || [];
  const purchaseEvents = detail?.purchaseEvents || [];
  const licenseEvents = detail?.licenseEvents || [];

  const purchaseMarkup = purchaseEvents.length > 0
    ? purchaseEvents.map((event) => `
        <section class="card" style="padding: 16px; margin-top: 12px;">
          <div class="meta">
            <div><strong>Provider</strong>${escapeHtml(event.provider || "stripe")}</div>
            <div><strong>Status</strong>${escapeHtml(event.status || "-")}</div>
            <div><strong>Purchase Kind</strong>${escapeHtml(event.purchaseKind || "-")}</div>
            <div><strong>Environment</strong>${escapeHtml(event.environment || "-")}</div>
            <div><strong>Stripe Event</strong><code>${escapeHtml(event.stripeEventId || "-")}</code></div>
            <div><strong>Checkout Session</strong><code>${escapeHtml(event.checkoutSessionId || "-")}</code></div>
            <div><strong>Stripe Price</strong><code>${escapeHtml(event.priceId || event.stripePriceId || "-")}</code></div>
            <div><strong>Amount</strong>${escapeHtml(formatMoney(event.amountTotal, event.currency))}</div>
            <div><strong>Created</strong>${escapeHtml(formatDate(event.createdAt, true))}</div>
            <div><strong>Updated</strong>${escapeHtml(formatDate(event.updatedAt, true))}</div>
          </div>
          <div style="margin-top: 12px;">
            <strong style="display:block; margin-bottom:8px; color:#59655c; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.04em;">Metadata</strong>
            <pre>${escapeHtml(JSON.stringify(event.metadata || event.rawPayload || {}, null, 2))}</pre>
          </div>
        </section>
      `).join("")
    : '<div class="empty">No purchase records linked to this license.</div>';

  const activationRows = activations.length > 0
    ? activations.map((activation) => `
        <tr>
          <td>${escapeHtml(activation.deviceName || activation.deviceId || "-")}</td>
          <td><code>${escapeHtml(activation.deviceId || "-")}</code></td>
          <td>${escapeHtml(activation.email || "-")}</td>
          <td>${escapeHtml(formatDate(activation.activatedAt, true))}</td>
          <td>${escapeHtml(formatDate(activation.lastCheckInAt, true))}</td>
          <td>${activation.deactivatedAt ? '<span class="tag revoked">inactive</span>' : '<span class="tag">active</span>'}</td>
          <td>
            ${activation.deactivatedAt
              ? "-"
              : `
                <form method="post" action="/admin/licenses/${license.id}/activations/${activation.id}/release" onsubmit="return confirm('Release this device activation?');">
                  <button type="submit" class="secondary">Release Device</button>
                </form>
              `}
          </td>
        </tr>
      `).join("")
    : '<tr><td colspan="7"><div class="empty">No activations recorded for this license.</div></td></tr>';

  const eventRows = licenseEvents.length > 0
    ? licenseEvents.map((event) => `
        <tr>
          <td>${escapeHtml(formatDate(event.createdAt, true))}</td>
          <td>${escapeHtml(event.eventType || "-")}</td>
          <td>${escapeHtml(event.actorType || "-")}</td>
          <td>${escapeHtml(event.actorId || "-")}</td>
          <td>${event.activationId ? escapeHtml(String(event.activationId)) : "-"}</td>
          <td><pre>${escapeHtml(JSON.stringify(event.metadata || {}, null, 2))}</pre></td>
        </tr>
      `).join("")
    : '<tr><td colspan="6"><div class="empty">No license events recorded yet.</div></td></tr>';

  const body = `
    <div class="actions" style="margin-bottom: 16px;">
      <a href="/admin/licenses"><button type="button" class="secondary">Back to Licenses</button></a>
    </div>
    <div class="grid detail">
      <section class="card section-stack">
        <div>
          <h2>${escapeHtml(license.orgName || "License")}</h2>
          <div class="meta">
            <div><strong>License Key</strong><code>${escapeHtml(license.licenseKey || "-")}</code></div>
            <div><strong>Status</strong><span class="tag ${escapeHtml(license.status || "active")}">${escapeHtml(license.status || "active")}</span></div>
            <div><strong>Plan</strong>${escapeHtml(license.plan || "Essential")}</div>
            <div><strong>License Type</strong>${escapeHtml(license.licenseType || "annual")}</div>
            <div><strong>Environment</strong><span class="tag ${escapeHtml(license.environment || "test")}">${escapeHtml(license.environment || "test")}</span></div>
            <div><strong>Customer Email</strong>${escapeHtml(license.customerEmail || "-")}</div>
            <div><strong>Seats Allowed</strong>${escapeHtml(String(license.seatsAllowed || 0))}</div>
            <div><strong>Active Seat Count</strong>${escapeHtml(String(license.activeActivationCount || 0))}</div>
            <div><strong>Issued</strong>${escapeHtml(formatDate(license.issuedAt, true))}</div>
            <div><strong>Expiry Date</strong>${escapeHtml(formatDate(license.expiresAt))}</div>
            <div><strong>Support Expiry</strong>${escapeHtml(formatDate(license.supportExpiresAt))}</div>
            <div><strong>Last Check-In</strong>${escapeHtml(formatDate(license.lastCheckInAt, true))}</div>
            <div><strong>Notes</strong>${escapeHtml(license.notes || "-")}</div>
          </div>
        </div>
        <div>
          <h3>Activation History</h3>
          <div style="overflow:auto;">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Device ID</th>
                  <th>Email</th>
                  <th>Activated</th>
                  <th>Last Check-In</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>${activationRows}</tbody>
            </table>
          </div>
        </div>
        <div>
          <h3>License Events</h3>
          <div style="overflow:auto;">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Actor Type</th>
                  <th>Actor ID</th>
                  <th>Activation</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>${eventRows}</tbody>
            </table>
          </div>
        </div>
        <div>
          <h3>Purchase Linkage</h3>
          ${purchaseMarkup}
        </div>
      </section>
      <section class="card section-stack">
        <div>
          <h2>Actions</h2>
          <div class="actions">
            <form method="post" action="/admin/licenses/${license.id}/revoke" onsubmit="return confirm('Revoke this license?');">
              <button type="submit" class="danger">Revoke License</button>
            </form>
            <form method="post" action="/admin/licenses/${license.id}/reset-activations" onsubmit="return confirm('Reset all active seats for this license?');">
              <button type="submit" class="secondary">Reset Activations</button>
            </form>
            <form method="post" action="/admin/licenses/${license.id}/resend-email">
              <button type="submit" class="secondary">Resend Email</button>
            </form>
          </div>
        </div>
        <form method="post" action="/admin/licenses/${license.id}/extend" class="stack">
          <h3>Renew Annual Term</h3>
          <div class="field-grid">
            <label>
              Amount
              <input type="number" name="daysValue" min="1" value="365" />
            </label>
            <label>
              Unit
              <select name="daysUnit">
                <option value="days">Days</option>
                <option value="years">Years</option>
              </select>
            </label>
          </div>
          <label class="checkbox">
            <input type="checkbox" name="notifyCustomer" value="1" />
            Email the customer after this annual renewal
          </label>
          <button type="submit">Renew Annual License</button>
        </form>
        <form method="post" action="/admin/licenses/${license.id}/renew-maintenance" class="stack">
          <h3>Renew Maintenance</h3>
          <div class="field-grid">
            <label>
              Amount
              <input type="number" name="supportValue" min="1" value="365" />
            </label>
            <label>
              Unit
              <select name="supportUnit">
                <option value="days">Days</option>
                <option value="years">Years</option>
              </select>
            </label>
          </div>
          <label class="checkbox">
            <input type="checkbox" name="notifyCustomer" value="1" />
            Email the customer after this maintenance renewal
          </label>
          <button type="submit">Renew Maintenance</button>
        </form>
        <form method="post" action="/admin/licenses/${license.id}/reissue" class="stack" onsubmit="return confirm('Reissue this license and supersede the current key?');">
          <h3>Reissue License</h3>
          <label class="checkbox">
            <input type="checkbox" name="clearActivations" value="1" checked />
            Clear active device assignments on the superseded key
          </label>
          <label class="checkbox">
            <input type="checkbox" name="sendEmail" value="1" checked />
            Send the replacement key by email
          </label>
          <button type="submit">Reissue Key</button>
        </form>
      </section>
    </div>
  `;

  return layout({ title: `License ${license.licenseKey || ""}`, body, user, flash });
}

module.exports = {
  escapeHtml,
  formatDate,
  renderLoginPage,
  renderLicensesPage,
  renderLicenseDetailPage,
};

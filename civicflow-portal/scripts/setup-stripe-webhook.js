#!/usr/bin/env node
/**
 * Registers (or updates) the Unestra portal webhook endpoint in Stripe.
 *
 * Usage:
 *   node scripts/setup-stripe-webhook.js --url https://app.civicflow.com
 *
 * Required env:
 *   STRIPE_SECRET_KEY — your Stripe secret key (sk_live_... or sk_test_...)
 *
 * Outputs the webhook signing secret to add as STRIPE_WEBHOOK_SECRET in your
 * production environment. Run this once per deployment environment.
 */

const https = require("node:https");
const { argv } = require("node:process");

const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
];

function parseArgs() {
  const urlFlag = argv.indexOf("--url");
  if (urlFlag === -1 || !argv[urlFlag + 1]) {
    console.error("Usage: node scripts/setup-stripe-webhook.js --url https://your-domain.com");
    process.exit(1);
  }
  return argv[urlFlag + 1].replace(/\/$/, "");
}

function stripeRequest(method, path, body) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set");
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : "";
    const options = {
      hostname: "api.stripe.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(payload),
        "Stripe-Version": "2024-06-20",
        "User-Agent": "civicflow-setup-script/1.0",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listEndpoints() {
  const res = await stripeRequest("GET", "/v1/webhook_endpoints?limit=100", null);
  if (res.status !== 200) throw new Error(`List failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function createEndpoint(url) {
  const body = {
    url,
    description: "Unestra SaaS portal",
  };
  WEBHOOK_EVENTS.forEach((e, i) => {
    body[`enabled_events[${i}]`] = e;
  });

  const res = await stripeRequest("POST", "/v1/webhook_endpoints", body);
  if (res.status !== 200) throw new Error(`Create failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function updateEndpoint(id, url) {
  const body = { url };
  WEBHOOK_EVENTS.forEach((e, i) => {
    body[`enabled_events[${i}]`] = e;
  });

  const res = await stripeRequest("POST", `/v1/webhook_endpoints/${id}`, body);
  if (res.status !== 200) throw new Error(`Update failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function main() {
  const baseUrl = parseArgs();
  const endpointUrl = `${baseUrl}/api/webhooks/stripe`;

  console.log(`\nConfiguring Stripe webhook → ${endpointUrl}`);
  console.log(`Events: ${WEBHOOK_EVENTS.join(", ")}\n`);

  const existing = await listEndpoints();
  const match = existing.find((e) => e.url === endpointUrl);

  let endpoint;
  if (match) {
    console.log(`Found existing endpoint (${match.id}), updating...`);
    endpoint = await updateEndpoint(match.id, endpointUrl);
    console.log("Updated.");
  } else {
    console.log("No existing endpoint found, creating...");
    endpoint = await createEndpoint(endpointUrl);
    console.log("Created.");
  }

  console.log(`\nEndpoint ID : ${endpoint.id}`);
  console.log(`Status      : ${endpoint.status}`);

  if (endpoint.secret) {
    console.log(`\n✓ Add this to your production environment:\n`);
    console.log(`  STRIPE_WEBHOOK_SECRET=${endpoint.secret}\n`);
  } else {
    console.log(
      "\nNote: The webhook secret is only returned on creation, not on updates.\n" +
      "If you need the secret, delete the endpoint in the Stripe dashboard and re-run this script.\n"
    );
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

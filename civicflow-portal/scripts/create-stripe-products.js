#!/usr/bin/env node
/**
 * Creates CivicFlow products and prices in Stripe.
 * Safe to run multiple times — looks up existing products/prices by metadata
 * before creating, so it won't duplicate.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/create-stripe-products.js
 *
 * Outputs the price IDs to add to your environment.
 */

const https = require("node:https");

const PRODUCTS = [
  {
    key: "cloud",
    name: "CivicFlow Cloud",
    description: "Cloud-hosted membership and financial management for community organizations.",
    prices: [
      {
        key: "cloud_monthly",
        nickname: "CivicFlow Cloud — Monthly",
        unitAmount: 4999, // $49.99
        currency: "usd",
        recurring: { interval: "month" },
        envVar: "STRIPE_PRICE_ESSENTIAL_MONTHLY",
      },
    ],
  },
  {
    key: "desktop",
    name: "CivicFlow Desktop",
    description: "Desktop application license for offline membership and financial management.",
    prices: [
      {
        key: "desktop_license",
        nickname: "CivicFlow Desktop — License",
        unitAmount: 59900, // $599.00
        currency: "usd",
        recurring: null, // one-time
        envVar: "STRIPE_PRICE_DESKTOP_LICENSE",
      },
      {
        key: "desktop_maintenance",
        nickname: "CivicFlow Desktop — Maintenance & Updates",
        unitAmount: 14900, // $149.00
        currency: "usd",
        recurring: { interval: "year" },
        envVar: "STRIPE_PRICE_DESKTOP_MAINTENANCE",
      },
    ],
  },
];

function stripeRequest(method, path, body) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set");
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(flattenForStripe(body)).toString() : "";
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

// Stripe API requires nested objects as flat bracket notation: metadata[key]=value
function flattenForStripe(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenForStripe(v, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

async function listAll(path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await stripeRequest("GET", `${path}${sep}limit=100`, null);
  if (res.status !== 200) throw new Error(`List failed (${path}): ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function findProductByKey(key) {
  const products = await listAll("/v1/products");
  return products.find((p) => p.metadata?.civicflow_key === key && !p.deleted) ?? null;
}

async function findPriceByKey(productId, key) {
  const prices = await listAll(`/v1/prices?product=${productId}`);
  return prices.find((p) => p.metadata?.civicflow_key === key && p.active) ?? null;
}

async function createProduct(def) {
  const res = await stripeRequest("POST", "/v1/products", {
    name: def.name,
    description: def.description,
    metadata: { civicflow_key: def.key },
  });
  if (res.status !== 200) throw new Error(`Create product failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function createPrice(productId, def) {
  const body = {
    product: productId,
    nickname: def.nickname,
    unit_amount: def.unitAmount,
    currency: def.currency,
    metadata: { civicflow_key: def.key },
  };
  if (def.recurring) {
    body["recurring[interval]"] = def.recurring.interval;
    if (def.recurring.intervalCount) {
      body["recurring[interval_count]"] = def.recurring.intervalCount;
    }
  }

  const res = await stripeRequest("POST", "/v1/prices", body);
  if (res.status !== 200) throw new Error(`Create price failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

function formatAmount(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

async function main() {
  const results = [];

  for (const productDef of PRODUCTS) {
    console.log(`\n── ${productDef.name} ──`);

    let product = await findProductByKey(productDef.key);
    if (product) {
      console.log(`  Product: ${product.id} (existing)`);
    } else {
      product = await createProduct(productDef);
      console.log(`  Product: ${product.id} (created)`);
    }

    for (const priceDef of productDef.prices) {
      let price = await findPriceByKey(product.id, priceDef.key);
      const interval = priceDef.recurring
        ? `${priceDef.recurring.interval}ly`
        : "one-time";

      if (price) {
        console.log(`  Price:   ${price.id}  ${formatAmount(priceDef.unitAmount)} ${interval}  (existing)`);
      } else {
        price = await createPrice(product.id, priceDef);
        console.log(`  Price:   ${price.id}  ${formatAmount(priceDef.unitAmount)} ${interval}  (created)`);
      }

      results.push({ envVar: priceDef.envVar, priceId: price.id, description: priceDef.nickname });
    }
  }

  console.log("\n─────────────────────────────────────────");
  console.log("Add to your environment:\n");
  for (const r of results) {
    console.log(`  ${r.envVar}=${r.priceId}`);
  }
  console.log(
    "\nNote: STRIPE_PRICE_DESKTOP_* are informational — the portal billing flow\n" +
    "uses only STRIPE_PRICE_ESSENTIAL_MONTHLY. Desktop licenses are sold via\n" +
    "the license server, not the portal checkout."
  );
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});

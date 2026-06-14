import { NextRequest, NextResponse } from "next/server";

type ProductCode =
  | "essential_annual"
  | "elite_annual"
  | "essential_perpetual"
  | "elite_perpetual"
  | "annual_renewal"
  | "maintenance_renewal";

type RenewalPlan = "Essential" | "Elite";

const PRODUCT_CODES: ProductCode[] = [
  "essential_annual",
  "elite_annual",
  "essential_perpetual",
  "elite_perpetual",
  "annual_renewal",
  "maintenance_renewal",
];

const RENEWAL_PLANS: RenewalPlan[] = ["Essential", "Elite"];

function isProductCode(value: string): value is ProductCode {
  return PRODUCT_CODES.includes(value as ProductCode);
}

function isRenewalPlan(value: string): value is RenewalPlan {
  return RENEWAL_PLANS.includes(value as RenewalPlan);
}

function resolveLicenseServerBaseUrl() {
  const preferred = String(process.env.CIVICFLOW_LICENSE_SERVER_URL || "").trim();
  if (preferred) {
    return preferred.replace(/\/+$/, "");
  }

  const legacy = String(process.env.ACTIVATION_API_URL || "").trim();
  if (legacy && process.env.NODE_ENV !== "production") {
    return legacy.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("CIVICFLOW_LICENSE_SERVER_URL is required in production.");
  }

  return "http://127.0.0.1:4000";
}

function requireAbsoluteHttpUrl(value: string, label: string) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`${label} is required.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
  }

  return parsed.toString();
}

function requireEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function resolvePriceId(productCode: ProductCode, renewalPlan: RenewalPlan | null) {
  switch (productCode) {
    case "essential_annual":
      return requireEnv("STRIPE_PRICE_ID_ANNUAL_ESSENTIAL");
    case "elite_annual":
      return requireEnv("STRIPE_PRICE_ID_ANNUAL_ELITE");
    case "essential_perpetual":
      return requireEnv("STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL");
    case "elite_perpetual":
      return requireEnv("STRIPE_PRICE_ID_PERPETUAL_ELITE");
    case "annual_renewal":
      return renewalPlan === "Elite"
        ? requireEnv("STRIPE_PRICE_ID_ANNUAL_ELITE")
        : requireEnv("STRIPE_PRICE_ID_ANNUAL_ESSENTIAL");
    case "maintenance_renewal":
      return renewalPlan === "Elite"
        ? requireEnv("STRIPE_PRICE_ID_PERPETUAL_ELITE")
        : requireEnv("STRIPE_PRICE_ID_PERPETUAL_ESSENTIAL");
    default:
      return "";
  }
}

function resolvePurchaseKind(productCode: ProductCode) {
  if (productCode === "annual_renewal") return "annual_renewal";
  if (productCode === "maintenance_renewal") return "maintenance_renewal";
  return "new_purchase";
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawProductCode = String(body?.productCode || "").trim();
    const productCode = isProductCode(rawProductCode) ? rawProductCode : null;
    const customerEmail = String(body?.customerEmail || "").trim();
    const organizationName = String(body?.organizationName || "").trim();
    const targetLicenseKey = String(body?.targetLicenseKey || "").trim() || null;
    const environment = String(body?.environment || "test").trim().toLowerCase() === "prod" ? "prod" : "test";
    const rawRenewalPlan = String(body?.renewalPlan || "Essential").trim();
    const renewalPlan = isRenewalPlan(rawRenewalPlan) ? rawRenewalPlan : "Essential";
    const successUrl = requireAbsoluteHttpUrl(String(body?.successUrl || "").trim(), "successUrl");
    const cancelUrl = requireAbsoluteHttpUrl(String(body?.cancelUrl || "").trim(), "cancelUrl");

    if (!productCode) {
      return jsonError("productCode is required and must be a supported CivicFlow product.", 400);
    }
    if (!customerEmail) {
      return jsonError("customerEmail is required.", 400);
    }
    if (!organizationName) {
      return jsonError("organizationName is required.", 400);
    }
    if ((productCode === "annual_renewal" || productCode === "maintenance_renewal") && !targetLicenseKey) {
      return jsonError("targetLicenseKey is required for renewals.", 400);
    }

    let priceId: string;
    let licenseServerBaseUrl: string;
    try {
      priceId = resolvePriceId(productCode, renewalPlan);
      licenseServerBaseUrl = resolveLicenseServerBaseUrl();
    } catch (configurationError) {
      return jsonError(String((configurationError as Error)?.message || "Portal checkout is misconfigured."), 500);
    }

    let response: Response;
    try {
      response = await fetch(`${licenseServerBaseUrl}/api/store/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId,
          purchaseKind: resolvePurchaseKind(productCode),
          customerEmail,
          organizationName,
          targetLicenseKey,
          environment,
          successUrl,
          cancelUrl,
        }),
        cache: "no-store",
      });
    } catch (upstreamError) {
      return jsonError(
        String((upstreamError as Error)?.message || "Unable to reach the CivicFlow license server."),
        502
      );
    }

    const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";
    const bodyBuffer = await response.arrayBuffer();
    return new NextResponse(bodyBuffer, {
      status: response.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = String((error as Error)?.message || "Checkout request failed.");
    const status = message.includes("required") || message.includes("valid absolute URL") || message.includes("must use http or https")
      ? 400
      : 500;
    return jsonError(message, status);
  }
}

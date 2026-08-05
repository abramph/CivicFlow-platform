import type { DuesPaymentMethod } from "@prisma/client";

export type PaymentMethodCategory = "native" | "external" | "offline";

/**
 * Categorizes an already-configured PaymentMethodConfig.method for display
 * purposes -- see docs/flexible-payment-links.md. Derived from the existing
 * enum rather than a new schema column.
 */
export function getPaymentMethodCategory(method: DuesPaymentMethod): PaymentMethodCategory {
  if (method === "STRIPE") return "native";
  if (method === "PAYPAL" || method === "VENMO" || method === "CASH_APP") return "external";
  return "offline";
}

/**
 * Builds a tappable universal-payment-link URL for methods that have one.
 * Hardened version of the logic previously duplicated inline in
 * PayableMethodsList.tsx: parses with `new URL()` rather than a bare regex,
 * and only ever returns an `https:` URL -- never `http:`, `javascript:`,
 * `data:`, or any other scheme, closing off the class of scheme-based
 * attacks outright rather than trying to blocklist each one. Used both by
 * the existing "Ways to Pay" member-facing list and the new public payment
 * page, so both surfaces get the same hardening from one place.
 */
export function buildPayLink(method: DuesPaymentMethod, accountIdentifier: string): string | null {
  const trimmed = accountIdentifier.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  switch (method) {
    case "CASH_APP": {
      const cashtag = trimmed.replace(/^\$/, "");
      return cashtag ? `https://cash.app/$${encodeURIComponent(cashtag)}` : null;
    }
    case "VENMO": {
      const username = trimmed.replace(/^@/, "");
      return username ? `https://venmo.com/u/${encodeURIComponent(username)}` : null;
    }
    case "PAYPAL": {
      const handle = trimmed.replace(/^@/, "");
      return handle ? `https://paypal.me/${encodeURIComponent(handle)}` : null;
    }
    default:
      return null;
  }
}

/** The hostname a built pay link points to, for the "you're leaving Unestra
 * to pay via {label} at {hostname}" interstitial notice on the public page. */
export function getPayLinkHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

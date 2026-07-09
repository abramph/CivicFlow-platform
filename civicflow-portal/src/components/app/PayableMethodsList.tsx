import type { DuesPaymentMethod, PaymentMethodConfig } from "@prisma/client";

/** Only methods staff actually configured with a handle/instructions are actionable. */
export function filterPayableMethods(methods: PaymentMethodConfig[]) {
  return methods.filter((method) => method.accountIdentifier || method.instructions);
}

/**
 * Builds a tappable deep link for methods that have a real universal payment
 * URL. Cash, check, Zelle, ACH, and card/OTHER methods have no such link (Zelle
 * in particular only works from inside the sender's own banking app, with no
 * public "pay to this handle" URL) — those stay as plain text with instructions.
 */
function buildPayLink(method: DuesPaymentMethod, accountIdentifier: string): string | null {
  const trimmed = accountIdentifier.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

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

export function PayableMethodsList({ methods }: { methods: PaymentMethodConfig[] }) {
  if (methods.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Ways to Pay</h2>
      </div>
      <div className="divide-y divide-slate-100">
        {methods.map((method) => {
          const payLink = method.accountIdentifier ? buildPayLink(method.method, method.accountIdentifier) : null;
          return (
            <div key={method.id} className="px-4 py-3 text-sm">
              <p className="font-semibold text-slate-900">{method.label}</p>
              {method.accountIdentifier ? (
                payLink ? (
                  <a
                    href={payLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 hover:underline"
                  >
                    {method.accountIdentifier}
                  </a>
                ) : (
                  <p className="text-slate-800">{method.accountIdentifier}</p>
                )
              ) : null}
              {method.instructions ? <p className="mt-1 text-slate-600">{method.instructions}</p> : null}
            </div>
          );
        })}
      </div>
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        After paying, report it so your treasurer can confirm it.
      </p>
    </div>
  );
}

import type { PaymentMethodConfig } from "@prisma/client";
import { buildPayLink } from "@/lib/payment-method-links";

/** Only methods staff actually configured with a handle/instructions are actionable. */
export function filterPayableMethods(methods: PaymentMethodConfig[]) {
  return methods.filter((method) => method.accountIdentifier || method.instructions);
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

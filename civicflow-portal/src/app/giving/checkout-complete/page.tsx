/**
 * CORE-GIVE-L — session-less landing after a mobile-initiated checkout in
 * the system browser. Purely informational: the webhook is the only
 * recorder (§7); the app refreshes its own state when the member returns.
 */
export default async function GivingCheckoutCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const cancelled = state === "cancelled";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        {cancelled ? (
          <>
            <h1 className="text-xl font-bold text-slate-900">Checkout cancelled</h1>
            <p className="mt-2 text-sm text-slate-700">
              No payment was made and nothing was recorded. You can return to the Unestra app.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900">Thank you</h1>
            <p className="mt-2 text-sm text-slate-700">
              Your payment is being processed securely. You can return to the Unestra app — your giving history updates
              automatically once the payment settles.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

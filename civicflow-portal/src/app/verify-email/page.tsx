import Link from "next/link";

type SearchParams = Promise<{ token?: string }>;

async function verifyToken(token: string): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = String(process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  try {
    const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || "Verification failed." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Unable to verify. Please try again." };
  }
}

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = params.token?.trim();

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <p className="text-sm text-slate-600">No verification token found in this link.</p>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:underline">Back to sign in</Link>
        </div>
      </div>
    );
  }

  const result = await verifyToken(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        {result.ok ? (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-2xl">✓</div>
            <h1 className="text-xl font-bold text-slate-900">Email verified!</h1>
            <p className="mt-2 text-sm text-slate-600">Your account is now active. You can sign in.</p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 text-2xl">✕</div>
            <h1 className="text-xl font-bold text-slate-900">Verification failed</h1>
            <p className="mt-2 text-sm text-slate-600">{result.error}</p>
            <Link href="/signup" className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:underline">
              Back to sign up
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

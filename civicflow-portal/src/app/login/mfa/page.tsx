import { MfaChallengeContent } from "@/components/MfaChallengeContent";

type SearchParams = Promise<{ redirectTo?: string }>;

/** Mirrors the same allow-list in LoginForm.tsx — only the QR attendance
 * check-in link survives the MFA detour, never an arbitrary destination. */
function safeRedirectTo(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw === "/attendance/check-in" || raw.startsWith("/attendance/check-in?") ? raw : null;
}

// Reading `searchParams` here (rather than via useSearchParams() in the
// client component) forces this route to render dynamically per-request
// instead of Next statically optimizing it — the earlier "use client" page
// with no server-side dynamic API bailed out to client-side-only rendering
// for the whole page, which never recovered in production behind DO's
// Cloudflare edge (a streaming RSC fetch that page depended on to fill in
// the client-rendered shell kept failing with "Connection closed", leaving
// real users stuck on this page's blank Suspense fallback with no way to
// enter their MFA code and finish logging in).
export default async function MfaChallengePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const redirectTo = safeRedirectTo(params.redirectTo);

  return <MfaChallengeContent redirectTo={redirectTo} />;
}

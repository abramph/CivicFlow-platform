import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

type SearchParams = Promise<{ token?: string; meeting?: string; org?: string; status?: string; time?: string }>;

interface CheckInApiResult {
  ok: boolean;
  error?: string;
  data?: {
    meetingTitle: string;
    meetingDate: string;
    attendanceStatus: "PRESENT" | "LATE";
    checkInTime: string;
    organizationId: string;
    alreadyCheckedIn: boolean;
  };
}

async function submitCheckIn(token: string): Promise<CheckInApiResult> {
  const baseUrl = String(process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  try {
    const cookieHeader = (await cookies()).toString();
    const res = await fetch(`${baseUrl}/api/member-portal/attendance/check-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ qrToken: token }),
      cache: "no-store",
    });
    const data = (await res.json()) as CheckInApiResult;
    if (!res.ok) return { ok: false, error: data.error || "Unable to check in." };
    return data;
  } catch {
    return { ok: false, error: "Unable to connect. Please try again." };
  }
}

function ResultCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">{children}</div>
    </div>
  );
}

export default async function AttendanceCheckInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // Already processed and redirected here with display data, no raw token
  // left in the URL — render the confirmation directly, no re-submission.
  if (!params.token && params.meeting) {
    return (
      <ResultCard>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-2xl">✓</div>
        <h1 className="text-xl font-bold text-slate-900">You&apos;re checked in</h1>
        <div className="mt-4 space-y-1 text-sm text-slate-700">
          <p className="font-semibold">{decodeURIComponent(params.meeting)}</p>
          {params.org ? <p className="text-slate-500">{decodeURIComponent(params.org)}</p> : null}
          {params.time ? <p className="text-slate-500">{new Date(params.time).toLocaleString()}</p> : null}
          {params.status === "LATE" ? (
            <p className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Marked Late</p>
          ) : (
            <p className="mt-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">Present</p>
          )}
        </div>
        <Link href="/m/dashboard" className="mt-6 inline-block rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          Back to Meetings
        </Link>
      </ResultCard>
    );
  }

  const token = params.token?.trim();
  if (!token) {
    return (
      <ResultCard>
        <p className="text-sm text-slate-600">No check-in code found in this link.</p>
        <Link href="/m/dashboard" className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:underline">Back to Meetings</Link>
      </ResultCard>
    );
  }

  const result = await submitCheckIn(token);

  if (!result.ok || !result.data) {
    return (
      <ResultCard>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 text-2xl">✕</div>
        <h1 className="text-xl font-bold text-slate-900">Check-in didn&apos;t go through</h1>
        <p className="mt-2 text-sm text-slate-600">{result.error}</p>
        <Link href="/m/dashboard" className="mt-6 inline-block rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          Back to Meetings
        </Link>
      </ResultCard>
    );
  }

  const org = await prisma.organization.findUnique({ where: { id: result.data.organizationId }, select: { name: true } });

  // Redirect to a clean URL (no token) carrying only display data — this is
  // what actually removes the token from browser history, per the security
  // requirement that a captured link isn't reusable/replayable from history.
  const confirmUrl = new URL("/attendance/check-in", process.env.NEXTAUTH_URL || "http://localhost:3000");
  confirmUrl.searchParams.set("meeting", encodeURIComponent(result.data.meetingTitle));
  if (org?.name) confirmUrl.searchParams.set("org", encodeURIComponent(org.name));
  confirmUrl.searchParams.set("status", result.data.attendanceStatus);
  confirmUrl.searchParams.set("time", result.data.checkInTime);
  redirect(confirmUrl.pathname + confirmUrl.search);
}

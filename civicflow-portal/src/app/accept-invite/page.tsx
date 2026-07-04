import Link from "next/link";
import { AcceptInviteForm } from "@/components/AcceptInviteForm";

type SearchParams = Promise<{ token?: string }>;

export default async function AcceptInvitePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = params.token?.trim();

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <p className="text-sm text-slate-600">No invite token found in this link. Ask your organization to resend your invite.</p>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <AcceptInviteForm token={token} />
    </div>
  );
}

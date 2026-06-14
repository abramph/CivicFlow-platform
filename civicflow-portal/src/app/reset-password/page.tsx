import Link from "next/link";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

type SearchParams = Promise<{ token?: string }>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = params.token?.trim();

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <p className="text-sm text-slate-600">No reset token found in this link. Request a new one.</p>
          <Link href="/forgot-password" className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:underline">
            Request password reset
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <ResetPasswordForm token={token} />
    </div>
  );
}

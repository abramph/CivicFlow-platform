import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { LoginForm } from "@/components/LoginForm";

type SearchParams = Promise<{ verified?: string; redirectTo?: string }>;

function safeRedirectTo(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw === "/attendance/check-in" || raw.startsWith("/attendance/check-in?") ? raw : null;
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const redirectTo = safeRedirectTo(params.redirectTo);

  const session = await getServerSession(authOptions);
  if (session?.userId) {
    redirect(redirectTo ?? "/select-organization");
  }
  if (session?.api_key) {
    redirect("/dashboard");
  }

  const verified = params.verified === "1";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <Suspense fallback={null}>
        <LoginForm verified={verified} />
      </Suspense>
    </div>
  );
}

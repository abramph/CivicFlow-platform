import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { LoginForm } from "@/components/LoginForm";

type SearchParams = Promise<{ verified?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getServerSession(authOptions);
  if (session?.userId || session?.api_key) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const verified = params.verified === "1";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <LoginForm verified={verified} />
    </div>
  );
}

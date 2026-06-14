import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { SignupForm } from "@/components/SignupForm";

export default async function SignupPage() {
  const session = await getServerSession(authOptions);
  if (session?.userId || session?.api_key) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <SignupForm />
    </div>
  );
}

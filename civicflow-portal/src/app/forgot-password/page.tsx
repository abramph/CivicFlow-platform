import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export default async function ForgotPasswordPage() {
  const session = await getServerSession(authOptions);
  if (session?.userId) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <ForgotPasswordForm />
    </div>
  );
}

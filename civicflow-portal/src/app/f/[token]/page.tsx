import { notFound } from "next/navigation";
import { resolvePublicIntakeForm } from "@/lib/member-intake/forms";
import { PublicIntakeFormClient } from "@/components/public/PublicIntakeFormClient";

/**
 * The public, unauthenticated Member Intake form -- no account, no app
 * install, works in a mobile browser. Deliberately a server component that
 * does exactly one thing (resolve the token, 404 uniformly on any failure
 * reason) before handing off to a client component for the interactive
 * fill/submit/verify flow — mirrors /pay/[slug]/page.tsx's shape for the
 * other existing public, tokenized page in this app.
 */
export default async function PublicMemberIntakeFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ src?: string }>;
}) {
  const { token } = await params;
  const { src } = await searchParams;

  const form = await resolvePublicIntakeForm(token);
  if (!form) notFound();

  return <PublicIntakeFormClient token={token} sourceToken={src ?? null} form={form} />;
}

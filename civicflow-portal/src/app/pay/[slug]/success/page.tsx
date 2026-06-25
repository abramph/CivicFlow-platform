import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function PaymentSuccessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const link = await prisma.paymentLink.findUnique({
    where: { slug },
    include: { organization: { select: { name: true } } },
  });

  if (!link) notFound();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
          <svg className="h-7 w-7 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-950">Payment received!</h1>
        <p className="mt-2 text-sm text-slate-600">
          Thank you. {link.organization.name} has received your payment.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          A receipt will be sent to your email if you provided one.
        </p>
        <Link
          href={`/pay/${slug}`}
          className="mt-6 inline-block rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Make another payment
        </Link>
      </div>
    </div>
  );
}

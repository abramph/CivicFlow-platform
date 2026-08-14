import { notFound } from "next/navigation";
import Image from "next/image";
import { getPublicGivingPage } from "@/lib/giving/public-giving";
import { PublicGiveForm } from "@/components/public/PublicGiveForm";

/**
 * CORE-GIVE-J (§55) — the public giving page. No session; renders ONLY what
 * the organization published (see the security review in
 * docs/core-contributions-giving.md §10). Unknown slug, module off, and
 * page off all 404 identically.
 */
export default async function PublicGivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPublicGivingPage(slug);
  if (!page) notFound();

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          {page.organization.logoUrl ? (
            <Image
              src={page.organization.logoUrl}
              alt=""
              width={64}
              height={64}
              className="mx-auto mb-3 h-16 w-16 rounded-xl object-contain"
            />
          ) : null}
          <h1 className="text-2xl font-bold text-slate-900">{page.organization.name}</h1>
          <p className="mt-1 text-sm font-medium text-emerald-700">{page.terminology}</p>
          {page.message ? <p className="mt-2 text-sm text-slate-600">{page.message}</p> : null}
        </div>

        {page.campaigns.length > 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Campaigns</h2>
            <ul className="mt-2 space-y-3">
              {page.campaigns.map((campaign) => {
                const percent =
                  campaign.goal && campaign.goal > 0 ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100)) : null;
                return (
                  <li key={campaign.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-900">{campaign.name}</span>
                      <span className="text-slate-600">
                        ${campaign.raised.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        {campaign.goal ? ` of $${campaign.goal.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}
                      </span>
                    </div>
                    {percent !== null ? (
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
                      </div>
                    ) : null}
                    {campaign.description ? <p className="mt-1 text-xs text-slate-500">{campaign.description}</p> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {page.funds.length === 0 ? (
            <p className="text-sm text-slate-600">This organization is not accepting online gifts right now.</p>
          ) : (
            <PublicGiveForm slug={slug} funds={page.funds} />
          )}
        </div>
        <p className="text-center text-xs text-slate-400">
          Every gift here is voluntary. Payments are processed securely by Stripe — card details never touch this site.
        </p>
      </div>
    </div>
  );
}

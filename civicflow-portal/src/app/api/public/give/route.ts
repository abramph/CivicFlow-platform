import { withApiErrorHandling } from "@/lib/api-route";
import { validatePublicGivingRequest } from "@/lib/giving/public-giving";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { getStripe } from "@/lib/stripe";
import { getServerEnv } from "@/lib/env";

const bodySchema = z.object({
  slug: z.string().min(1).max(100),
  fundId: z.string().min(1).max(64),
  amount: z.number().positive().max(1_000_000),
  guestName: z.string().max(120).nullable().optional(),
  guestEmail: z.string().email().max(200).nullable().optional(),
  anonymous: z.boolean().optional(),
});

/**
 * CORE-GIVE-J — public guest checkout. NO session; rate-limited harder than
 * the member route. The org is resolved from the slug server-side; all
 * metadata is server-stamped; recording happens exclusively in the webhook.
 * The response shape never varies with roster contents (§57 — no
 * member-existence oracle).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:public:give", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { organizationId, amount, fund } = await validatePublicGivingRequest({
      slug: input.slug,
      fundId: input.fundId,
      amount: input.amount,
    });

    const stripe = getStripe();
    const env = getServerEnv();
    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: fund.name, description: "Contribution" },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      ...(input.guestEmail ? { customer_email: input.guestEmail } : {}),
      success_url: `${baseUrl}/give/${encodeURIComponent(input.slug)}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/give/${encodeURIComponent(input.slug)}`,
      metadata: {
        product: "Unestra",
        platformOwner: "APH Technologies, LLC",
        paymentType: "public-giving",
        organizationId,
        givingFundId: fund.id,
        guestName: input.guestName?.trim().slice(0, 120) ?? "",
        guestEmail: input.guestEmail?.trim().slice(0, 200) ?? "",
        anonymityMode: input.anonymous ? "PUBLICLY_ANONYMOUS" : "NONE",
        environment: process.env.NODE_ENV ?? "development",
      },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return Response.json({ ok: true, url: session.url });
  });
}

import type { PtaVolunteerElectionType } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { resolveHouseholdRequirement, type HouseholdRequirementResult } from "./assignments";
import { getHouseholdLedgerTotals, type HouseholdLedgerTotals } from "./ledger";
import { assertBuyoutWindowOpen, getVolunteerRequirementPeriod } from "./periods";
import { resolveVolunteerBuyoutRate } from "./pricing";

/**
 * The shared eligibility gate every FULL_BUYOUT/PARTIAL_BUYOUT quote,
 * election, or checkout must pass — deliberately separate from price
 * resolution so an ELECTION-locked checkout (which skips `buildBuyoutQuote`
 * entirely to preserve its frozen price) still gets the SAME live
 * eligibility re-check every fresh quote gets. Never applied to VOLUNTEER
 * elections, which are always free and available regardless of buyout
 * window state. `remainingMinutes` already reflects COMPLETED purchases
 * (via `getHouseholdLedgerTotals`) — a family that already fully bought out
 * or worked their requirement has nothing left to buy. Duplicate-completion
 * risk from a second, concurrently-PENDING purchase is closed separately in
 * `purchases.ts` by superseding any prior PENDING purchase before a new
 * checkout is created, not by restricting how many hours are purchasable —
 * restricting hours here would also block a family legitimately retrying
 * after an abandoned/failed checkout attempt.
 */
function assertBuyoutEligible(
  period: Parameters<typeof assertBuyoutWindowOpen>[0],
  requirement: HouseholdRequirementResult,
  remainingMinutes: number,
  now: Date
): void {
  assertBuyoutWindowOpen(period, now);
  if (requirement.exempt) {
    throw new PtaError("PTA_VOLUNTEER_HOUSEHOLD_EXEMPT", "This household is exempt from the volunteer-hour requirement — there is nothing to buy out.");
  }
  if (remainingMinutes <= 0) {
    throw new PtaError(
      "PTA_VOLUNTEER_ALREADY_SATISFIED",
      "This household's requirement is already fully met by verified hours and/or completed purchases."
    );
  }
}

/** Bump whenever the family-facing disclosure text materially changes — an
 * already-made election keeps the version it was made under, never
 * silently reinterpreted by a later policy-text edit (mirrors
 * SMS_CONSENT_VERSION's pattern in sms-consent-text.ts). */
export const VOLUNTEER_HOURS_ACK_VERSION = "2026-08-28.1";

export interface FamilyVolunteerSummary {
  period: Awaited<ReturnType<typeof getVolunteerRequirementPeriod>>;
  requirement: HouseholdRequirementResult;
  totals: HouseholdLedgerTotals;
  /** max(0, adjusted required − verified − purchased − credits − waived) —
   * spec §5's exact remaining-hours formula. */
  remainingMinutes: number;
  perHourRateCents: number | null;
  fullBuyoutRateCents: number | null;
  finalAssessmentRateCents: number | null;
}

export async function getFamilyVolunteerSummary(
  organizationId: string,
  periodId: string,
  householdId: string
): Promise<FamilyVolunteerSummary> {
  const [period, requirement, totals, perHour, fullBuyout, finalAssessment] = await Promise.all([
    getVolunteerRequirementPeriod(organizationId, periodId),
    resolveHouseholdRequirement(organizationId, periodId, householdId),
    getHouseholdLedgerTotals(organizationId, periodId, householdId),
    resolveVolunteerBuyoutRate(organizationId, periodId, "PER_HOUR"),
    resolveVolunteerBuyoutRate(organizationId, periodId, "FULL_BUYOUT"),
    resolveVolunteerBuyoutRate(organizationId, periodId, "FINAL_ASSESSMENT"),
  ]);

  const remainingMinutes = Math.max(
    0,
    requirement.requiredMinutes - totals.verifiedMinutes - totals.purchasedMinutes - totals.creditMinutes - totals.waivedMinutes
  );

  return {
    period,
    requirement,
    totals,
    remainingMinutes,
    perHourRateCents: perHour?.amountCents ?? null,
    fullBuyoutRateCents: fullBuyout?.amountCents ?? null,
    finalAssessmentRateCents: finalAssessment?.amountCents ?? null,
  };
}

export interface BuyoutQuoteInput {
  electionType: PtaVolunteerElectionType;
  hoursElectedMinutes?: number;
}

export interface BuyoutQuote {
  electionType: PtaVolunteerElectionType;
  hoursElectedMinutes: number;
  rateCents: number;
  totalCents: number;
  pricingWindowId: string | null;
  remainingAfterMinutes: number;
}

/** The server-side quote authority every election/checkout call site must
 * use — never trusts a client-supplied price or hour count beyond the raw
 * requested amount, which is itself validated against the period's policy
 * limits before any rate is applied. */
export async function buildBuyoutQuote(organizationId: string, periodId: string, householdId: string, input: BuyoutQuoteInput): Promise<BuyoutQuote> {
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);
  const requirement = await resolveHouseholdRequirement(organizationId, periodId, householdId);
  const totals = await getHouseholdLedgerTotals(organizationId, periodId, householdId);
  const remainingMinutes = Math.max(
    0,
    requirement.requiredMinutes - totals.verifiedMinutes - totals.purchasedMinutes - totals.creditMinutes - totals.waivedMinutes
  );
  const serviceFloorMinutes = period.buyoutMinServiceMinutes ?? 0;
  const maxBuyableMinutes = Math.max(0, requirement.requiredMinutes - serviceFloorMinutes);

  if (input.electionType === "VOLUNTEER") {
    return { electionType: "VOLUNTEER", hoursElectedMinutes: 0, rateCents: 0, totalCents: 0, pricingWindowId: null, remainingAfterMinutes: remainingMinutes };
  }

  const now = new Date();
  assertBuyoutEligible(period, requirement, remainingMinutes, now);

  if (input.electionType === "FULL_BUYOUT") {
    if (!period.buyoutFullAllowed) {
      throw new PtaError("PTA_VALIDATION_ERROR", "A full buyout is not offered for this requirement period.");
    }
    if (serviceFloorMinutes > 0) {
      throw new PtaError("PTA_VALIDATION_ERROR", "This period requires a minimum amount of actual service — a full buyout isn't available.");
    }
    const window = await resolveVolunteerBuyoutRate(organizationId, periodId, "FULL_BUYOUT", now);
    if (!window) throw new PtaError("PTA_VOLUNTEER_NO_APPLICABLE_RATE", "No full-buyout rate is currently active for this period.");

    const hoursElectedMinutes = requirement.requiredMinutes;
    return {
      electionType: "FULL_BUYOUT",
      hoursElectedMinutes,
      rateCents: window.amountCents,
      totalCents: window.amountCents,
      pricingWindowId: window.id,
      remainingAfterMinutes: Math.max(0, remainingMinutes - hoursElectedMinutes),
    };
  }

  // PARTIAL_BUYOUT
  const requested = input.hoursElectedMinutes;
  if (requested == null || !Number.isInteger(requested) || requested <= 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Choose how many hours to buy.");
  }
  const increment = period.buyoutIncrementMinutes || 60;
  if (requested % increment !== 0) {
    throw new PtaError(
      "PTA_VALIDATION_ERROR",
      `Hours must be purchased in increments of ${increment === 60 ? "whole hours" : increment === 30 ? "half hours" : `${increment}-minute blocks`}.`
    );
  }
  const minPurchase = period.buyoutMinPurchaseMinutes ?? increment;
  if (requested < minPurchase) {
    throw new PtaError("PTA_VALIDATION_ERROR", `You must purchase at least ${(minPurchase / 60).toString()} hours.`);
  }
  // Bounded by the period's configured max, the requirement-minus-service-floor
  // ceiling, AND (FC-5) what's actually still owed after verified hours and
  // completed purchases — never let a family buy more than they could
  // possibly still owe, on top of the period's own configured limits.
  const maxPurchase = Math.min(period.buyoutMaxPurchaseMinutes ?? maxBuyableMinutes, maxBuyableMinutes, remainingMinutes);
  if (requested > maxPurchase) {
    throw new PtaError("PTA_VALIDATION_ERROR", `You can purchase at most ${(maxPurchase / 60).toString()} hours for this period.`);
  }

  const window = await resolveVolunteerBuyoutRate(organizationId, periodId, "PER_HOUR", now);
  if (!window) throw new PtaError("PTA_VOLUNTEER_NO_APPLICABLE_RATE", "No per-hour buyout rate is currently active for this period.");

  const totalCents = Math.round((requested / 60) * window.amountCents);
  return {
    electionType: "PARTIAL_BUYOUT",
    hoursElectedMinutes: requested,
    rateCents: window.amountCents,
    totalCents,
    pricingWindowId: window.id,
    remainingAfterMinutes: Math.max(0, remainingMinutes - requested),
  };
}

export interface RecordElectionInput extends BuyoutQuoteInput {
  acknowledged: boolean;
}

/**
 * Creates the election row from a freshly-recomputed (never trusted from
 * the client) quote. Deliberately posts NOTHING to the ledger — selecting a
 * buyout option is not a payment; only VH-F's confirmed-payment path
 * credits purchased hours. Append-only: a family re-electing creates a new
 * row rather than editing the old one, so the original disclosure they
 * agreed to is preserved.
 */
export async function recordElection(
  organizationId: string,
  periodId: string,
  householdId: string,
  input: RecordElectionInput,
  actor: { userId: string; ipAddress?: string | null }
) {
  if (!input.acknowledged) {
    throw new PtaError("PTA_VALIDATION_ERROR", "You must acknowledge the disclosures before continuing.");
  }
  const quote = await buildBuyoutQuote(organizationId, periodId, householdId, input);

  const election = await prisma.ptaVolunteerBuyoutElection.create({
    data: {
      organizationId,
      requirementPeriodId: periodId,
      householdId,
      electionType: quote.electionType,
      hoursElectedMinutes: quote.hoursElectedMinutes,
      quotedRateCents: quote.rateCents,
      quotedTotalCents: quote.totalCents,
      pricingWindowId: quote.pricingWindowId,
      acknowledgedAt: new Date(),
      acknowledgedByUserId: actor.userId,
      ackVersion: VOLUNTEER_HOURS_ACK_VERSION,
      ipAddress: actor.ipAddress ?? null,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "pta.volunteer_hours.election_recorded",
    entityType: "pta_volunteer_buyout_election",
    entityId: election.id,
    metadata: { periodId, electionType: election.electionType, hoursElectedMinutes: election.hoursElectedMinutes, quotedTotalCents: election.quotedTotalCents },
  });

  return election;
}

export async function getLatestElection(organizationId: string, periodId: string, householdId: string) {
  return prisma.ptaVolunteerBuyoutElection.findFirst({
    where: { organizationId, requirementPeriodId: periodId, householdId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * fix/pta-volunteer-financial-controls (FC-4, design note
 * docs/pta-volunteer-hours-pricing-lock-design.md): the single dispatch
 * point every purchase-creation path (Stripe checkout, offline recording)
 * must call instead of `buildBuyoutQuote` directly. Honors an
 * ELECTION-locked election's frozen `quotedRateCents`/`quotedTotalCents`
 * only when ALL of: the election belongs to this org/period/household, it
 * is still the household's *latest* election (a later re-election always
 * supersedes an earlier lock), and the pricing window it was quoted against
 * is `lockTiming=ELECTION`, still active, and not yet past its own close
 * (`endAt`) — the same boundary FC-5 enforces for new elections/checkouts,
 * not a separate expiration clock. Every other case (no election id,
 * election not found/not latest, window inactive/closed/deleted, or
 * `lockTiming=CHECKOUT`) falls back to a fresh `buildBuyoutQuote` call,
 * which is today's actual (and CHECKOUT's intended) behavior. Only the
 * price/hours are ever taken from the lock — `remainingAfterMinutes` is
 * always recomputed against current ledger totals, since that is a live
 * progress figure, not a frozen price.
 */
export async function resolveLockedOrFreshQuote(
  organizationId: string,
  periodId: string,
  householdId: string,
  input: BuyoutQuoteInput & { electionId?: string | null }
): Promise<BuyoutQuote> {
  if (input.electionId) {
    const election = await prisma.ptaVolunteerBuyoutElection.findFirst({
      where: { id: input.electionId, organizationId, requirementPeriodId: periodId, householdId },
    });
    if (election?.pricingWindowId && (election.electionType === "FULL_BUYOUT" || election.electionType === "PARTIAL_BUYOUT")) {
      const latest = await getLatestElection(organizationId, periodId, householdId);
      if (latest?.id === election.id) {
        const now = new Date();
        const window = await prisma.ptaVolunteerPricingWindow.findUnique({ where: { id: election.pricingWindowId } });
        if (window && window.lockTiming === "ELECTION" && window.active && window.endAt > now) {
          const period = await getVolunteerRequirementPeriod(organizationId, periodId);
          const requirement = await resolveHouseholdRequirement(organizationId, periodId, householdId);
          const totals = await getHouseholdLedgerTotals(organizationId, periodId, householdId);
          const remainingMinutes = Math.max(
            0,
            requirement.requiredMinutes - totals.verifiedMinutes - totals.purchasedMinutes - totals.creditMinutes - totals.waivedMinutes
          );
          // Price is frozen by the lock, but eligibility to REDEEM it is not
          // — re-verified fresh every time, same as a brand-new quote would
          // be, so a household that's become exempt or already satisfied
          // since electing can't still complete a locked purchase.
          assertBuyoutEligible(period, requirement, remainingMinutes, now);
          return {
            electionType: election.electionType,
            hoursElectedMinutes: election.hoursElectedMinutes,
            rateCents: election.quotedRateCents,
            totalCents: election.quotedTotalCents,
            pricingWindowId: election.pricingWindowId,
            remainingAfterMinutes: Math.max(0, remainingMinutes - election.hoursElectedMinutes),
          };
        }
      }
    }
  }
  return buildBuyoutQuote(organizationId, periodId, householdId, input);
}

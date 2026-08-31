"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export interface AgreementStatusResponse {
  required: boolean;
  assignedVersion: { id: string; title: string; versionNumber: number } | null;
  acceptance: { id: string; acceptedAt: string } | null;
  contractLinkedBuyoutEnabled: boolean;
  contractLinkedEligibleUntil: string | null;
  contractLinkedEligibleNow: boolean;
}

export type CardState = "ACTION_REQUIRED" | "ACCEPTED" | "OFFER_OPEN" | "OFFER_EXPIRING" | "OFFER_EXPIRED";

const STATE_LABEL: Record<CardState, string> = {
  ACTION_REQUIRED: "Action required",
  ACCEPTED: "Accepted",
  OFFER_OPEN: "Offer open",
  OFFER_EXPIRING: "Offer expiring soon",
  OFFER_EXPIRED: "Offer expired",
};

const STATE_STYLE: Record<CardState, string> = {
  ACTION_REQUIRED: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-emerald-100 text-emerald-800",
  OFFER_OPEN: "bg-blue-100 text-blue-800",
  OFFER_EXPIRING: "bg-orange-100 text-orange-800",
  OFFER_EXPIRED: "bg-slate-100 text-slate-600",
};

/** Exported for direct unit testing (no DOM/rendering infra required) —
 * this is the entire visibility contract from FA2 §3 expressed as a pure
 * function: null/no-assignment means "don't render," anything else is one
 * of the 5 documented states. */
export function shouldRenderAgreementCard(
  data: AgreementStatusResponse | null
): data is AgreementStatusResponse & { assignedVersion: NonNullable<AgreementStatusResponse["assignedVersion"]> } {
  return data !== null && data.assignedVersion !== null;
}

export function resolveCardState(data: AgreementStatusResponse): CardState {
  if (!data.acceptance) return "ACTION_REQUIRED";
  if (data.contractLinkedBuyoutEnabled && data.contractLinkedEligibleUntil) {
    if (data.contractLinkedEligibleNow) {
      const daysLeft = (new Date(data.contractLinkedEligibleUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return daysLeft <= 3 ? "OFFER_EXPIRING" : "OFFER_OPEN";
    }
    return "OFFER_EXPIRED";
  }
  return "ACCEPTED";
}

/**
 * feature/pta-family-agreement-buyout follow-up (FA2 §3). A safe,
 * self-hiding entry point on the existing "My PTA" family dashboard —
 * deliberately NOT restructuring that page, just one more conditional
 * SectionCard alongside PtaVolunteerRequirementCard.
 *
 * Visibility contract (all enforced server-side, this component only
 * decides whether to RENDER once the data arrives):
 * - Renders nothing while loading, on any fetch error, and on a 401/403 —
 *   this is the "fail closed when the capability is unavailable" behavior;
 *   there is no client-side capability check to bypass because the route
 *   itself (requireVolunteerHoursHouseholdAccess("requirements")) is the
 *   only source of truth, and a rejection here just means "don't show it,"
 *   never a page-breaking error banner for what is a discoverability nicety.
 * - Renders nothing when the household's active period has no agreement
 *   assigned at all (`assignedVersion === null`) — never shown merely
 *   because the platform flag/code exists, and never exposes a DRAFT or
 *   unassigned agreement (the API route itself never returns one — only
 *   resolveHouseholdAgreementStatus's own PUBLISHED-and-assigned lookup).
 * - Always resolves the household from the AUTHENTICATED adult's own
 *   linkage server-side (same guard every other family route in this
 *   program uses) — there is no household-selecting input anywhere on this
 *   component, so it structurally cannot show another household's status.
 */
export function PtaVolunteerAgreementStatusCard() {
  const [data, setData] = useState<AgreementStatusResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/labs/pta/volunteer-hours/my-household/agreement")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setData(body?.ok ? body.data : null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || !shouldRenderAgreementCard(data)) return null;

  const state = resolveCardState(data);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">Volunteer Commitment Agreement</p>
        <p className="mt-1 text-xs text-slate-500">
          {data.assignedVersion.title} (v{data.assignedVersion.versionNumber})
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_STYLE[state]}`}>{STATE_LABEL[state]}</span>
        <Link href="/labs/pta/my-pta/volunteer-agreement" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
          {state === "ACTION_REQUIRED" ? "Review & accept" : "View"}
        </Link>
      </div>
    </div>
  );
}

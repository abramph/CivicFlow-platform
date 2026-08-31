import { describe, expect, it } from "vitest";
import { resolveCardState, shouldRenderAgreementCard, type AgreementStatusResponse } from "../PtaVolunteerAgreementStatusCard";

/**
 * feature/pta-family-agreement-buyout follow-up (FA2 §3). This repo has no
 * React component-rendering test infrastructure (no @testing-library/react,
 * no jsdom vitest environment — confirmed before writing this file, not
 * assumed) — adding that is a separate, larger decision than this task
 * warrants. Instead, the card's ENTIRE show/hide and state-selection
 * contract is expressed as the two pure, exported functions below, so it is
 * fully unit-testable without any DOM. The component itself
 * (PtaVolunteerAgreementStatusCard.tsx) is a thin fetch+render shell around
 * these two functions and contains no additional branching logic of its
 * own to test separately.
 */

const NOT_ACCEPTED: AgreementStatusResponse = {
  required: true,
  assignedVersion: { id: "v1", title: "Volunteer Commitment Agreement", versionNumber: 1 },
  acceptance: null,
  contractLinkedBuyoutEnabled: false,
  contractLinkedEligibleUntil: null,
  contractLinkedEligibleNow: false,
};

describe("shouldRenderAgreementCard — visibility contract", () => {
  it("does not render when there is no data at all (loading failed, or the guard rejected -- fail-closed)", () => {
    expect(shouldRenderAgreementCard(null)).toBe(false);
  });

  it("does not render when the household's active period has no agreement assigned, even if agreementRequired happens to be true", () => {
    expect(shouldRenderAgreementCard({ ...NOT_ACCEPTED, assignedVersion: null })).toBe(false);
  });

  it("renders once a version is assigned, regardless of acceptance/offer state", () => {
    expect(shouldRenderAgreementCard(NOT_ACCEPTED)).toBe(true);
    expect(shouldRenderAgreementCard({ ...NOT_ACCEPTED, acceptance: { id: "acc-1", acceptedAt: new Date().toISOString() } })).toBe(true);
  });
});

describe("resolveCardState — the 5 documented states", () => {
  it("ACTION_REQUIRED when the household has not accepted the assigned version", () => {
    expect(resolveCardState(NOT_ACCEPTED)).toBe("ACTION_REQUIRED");
  });

  it("ACCEPTED when accepted and contract-linked buyout isn't in play", () => {
    const data: AgreementStatusResponse = {
      ...NOT_ACCEPTED,
      acceptance: { id: "acc-1", acceptedAt: new Date().toISOString() },
    };
    expect(resolveCardState(data)).toBe("ACCEPTED");
  });

  it("ACCEPTED when contract-linked buyout is enabled but this household has no eligibility window at all", () => {
    const data: AgreementStatusResponse = {
      ...NOT_ACCEPTED,
      acceptance: { id: "acc-1", acceptedAt: new Date().toISOString() },
      contractLinkedBuyoutEnabled: true,
      contractLinkedEligibleUntil: null,
    };
    expect(resolveCardState(data)).toBe("ACCEPTED");
  });

  it("OFFER_OPEN when eligible now with more than 3 days remaining", () => {
    const data: AgreementStatusResponse = {
      ...NOT_ACCEPTED,
      acceptance: { id: "acc-1", acceptedAt: new Date().toISOString() },
      contractLinkedBuyoutEnabled: true,
      contractLinkedEligibleUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      contractLinkedEligibleNow: true,
    };
    expect(resolveCardState(data)).toBe("OFFER_OPEN");
  });

  it("OFFER_EXPIRING when eligible now with 3 or fewer days remaining", () => {
    const data: AgreementStatusResponse = {
      ...NOT_ACCEPTED,
      acceptance: { id: "acc-1", acceptedAt: new Date().toISOString() },
      contractLinkedBuyoutEnabled: true,
      contractLinkedEligibleUntil: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      contractLinkedEligibleNow: true,
    };
    expect(resolveCardState(data)).toBe("OFFER_EXPIRING");
  });

  it("OFFER_EXPIRED when the eligibility window has already passed", () => {
    const data: AgreementStatusResponse = {
      ...NOT_ACCEPTED,
      acceptance: { id: "acc-1", acceptedAt: new Date("2020-01-01").toISOString() },
      contractLinkedBuyoutEnabled: true,
      contractLinkedEligibleUntil: new Date("2020-01-15").toISOString(),
      contractLinkedEligibleNow: false,
    };
    expect(resolveCardState(data)).toBe("OFFER_EXPIRED");
  });
});

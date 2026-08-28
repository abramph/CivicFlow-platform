# Unestra for PTA — Volunteer Hour Requirements & Buyout: Phase 3 Mobile Spec

**Status: specification document only. No `civicflow-mobile` source was touched in Phase 1 (VH-A through VH-L), and none should be touched until this document is reviewed and a separate program is explicitly authorized.** This is a deliberate constraint carried through the entire Phase 1 program: the current iOS build was awaiting Apple review when this program began, and no change to `civicflow-mobile/` or any new mobile binary submission may happen as a side effect of this work.

## 1. Why mobile is a separate, later phase

The submitted iOS build and current Android build call a fixed, enumerated set of `/api/mobile/pta/*` endpoints (`profile`, `volunteers/*`, `announcements/*`, `events/*`, `dues/*`, `documents`, `meetings/*` — see `civicflow-mobile/src/lib/mobile-api.ts:386-739` as of Phase 1). Phase 1 added zero new fields to those responses and zero new required parameters — every new endpoint lives under `/api/labs/pta/volunteer-hours/*`, entirely outside what the existing mobile build knows about or calls. This is verified by a permanent regression test (`src/lib/labs/pta/volunteer-hours/__tests__/mobile-compatibility.test.ts`) that fails the moment any future change makes an `/api/mobile/pta/*` route depend on this feature's code.

Phase 3 is what happens *after* the current Apple/Google submission has been approved and is live, in a separate program with its own review and its own binary submission.

## 2. What the mobile app already has (read-only, pre-existing)

Per the Phase 1 architecture review, `civicflow-mobile` already has read-only volunteer-hours screens (viewing a household's approved/pending hour totals against the legacy flat `PtaVolunteerRequirement`) but **no buyout UI at all**. Phase 3's job is to bring the mobile app up to parity with what the web portal gained in Phase 1 — requirement-period awareness, buyout election/checkout, assessment payment, dispute reporting, and the family's own report download — not to rebuild what already exists.

## 3. New native screens needed

| Screen | Purpose | Mirrors (web) |
|---|---|---|
| Volunteer Requirement (period-aware) | Replace the legacy flat-requirement view with period name, adjusted required hours, verified/pending/purchased/waived breakdown, remaining hours, deadline | `PtaVolunteerRequirementCard.tsx` stat grid |
| Buyout election | Choose volunteer/full-buyout/partial-buyout, request a live quote, acknowledge the required disclosures, confirm | Same component's election flow |
| Buyout checkout | Hand off to Stripe Checkout (native `SFSafariViewController`/Custom Tabs, or an in-app WebView — needs a UX decision, see §6) | `startCheckout()` → `window.location.href` |
| Assessment payment | List outstanding assessment charges, pay via the same checkout hand-off | The card's assessment-charges list |
| Dispute report | Free-text "report a missing/incorrect record" form | The card's dispute textarea |
| My volunteer report | Download/share the family's own `.xlsx` summary (native share sheet, since mobile OSes don't have a browser download tray the way desktop does) | `my-household/report/export` |

## 4. Endpoints Phase 3 would call

All already exist and are already gated correctly (household self-service, own-household-only, server-resolved) — Phase 3 is new *screens* calling *existing* endpoints, not new backend work, unless product decides mobile needs push-notification integration (see §7):

`GET my-household/summary`, `GET/POST my-household/quote`, `POST my-household/election`, `POST my-household/checkout`, `GET my-household/assessments`, `POST my-household/assessments/[chargeId]/checkout`, `GET/POST my-household/disputes`, `GET my-household/report`, `GET my-household/report/export`.

One likely necessary addition: a mobile-friendly variant of the checkout response (e.g. returning both the Stripe Checkout URL *and* a mobile deep-link return URL) if product decides an in-app browser hand-off needs a custom return path rather than the web's ordinary redirect. This would be a new, additive field on the existing `checkout`/`assessments/[chargeId]/checkout` response shapes, never a breaking change to the current mobile build's contract (which doesn't call these routes at all yet).

## 5. Permissions & flags

No new permissions needed — Phase 3 is entirely household self-service, governed the same way the web portal already is: `requireVolunteerHoursHouseholdAccess()`, own household only, platform kill-switch + the same six org-level flags. `ptaVolunteerNativeMobileEnabled` (added in Phase 1, unread by any code so far) becomes load-bearing in Phase 3 — it should gate whether the new native screens even render/register in navigation for a given organization, independent of the web-facing flags. An org could plausibly have web buyout enabled but native mobile buyout still off (e.g. during a staged mobile rollout after the web feature has been live for a while).

## 6. Open product/UX decisions (not resolved by this document)

- **Checkout hand-off**: in-app browser vs. system browser vs. embedded Stripe mobile SDK. Affects both UX and whether a new backend field (mobile return-URL) is needed.
- **Push notifications**: should deadline/assessment-posted/rate-change notices (Phase 1's email-only notifications) also fire a push notification on mobile? If yes, this needs a new notification-channel decision, likely reusing whatever push infrastructure the app's other push notifications (referenced in `docs/mobile-nav-wedge-fix.md`-adjacent work) already use, with the same dedup discipline `PtaVolunteerNotificationLog` already provides — a push send would just be a second delivery channel keyed off the same log rows, not a second dedup mechanism.
- **Offline behavior**: what does the Volunteer Requirement screen show with no network — cached last-known summary, or a clear "can't load, try again" state? Given money is involved (buyout/assessment payment), Phase 3 should almost certainly **disable** initiating a new purchase while offline rather than queue one, to avoid a stale-price submission once connectivity returns.

## 7. Navigation

Per Phase 1's mobile-to-web constraint: no new native nav item was added to the submitted build, since that would have required a new binary. Phase 3, being its own submission, is free to add a proper native nav entry point (e.g. a "Volunteer Hours" tab/section) rather than any workaround.

## 8. Analytics

If the app has an existing analytics/event-tracking convention, Phase 3 should track at minimum: quote requested, election confirmed (by type), checkout started, checkout completed/abandoned, assessment payment started/completed, dispute submitted, report downloaded — mirroring what would be useful to correlate against the same actions' audit-log entries on the backend (`pta.volunteer_hours.*` actions), not inventing a parallel taxonomy.

## 9. Accessibility

Standard platform accessibility requirements apply (VoiceOver/TalkBack labels on every interactive element, sufficient contrast, dynamic type support) — nothing in this feature's domain (dollar amounts, hour counts, deadlines) is unusual for assistive tech, but the buyout-election disclosure text (VH-E's "required disclosures" acknowledgment) must remain fully readable by screen reader before the checkbox can be checked, matching the web version's non-bypassable acknowledgment flow.

## 10. Testing needs

- Contract tests against the same `my-household/*` endpoints Phase 1 already tests server-side (no new backend test surface, just client-side integration tests exercising the real API).
- A repeat of Phase 1's `mobile-compatibility.test.ts` discipline in reverse once Phase 3 ships: a regression test ensuring Phase 3's new mobile code never silently starts depending on an internal (non-`my-household`) volunteer-hours function or route.
- Manual device walkthrough of the full election → quote → checkout → payment-confirmed loop in Stripe test mode, on both iOS and Android, before any Phase 3 build is submitted for review — mirroring the "payment testing: staging + Stripe test mode; live only with explicit approval" constraint that governed Phase 1.

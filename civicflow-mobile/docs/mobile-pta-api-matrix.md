# Unestra Mobile — PTA API Matrix

A route-inventory cut of the same information lives in `mobile-api-readiness.md`. This document is the complementary identity-focused cut: for each parent-facing feature, which route does a **conventional member** hit vs. a **pure PTA household parent**, and which guard enforces it. All guards live in `civicflow-portal/src/lib/mobile-auth.ts`.

| Feature | Conventional member route | PTA household parent route | Guard(s) |
|---|---|---|---|
| Dashboard | *(composed client-side)* | *(composed client-side)* | — |
| Announcements list | `GET /api/mobile/announcements` | `GET /api/mobile/pta/announcements` | `requireMobileMembership` / `requireMobilePtaHouseholdAccess` |
| Mark announcement read | `POST /api/mobile/announcements/[id]/read` | `POST /api/mobile/pta/announcements/[id]/read` | same pair |
| Events list | `GET /api/mobile/events` | `GET /api/mobile/pta/events` | same pair |
| Event RSVP | *(no RSVP concept for conventional events)* | `POST /api/mobile/pta/events/[eventId]/rsvp` | `requireMobilePtaHouseholdAccess` |
| Dues summary | `GET /api/mobile/dues` | `GET /api/mobile/pta/dues` | `requireMobileMembership` / `requireMobilePtaHouseholdAccess` |
| Report a payment | `POST /api/mobile/report-payment` (multi-category, receipt upload) | `POST /api/mobile/pta/dues/report-payment` (dues-only, no receipt field) | same pair |
| Payment history | `GET /api/mobile/payment-history` | *(none — Dues screen's "prior school years" covers the need)* | `requireMobileMembership` |
| Payment link (campaign/event/dues) | `GET /api/mobile/payment-link` | *(none — dues summary already returns `onlinePaymentLinkSlug` directly)* | `requireMobileMembership` |
| Payment methods ("ways to pay") | `GET /api/mobile/payment-methods` | `GET /api/mobile/payment-methods` (**same route**) | `requireMobileOrgAccess` (loosened this pass from `requireMobileMembership` — org-scoped data, no member filtering) |
| Inbox — conversation list | `GET /api/mobile/messages/conversations` | `GET /api/mobile/messages/conversations` (**same route**) | `requireMobileOrgAccess` (loosened this pass — data is `userId`-scoped, never needed `memberId`) |
| Inbox — thread detail | `GET /api/mobile/messages/conversations/[id]` | same route | same guard |
| Inbox — send message | `POST /api/mobile/messages/conversations/[id]/messages` | same route | same guard |
| Meeting minutes | *(none — no conventional mobile minutes route exists)* | `GET /api/mobile/pta/minutes` | `requireMobilePtaHouseholdAccess` |
| Documents | *(none)* | `GET /api/mobile/pta/documents` | `requireMobilePtaHouseholdAccess` (metadata only, `downloadable: false` always) |
| Meeting attendance (QR check-in) | `POST /api/mobile/attendance/check-in`, `GET /history` | *(none — no attendance concept exposed to parents)* | `requireMobileMembership` |
| Profile — view/edit comms preferences | `GET`/`PATCH /api/mobile/profile` | *(none — deliberately out of scope, see `mobile-pta-parent-parity.md`)* | `requireMobileMembership` |
| Profile — name/email/org display, org switching | `GET /api/mobile/organizations` (both identities) | same | `requireMobileAuth` only |
| Volunteer opportunities/shifts/hours | *(N/A — conventional members have no volunteer identity)* | `GET /api/mobile/pta/volunteers/*` (opportunities, my-commitments, hours, slots claim/cancel) | `requireMobilePtaHouseholdAccess` |

## Guard reference

- **`requireMobileMembership`** — requires an active `OrganizationMembership{role: MEMBER}` + `OrgMember`. The original, strictest mobile guard; still correct for genuinely member-scoped data (comms preferences, meeting attendance).
- **`requireMobilePtaHouseholdAccess`** — requires an active `PtaHouseholdAdult` linked to the caller's own `userId` in an active household, in a PTA-enrolled organization. Returns `adult.billingMemberId` (the household's shared `OrgMember.id`) for routes that need to look up dues/announcement targeting by member id.
- **`requireMobileStaffPermission(permission)`** — requires a non-`MEMBER` `OrganizationMembership` plus a specific PTA permission via `getEffectivePermissions()`. Used only by the officer-side volunteer-coordinator routes (not in this table — see `mobile-api-readiness.md`).
- **`requireMobileOrgAccess`** (new this pass) — the loosest guard: true if the caller has *any* of the three identities (conventional member, PTA household adult, or staff membership) in the organization. Reserved for routes whose underlying query never actually filtered by `memberId` in the first place — using it elsewhere would be a real authorization loosening, not just convenience.

## Explicitly not done

No route in this table grants a PTA parent a conventional `MEMBER` role, a fabricated `OrgMember`, or any permission beyond what `requireMobilePtaHouseholdAccess` itself proves (an active household link). Every PTA-parent row above is reachable only through the household-authorization model — never through the conventional membership/permission system, matching the task's explicit architectural constraint.

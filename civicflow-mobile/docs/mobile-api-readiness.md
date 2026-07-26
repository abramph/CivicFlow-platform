# Unestra Mobile — API Readiness Matrix

All routes live in `civicflow-portal/src/app/api/mobile/*`. Every route is authenticated via a bearer access token (`requireMobileAuth`/`requireMobileMembership`/`requireMobilePtaHouseholdAccess`/`requireMobileStaffPermission` — see `mobile-architecture.md`); `organizationId` is always re-verified server-side against the caller's actual membership/household link, never trusted from the client alone. All authorization and tenant-isolation logic lives server-side — the mobile client holds no permission logic of its own beyond hiding UI it can't use.

Legend: **Complete** = built, tested, used by a real screen. **Partial** = route exists but no mobile screen consumes it yet, or a known gap exists. **Missing** = no route exists. **N/A** = deliberately out of scope.

| Area | Route(s) | Method | Auth guard | Mobile readiness |
|---|---|---|---|---|
| Login | `/api/mobile/auth/login` | POST | none (issues token) | Complete |
| MFA challenge | `/api/mobile/auth/mfa/challenge`, `/mfa/send-sms` | POST | mfaToken (short-lived) | Complete |
| Token refresh | `/api/mobile/auth/refresh` | POST | refresh token | Complete |
| Logout | `/api/mobile/auth/logout` | POST | access token | Complete |
| Accept invite | `/api/mobile/auth/accept-invite` | POST | invite token | Complete |
| Current user / orgs | `/api/mobile/organizations` | GET | access token | **Complete** — extended this branch to include PTA household-adult and PTA-officer identities (previously MEMBER-role orgs only) |
| Dashboard | *(client composes from Dues/Announcements/Events + new PTA hours/commitments)* | — | — | Complete for member identity; partial for PTA-only identity (volunteer card only) |
| Announcements | `/api/mobile/announcements`, `/[id]/read` | GET/POST | `requireMobileMembership` | Complete for MEMBER-role orgs; **not usable by a pure PTA parent** (needs an `OrgMember`) — known gap |
| Events | `/api/mobile/events` | GET | `requireMobileMembership` | Same as Announcements |
| RSVP | — | — | — | **Missing** — no mobile RSVP endpoint exists at all (web-only today) |
| Membership/Dues | `/api/mobile/dues` | GET | `requireMobileMembership` | Complete for MEMBER-role orgs; not usable by a pure PTA parent |
| Payment reports | `/api/mobile/report-payment`, `/payment-history` | POST/GET | `requireMobileMembership` | Complete for MEMBER-role orgs |
| Payment links/methods | `/api/mobile/payment-link`, `/payment-methods` | GET | `requireMobileMembership` | Complete for MEMBER-role orgs |
| **Volunteer opportunities (parent)** | `/api/mobile/pta/volunteers/opportunities`, `/opportunities/[id]` | GET | `requireMobilePtaHouseholdAccess` | **Complete — new this branch** |
| **Volunteer signup/cancellation** | `/api/mobile/pta/volunteers/slots/[id]/claim`, `/cancel` | POST | `requireMobilePtaHouseholdAccess` | **Complete — new this branch.** Idempotent/concurrency-safe (delegates to `claimPtaVolunteerSlot`/`cancelPtaVolunteerSignup`, the same functions proven safe under real concurrent load on the portal side) |
| **Volunteer history** | `/api/mobile/pta/volunteers/my-commitments` | GET | `requireMobilePtaHouseholdAccess` | **Complete — new this branch** |
| **Volunteer household totals** | `/api/mobile/pta/volunteers/hours` | GET | `requireMobilePtaHouseholdAccess` | **Complete — new this branch.** Reports `requiredMinutes: null` (never a bare 0) when a PTA has no hour requirement configured |
| **Volunteer attendance (officer)** | `/api/mobile/pta/volunteers/signups/[id]/checkin`, `/checkout`, `/attendance` | POST | `requireMobileStaffPermission(pta:volunteers:checkin)` | **Complete — new this branch.** Idempotent, server-timestamped |
| **Volunteer roster/staffing (officer)** | `/api/mobile/pta/volunteers/today`, `/opportunities/[id]/roster` | GET | `requireMobileStaffPermission(pta:volunteers:checkin)` | **Complete — new this branch** |
| **Volunteer hour approval (officer)** | `/api/mobile/pta/volunteers/hour-entries/pending`, `/[id]/approve` | GET/POST | `requireMobileStaffPermission(pta:volunteer-hours:approve)` | **Complete — new this branch.** Self-approval rejected server-side (`PTA_SELF_APPROVAL_FORBIDDEN`) |
| Meetings | — | — | — | **Missing** — no mobile meetings/agenda endpoint exists |
| Meeting attendance | `/api/mobile/attendance/check-in`, `/history`, `/meetings/[id]/attendance` | POST/GET | `requireMobileMembership` | Complete (QR-based check-in) |
| Meeting minutes | — | — | — | **Missing** — no mobile approved-minutes endpoint exists (the web has `GET /api/labs/pta/minutes`, not bridged to mobile auth yet) |
| Documents | — | — | — | **Missing** — no mobile document-list endpoint exists |
| Inbox/messages | `/api/mobile/messages/conversations`, `/[id]`, `/[id]/messages` | GET/POST | `requireMobileMembership` | Complete for MEMBER-role orgs; not usable by a pure PTA parent |
| Notifications (device) | `/api/mobile/register-device`, `/unregister-device` | POST | access token | Complete (registration plumbing); no PTA-specific notification categories wired yet |
| Profile | `/api/mobile/profile` | GET/PATCH | `requireMobileMembership` | Complete for MEMBER-role orgs |

## Volunteer permissions (server-enforced, never client-side)

`pta:volunteers:checkin` and `pta:volunteer-hours:approve` are deliberately separate permissions (a Volunteer Coordinator who can check people in is not automatically granted hour-approval authority) and are **not** granted to `FINANCE` (Treasurer) by default — matches the web's authorization model exactly, since `requireMobileStaffPermission()` calls the same `getEffectivePermissions()` (including any org-level `OrgRolePermissionSet` customization) the web does.

## What this branch deliberately did not build

- RSVP, meetings/agenda, meeting minutes, and documents have **no mobile API at all** yet — building these was out of scope for this pass (which focused on the volunteer workflow specifically, per explicit task scope). The pattern established here (a thin `requireMobile*` guard delegating to existing library functions) is the template to follow when those are built.
- No new endpoint was created before confirming an equivalent didn't already exist — every new route in this branch is genuinely new (no PTA volunteer mobile API existed at all before this branch).

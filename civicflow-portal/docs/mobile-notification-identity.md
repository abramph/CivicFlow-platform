# Mobile push-notification identity & isolation audit

Read-only inventory of every path that generates or displays a push
notification, plus the mobile-side handling, done before implementing
organization-branded notification identity (branch
`fix/mobile-notification-identity-and-sms-entitlement`, base `6c7fdab`).

**Intended experience:** the organization is the apparent *content sender*
(notification title), while **Unestra** remains the trusted installed
application (the app icon) — like WhatsApp showing a person/group under the
WhatsApp identity. Example: **LCACNJ** / *Event reminder* / "The membership
meeting begins tomorrow at 7:00 PM."

## Provider layer (`civicflow-portal/src/lib/push.ts`)

Everything funnels through `sendPushToTokens(tokens, {title, body, deepLink, data})`,
which builds an `ExpoPushMessage` of exactly `{to, title, body, sound:"default",
data:{deepLink, ...data}}`. **No `subtitle`, `categoryId`, `channelId`, or
`badge` is set.** `sendPushToMember({organizationId, memberId, title, body,
deepLink, required})` adds tenant-scoped member lookup (`findFirst {id,
organizationId}`), opt-out gating (`commsPushEnabled`/`requiredNoticesOnly`,
bypassed by `required:true`), the PTA household-adult fallback, and a
`CommunicationLog` PUSH row.

**Critical gap:** no path loads the `Organization` row before sending. Every
push carries only a hardcoded `title` string; the org name is never present.

## Notification-path matrix

| # | Category | Server entry | Sender (file:line) | Current title | organizationId server-resolved | Org name loaded | deep link / tap | remote/local |
|---|---|---|---|---|---|---|---|---|
| 1 | Announcement / campaign (bulk) | `POST /api/communications/campaigns/[id]/send`, `POST /api/mobile/admin/campaigns/[id]/send`, cron `campaigns`, worker | `communication-campaigns.ts:230` `sendPushToTokens` | `campaign.title` | ✅ (permission session / org-scoped campaign row) | ❌ | `campaign.deepLink` or `/announcement/{id}` | remote |
| 2a | Meeting check-in confirmation | `POST /api/mobile/attendance/check-in`, member-portal, `/api/attendance` | `attendance-checkin.ts:161` `sendPushToMember` | `"Checked in"` | ✅ (scanned QR token → session.organizationId) | ❌ | none | remote |
| 2b | Meeting minutes approved | `POST /api/meetings/[id]/minutes/[mid]/approve` | `meeting-minutes.ts:228` `sendPushToMember` | `"Meeting minutes approved"` | ✅ (`meetings:minutes:approve`) | ❌ | `/m/minutes` | remote |
| 3a | Payment report approved | `POST .../payment-reports/[id]/approve` (+mobile) | `payment-report-mutations.ts:138` `sendPushToMember required:true` | `"Payment Confirmed"` | ✅ (`dues:write`) | ❌ | `/payment-history` | remote |
| 3b | Payment report rejected | `POST .../payment-reports/[id]/reject` (+mobile) | `payment-report-mutations.ts:190` `sendPushToMember required:true` | `"Payment Not Confirmed"` | ✅ | ❌ | `/report-payment` | remote |
| 4 | Direct / member message | `POST .../conversations/[id]/messages` (staff, member-portal, mobile) | `messaging.ts:46` `sendPushToMember` + `:77` `sendPushToTokens` (PTA) | `"New message from {sender}"` | ✅ (session; org-scoped participants) | ❌ | `/messages/{conversationId}` | remote |
| 5a | Membership status changed | `PATCH /api/members/[id]` (+mobile) | `member-mutations.ts:334` `sendPushToMember required:true` | `"Membership Status Update"` | ✅ | ❌ | `/dues` | remote |
| 5b | Member terminated | `POST /api/members/[id]/terminate` (+mobile) | `member-lifecycle.ts:147` `sendPushToMember required:true` | `"Membership Status Update"` | ✅ | ❌ | `/dues` | remote |
| 5c | Member reinstated | `POST /api/members/[id]/reinstate` (+mobile) | `member-lifecycle.ts:222` `sendPushToMember required:true` | `"Membership Status Update"` | ✅ | ❌ | `/dues` | remote |
| 6a | HOA violation notice/status/reminder | routes + cron `hoa-violation-reminders` | `hoa/violations.ts:505` `sendPushToTokens` | `"New violation notice"` etc. | ✅ (`resolveActivePropertyResidents(organizationId,…)`) | ❌ | `/m/violations` | remote |
| 6b | HOA architectural request | routes | `hoa/architectural-requests.ts:207` `sendPushToTokens` | `"Architectural request submitted"` etc. | ✅ (org-scoped submitter) | ❌ | `/m/architectural-requests` | remote |
| 7a | Union case — member | routes | `union/cases.ts:306` `sendPushToTokens` | `"A representative has been assigned…"` etc. | ✅ (org-scoped) | ❌ | `/union-cases/{caseId}` | remote |
| 7b | Union case — staff deadline (cron) | cron `union-case-deadline-reminders` | `union/cases.ts:768` `sendPushToTokens` | `"Union case deadline approaching"` | ✅ (org-scoped) | ❌ | `/union/cases/{caseId}` | remote |
| — | Platform security / billing / system alert | **none** | — | — | — | — | — | — (no sender exists yet) |
| — | Dues/event/volunteer *reminders* | cron | **email only** (`reminders.ts`, `volunteer-reminders.ts`) — no push | — | — | — | — | — |

Notes:
- **Tenant isolation** is consistent everywhere: `organizationId` is always
  server-resolved (permission session, scanned-token session, or org-scoped
  entity row), never taken as client input; member sends load the member with
  `{id, organizationId}`.
- **`required:true`** (opt-out bypass) is used only for payment confirm/reject
  and membership-status notices.
- **`validateDeepLink`** (`deep-links.ts`) allow-lists every `deepLink` inside
  `sendPushToTokens`; non-allow-listed links become `null`.
- All push is **remote** (Expo). There are **no local/foreground-generated
  notifications**.
- **Retries:** no push-specific retry queue; failed sends are re-attempted only
  when the originating job re-runs (still-PENDING campaign recipients, next
  daily reminder cron).

## Mobile handling (`civicflow-mobile`)

- **Handler** `src/app/_layout.tsx:10` — banner + list + sound, badge off.
- **Registration** `src/lib/push-registration.ts` — Expo token (projectId
  `cc45ba6d-…`) POSTed to `/api/mobile/register-device` with `{platform, token,
  deviceName, organizationId}`; re-registered on login/session-restore/org-switch.
- **Tap listener** `src/lib/use-notification-deep-links.ts:44-67` — reads **only
  `content.data.deepLink`**; de-dups by request identifier; gated on
  `ready = signedIn && selectedOrganizationId present`; cold-start via
  `getLastNotificationResponseAsync`. **No `subtitle`/`category` read.** **No
  organization-context switch** — a notification for a different org is
  navigated within the current org context. **The payload carries no org id.**
- **Org switch mechanism exists but is unused by taps:** `auth-context.tsx:251`
  `selectOrganization(orgId)` sets the active org, persists it, re-registers the
  token. A tap could call it before navigating; today it does not.
- **Icon (Android):** `expo-notifications` plugin (`app.json`) sets
  `icon: "./assets/images/icon.png"` — the **full-color app icon**, which Android
  cannot render as a monochrome status-bar small icon (it masks non-alpha
  icons → white square). A monochrome asset exists
  (`assets/images/android-icon-monochrome.png`) but is wired only to the
  adaptive launcher icon. There is **no dedicated notification small-icon asset**
  and **no Android notification channel** definition.
- **Icon (iOS):** correct — iOS uses the installed app icon automatically; no
  per-notification icon is (or can be) configured. **Per-organization dynamic
  app icons are out of scope and not attempted.**
- **Grouping / thread / category:** none configured.
- **Deep-link routing:** `deep-links.ts` mirrors the server allow-list;
  `navigateToDeepLink` → `router.push` for allow-listed paths only; unmatched
  links are silently ignored.

## SMS entitlement (for the mobile UX gap)

- `getSmsEntitlement(orgId)` (`sms-entitlement.ts`) returns
  `{allowed, reason?, remaining, limit}` — `reason` is a full English sentence.
  Five ordered denials: platform org-messaging disabled; SMS add-on not active;
  org suspended by platform admin; base subscription/billing not active
  (billing-exempt satisfies only this one); monthly allowance reached
  (hard-stop). Success omits `reason`.
- **Not exposed to mobile.** The mobile capabilities load is `GET
  /api/mobile/organizations` (`OrgRow & {capability: OrgCapability}`); neither
  carries any SMS entitlement, and `getSmsEntitlement`/`smsAddOnActive` are never
  called under `src/app/api/mobile/**`.
- **The gap:** `civicflow-mobile/src/app/admin-campaigns/new.tsx` renders a
  static `CHANNEL_OPTIONS` array (`EMAIL`, `SMS`, `EMAIL_AND_SMS`,
  `INTERNAL_LOG_ONLY`); **SMS is always selectable regardless of entitlement**.
  The server rejects at create time (`createCommunicationCampaign` →
  `getSmsEntitlement` → `ValidationError`), so this is a **UX-only gap**, not a
  security hole. No Stripe/Twilio identifiers are exposed to mobile anywhere.

## What the implementation changed

- **Server-only identity formatting** (`src/lib/notifications/identity.ts`,
  `src/lib/notifications/send.ts`, both new) resolves the org name from the
  tenant `organizationId` and sets the title/subtitle. Announcement / event /
  meeting / dues / volunteer / attendance / payment / membership paths are
  org-titled; direct messages are `Sender · Org` (email addresses never
  surfaced as the sender); platform alerts stay `Unestra`. An unresolved org
  falls back to `Unestra` and logs identifiers only. `push.ts` gained a
  `subtitle` field; every push payload now carries `data.category` and
  `data.organizationId`.
  - **Wired paths:** communication campaigns, attendance check-in, meeting
    minutes, payment-report approve/reject, member add + terminate/reinstate,
    and direct/PTA messages.
  - **Deferred (documented follow-up):** the HOA violation/architectural-request
    and union-case fan-outs (`hoa/violations.ts`, `hoa/architectural-requests.ts`,
    `union/cases.ts`) still title with their own descriptive strings and do not
    yet thread `organizationId` into their token sends — converting them is a
    separate, presentation-sensitive change. No platform-alert push *sender*
    exists yet; `PLATFORM_ALERT` is defined for when one is added.
- **Android small icon:** `expo-notifications` now points at the existing
  monochrome asset (`android-icon-monochrome.png`) instead of the full-colour
  launcher icon, so the status-bar/notification glyph renders correctly. The
  Unestra app icon remains the constant, trusted application identity on both
  platforms — no per-org app icons.
- **Tap isolation** (`src/lib/notification-tap.ts`, new pure resolver +
  rewritten `use-notification-deep-links.ts`): on tap the app reads
  `data.organizationId`, and — fail closed — opens the neutral inbox for any org
  the signed-in user cannot access (removed membership, cross-tenant,
  stale/malformed id), switches org context first when the target is a different
  accessible org, or navigates directly when it matches. A signed-out tap is
  held and **re-validated** after login. Payloads without an `organizationId`
  (older server build) navigate as before.
- **Mobile SMS UX:** rather than adding N per-org entitlement lookups to the
  bootstrap org-list, a **new narrow read-only endpoint**
  `GET /api/mobile/admin/sms-capability` (guarded exactly like campaign create —
  `manageCommunications` only) returns the safe `MobileSmsCapability`
  projection (`src/lib/mobile-sms-capability.ts`). `getSmsEntitlement` gained a
  stable `code` per denial branch; the projection maps it to
  `{available, reasonCode, message, remaining?, billingManagementRequired}` —
  never a Stripe/Twilio/phone identifier. The composer fetches it on org change,
  disables the SMS / Email+SMS chips when not entitled (truthful reason shown,
  billing denials point to Settings → Billing with no auto-checkout), and shows
  the remaining allowance when entitled.

Sensitive-content note: bodies are kept concise; none of the current paths put
student/health/disciplinary/payment-account detail on the lock screen beyond a
dollar amount and a category — this is preserved.

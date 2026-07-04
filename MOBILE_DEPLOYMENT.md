# CivicFlow Mobile — Member App, Push Notifications & Deep Links

This covers the member-facing mobile app (`civicflow-mobile/`, Expo/React Native) and the
supporting backend added to `civicflow-portal/`: member authentication, dues reminders,
push notifications, deep links, and payment reporting. The portal remains the system of
record; the mobile app is a companion client authenticating via bearer tokens instead of
the portal's cookie session.

## 1. What changed, by area

- **Database** (`civicflow-portal/prisma/schema.prisma`): `MEMBER` added to `OrgRole`;
  `OrgMember.userId` links a member to a login `User` (composite-unique per org, so one
  person can be a member of several orgs); new `MemberInvite`, `MobileDeviceToken`,
  `PaymentReport` models; `CommunicationCampaign`/`CommunicationRecipient` extended with
  `pushEnabled`, `deepLink`, `scheduledFor`, and push delivery status columns.
- **Mobile auth** (`src/lib/mobile-auth.ts`, `src/lib/member-invites.ts`,
  `src/app/api/mobile/auth/*`): bearer-token login/refresh/logout, admin-initiated invite
  acceptance. `src/lib/member-web-session.ts` + `/api/auth/accept-invite` provide the same
  for the web fallback (cookie session instead of bearer tokens).
- **Member data APIs** (`src/app/api/mobile/{dues,payment-history,announcements,events,
  organizations,report-payment,register-device,unregister-device}`): all org-scoped
  through `requireMobileMembership`, which re-verifies the caller's membership server-side
  — the client's `organizationId` is never trusted alone.
- **Payment reports** (`src/lib/payment-reports.ts`, `src/app/api/admin/payment-reports/*`,
  `civicflow-portal/src/app/payment-reports/page.tsx`): member-submitted "I paid" reports,
  treasurer approve/reject, applied to the member's oldest outstanding `DuesCharge` via
  `src/lib/dues-payments.ts` (shared with the existing staff dues-payment route).
- **Push** (`src/lib/push.ts`): Expo push notification service, wired into campaign sends,
  payment report approve/reject, and membership status changes.
- **Deep links** (`src/lib/deep-links.ts` in both repos, `civicflow-portal/src/app/
  .well-known/*`): allow-listed destinations only; AASA/assetlinks served for universal
  links; `middleware.ts` rewrites `app.civicflowapp.com/{dues,events,...}` to the `/m/*`
  web-fallback pages without colliding with the staff portal's own `/dues`, `/events`.
- **Admin UI**: Communications campaign form gained a push toggle, deep link picker, and
  schedule field; `/dues/reminders` ("Dues Campaigns") is a filtered view of the same
  Communications system, not a parallel one; `/payment-reports` for treasurer review.
- **Cron**: `POST /api/cron/campaigns` (and `npm run worker:campaigns`) fires scheduled
  campaigns, mirroring the existing `cron/reminders` pattern.

## 2. Database migration

The migration lives at `civicflow-portal/prisma/migrations/20260704000000_mobile_member_app/`
and has **not been applied** to any database yet — it was generated and verified via a pure
schema diff (`prisma migrate diff`, no live DB connection) because the local `.env`/`.env.local`
point at the production DigitalOcean instance. Apply it deliberately:

```bash
cd civicflow-portal
npx prisma migrate deploy   # applies pending migrations to whatever DATABASE_URL points at
```

Run this against a staging database first if you have one. All changes are additive (new
nullable columns, new tables, new enum values) — no data loss risk, but confirm before
running against production.

## 3. Environment variables

Add to `civicflow-portal`'s environment (`.env`/`.env.local` for dev, DO App Platform env
vars / `.do/app-secrets.yaml` for production):

| Variable | Required | Purpose |
|---|---|---|
| `MOBILE_JWT_SECRET` | Yes (prod) | Signs mobile bearer access/refresh tokens. Falls back to an insecure dev default outside production — **must** be set before deploying. |
| `MOBILE_APP_WEB_BASE_URL` | No | Base URL used in invite emails / universal links. Defaults to `NEXTAUTH_URL`. |
| `MOBILE_APP_WEB_HOST` | No | Hostname (e.g. `app.civicflowapp.com`) that middleware rewrites to the `/m/*` web-fallback pages. Leave unset until the domain is provisioned — the `/m/*` pages remain directly reachable either way. |
| `APPLE_APP_ID` | No | `"<AppleTeamID>.org.civicflowapp.mobile"` for `/.well-known/apple-app-site-association`. Placeholder until enrolled in the Apple Developer Program. |
| `ANDROID_PACKAGE_NAME` | No | Defaults to `org.civicflowapp.mobile`. |
| `ANDROID_SHA256_CERT_FINGERPRINTS` | No | Comma-separated SHA-256 signing cert fingerprint(s) for `/.well-known/assetlinks.json`. Set once the Android release build is signed. |

`civicflow-mobile`'s environment (`.env`, copy from `.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Yes | Base URL of `civicflow-portal` (e.g. `https://app.civicflowapp.com` or `http://localhost:3000` for local dev). Inlined at build time. |

## 4. Setup instructions

```bash
# Portal (existing project — just new pieces)
cd civicflow-portal
npm install
npx prisma generate
npx prisma migrate deploy   # see §2 — do this deliberately, not blindly
npm run dev

# Mobile app (new project)
cd civicflow-mobile
npm install
cp .env.example .env        # set EXPO_PUBLIC_API_BASE_URL
npm start                   # Expo dev server; press i/a/w for iOS/Android/web
```

## 5. Mobile app run instructions

- `npm start` in `civicflow-mobile/` launches the Expo dev server (Metro). Press `i` for
  the iOS Simulator (macOS only), `a` for an Android emulator, or `w` for web.
- On a physical device: install **Expo Go** (SDK 57) or a custom dev client, scan the QR
  code Metro prints.
- First-run golden path: an admin sends an "Invite to App" from a member's detail page in
  the portal → member opens the email link (or pastes the token into **Login → "Have an
  invite link?"**) → sets a password → lands on the org switcher (if in >1 org) → Dashboard.

## 6. Push notification setup

Push uses the **Expo push notification service** — the backend only ever calls Expo's API
(`expo-server-sdk`), never FCM/APNs directly. Expo relays to FCM/APNs internally.

1. Run `eas init` inside `civicflow-mobile/` (requires an Expo account) to create an EAS
   project and populate `extra.eas.projectId` in `app.json`/`app.config`. Without this, the
   app logs a warning and skips push registration — everything else still works.
2. For a production build, `eas build` will prompt to set up push credentials (an APNs key
   for iOS, an FCM service account for Android) — accept EAS-managed credentials unless you
   already have your own.
3. No portal-side push credentials are needed beyond `expo-server-sdk` itself (already a
   dependency) — Expo push tokens are the only thing the backend deals with.
4. Test end-to-end: log in on a physical device (simulators can't receive real push), confirm
   a `MobileDeviceToken` row appears for that user, then trigger a campaign send with "Also
   send as mobile push notification" checked, or approve/reject a payment report.

## 7. Deep link setup

**Custom scheme** (`civicflow://...`) works immediately in dev/Expo Go — no extra config.

**Universal links (iOS)**:
1. Enroll in the Apple Developer Program, get your Team ID.
2. Set `APPLE_APP_ID="<TeamID>.org.civicflowapp.mobile"` in the portal's environment.
3. Point the `app.civicflowapp.com` DNS record at the portal (custom domain on DO App
   Platform), and set `MOBILE_APP_WEB_HOST=app.civicflowapp.com`.
4. `app.json`'s `ios.associatedDomains` (`applinks:app.civicflowapp.com`) is already set —
   EAS build picks it up automatically; no manual Xcode entitlements editing needed for a
   managed Expo build.
5. Verify: `curl https://app.civicflowapp.com/.well-known/apple-app-site-association`
   should return your real Team ID, not the `TEAMID.` placeholder.

**App links (Android)**:
1. After your first signed release build, get the SHA-256 fingerprint:
   `keytool -list -v -keystore your.keystore` (or from the Play Console's App Signing page).
2. Set `ANDROID_SHA256_CERT_FINGERPRINTS` in the portal's environment (comma-separate debug
   + release fingerprints if you want both to verify).
3. `app.json`'s `android.intentFilters` (`autoVerify: true` on `app.civicflowapp.com`) is
   already set.
4. Verify: `curl https://app.civicflowapp.com/.well-known/assetlinks.json` should list your
   real fingerprint(s).

**Supported paths** (kept in sync between `civicflow-mobile/src/lib/deep-links.ts` and
`civicflow-portal/src/lib/deep-links.ts` — update both if you add a screen):
`/report-payment`, `/dues`, `/announcements`, `/events`, `/payment-history`,
`/accept-invite`, `/organization/:id`.

## 8. Test instructions

```bash
# Portal — unit tests (tenant isolation, RBAC, deep-link allow-list, device tokens,
# payment report review, dues-reminder targeting)
cd civicflow-portal
npm run test          # vitest
npm run typecheck
npm run lint
npm run build          # also verifies the /.well-known and /m/* routes register

# Mobile — deep link resolution
cd civicflow-mobile
npm run test           # jest-expo
npx tsc --noEmit
npx expo lint
```

**Not covered by automated tests** (documented limitation, not an oversight): full
end-to-end flows against a real database — member login → org switch → report payment →
treasurer approves → member gets a push — were verified manually against a local dev server
for routing/auth behavior (middleware bypass, `.well-known` responses, 401s), but not against
seeded member data, since the only available database in this environment is production.
Before go-live, run that golden path against a staging database with a real test member.

## 9. Production deployment checklist

- [ ] Run `npx prisma migrate deploy` against the target database (§2) — not yet applied anywhere.
- [ ] Set `MOBILE_JWT_SECRET` to a strong random value in production (never the dev fallback).
- [ ] Set `ENABLE_EMAIL_SEND=1` (or however it's already toggled) so invite/notification emails actually send.
- [ ] Run `eas init` and configure EAS push credentials (§6).
- [ ] Provision the `app.civicflowapp.com` domain, set `MOBILE_APP_WEB_HOST`, `APPLE_APP_ID`, `ANDROID_SHA256_CERT_FINGERPRINTS` once you have real values (§7).
- [ ] Confirm `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` return real (non-placeholder) values before submitting to the App Store / Play Store.
- [ ] Schedule `POST /api/cron/campaigns` (same cadence/secret as the existing `cron/reminders`) so scheduled dues reminders actually fire.
- [ ] Submit the app to TestFlight / Play Internal Testing and walk the golden path end-to-end with a real invited member before public release.
- [ ] Confirm rate limits (`requireRateLimit` scopes added: `mobile-auth-*`, `mobile-report-payment`, `mobile-register-device`, `api:payment-reports:review`, `api:communications:send`, `api:cron`) are backed by Redis in production, not the in-memory fallback.

# Android FCM (push) setup

Android push notifications are delivered through **Firebase Cloud Messaging (FCM) HTTP v1**.
Unlike iOS (which uses APNs and needs no Firebase), an Android build must contain a
`google-services.json` client-config file, and the Expo push service must hold an
**FCM v1 service-account credential** to send to that project.

This project is managed (no committed `android/` directory). The client file is wired
in at build time by [`app.config.js`](../app.config.js) and delivered by an EAS
environment variable — it is **never committed** to the repository.

> No secrets, keys, project numbers, or Firebase identifiers live in this repo. They
> live only in the Firebase/Google Cloud project and in EAS.

---

## What must exist (out of band)

1. **A production Firebase project** with an Android app registered for the production
   package `com.aphtechnologies.unestra`, and **FCM API (HTTP v1) enabled**.
2. **A dedicated, least-privilege service account** for sending FCM (role limited to
   *Firebase Cloud Messaging API Admin*), with one JSON key.
3. **EAS FCM v1 credential** — the service-account JSON uploaded to
   EAS Android credentials for `com.aphtechnologies.unestra`
   (Expo dashboard → project → Credentials → Android → *FCM V1 service account key*).
   This is **not** the "Google service account key for EAS Submit" — those are separate.
4. **EAS environment variable `GOOGLE_SERVICES_JSON`**
   - Type: **file**
   - Visibility: **Secret**
   - Environment: **production**
   - Value: the production `google-services.json` for the package above.

`eas.json`'s `production` build profile sets `"environment": "production"` so the Secret
file variable is materialized and exposed (as a filesystem path) during config
evaluation.

---

## How the config wires it in

`app.config.js` composes from `app.json` and:

- **Production (default identity):** sets
  `android.googleServicesFile = process.env.GOOGLE_SERVICES_JSON`.
  The variable is treated **only as a path** — its contents are never opened, parsed,
  printed, or committed. iOS is left **APNs-only** (no google-services file).
- **Fails closed** during a production build (`EAS_BUILD_PROFILE=production`) if:
  - `GOOGLE_SERVICES_JSON` is missing or blank,
  - the API base is missing, non-HTTPS, or not the production host
    (`app.getunestra.com`), or
  - a preview identity/package is somehow resolved.
- **Local development** (no `EAS_BUILD_PROFILE=production`) never requires the Firebase
  credential: `android.googleServicesFile` is simply left unset, so `expo start` and
  exports work with no secrets.

### Production ⇄ preview isolation

`APP_VARIANT=preview` produces a **`.preview`** iOS bundle and Android package that
installs alongside production. A preview build:

- requires an **HTTPS, non-production** API host (it refuses to build against a
  production host),
- drops the production universal-link / app-link claims, and
- **never** consumes the production `GOOGLE_SERVICES_JSON`.

Preview Android push is **disabled** until a separately scoped preview Firebase file is
provided through its **own** variable, `GOOGLE_SERVICES_JSON_PREVIEW` (a distinct
Firebase project/app registered for the `.preview` package). The production and preview
identities can therefore never cross.

---

## Rotation procedure (FCM v1 service-account key)

1. In Google Cloud IAM, create a **new** JSON key for the dedicated FCM service account.
2. Upload the new key to EAS (Android credentials → *FCM V1 service account key* →
   upload new key). EAS keeps one active key.
3. Verify the new key's masked *Private key ID* is shown in EAS.
4. In Google Cloud IAM, **disable then delete** the old key.
5. No rebuild is required — the credential is used server-side by the Expo push service.

Rotating **`google-services.json`** (client config) is different: replace the
`GOOGLE_SERVICES_JSON` EAS file variable, then ship a new build (it is baked into the
binary).

---

## Failure symptoms & diagnostics

- **Build fails with `[app.config] production: ...`** — a fail-closed guard fired.
  Grep the EAS build log for `[app.config]`; the message names the exact cause
  (missing `GOOGLE_SERVICES_JSON`, wrong/non-HTTPS API host, or a resolved preview
  identity). A healthy production build logs
  `[app.config] production Android build: android.googleServicesFile is configured from GOOGLE_SERVICES_JSON.`
- **App installs but Android push never registers**, with device logcat showing
  `Default FirebaseApp failed to initialize ... com.google.gms:google-services was not
  applied to your gradle project` — the build shipped **without** the google-services
  file (i.e., `GOOGLE_SERVICES_JSON` was not present at build time). No Android device
  token is registered. iOS is unaffected.
- **Push "sent" but not delivered to Android** — check the EAS FCM v1 credential is
  present and points at the correct Firebase project.

---

## Validating a new build (vc17)

1. Build one production Android artifact → version **1.1.0 (17)** (`versionCode` 16→17).
2. Upload vc17 to the **Internal testing** track (replaces vc16 for internal testers).
   Production track stays untouched.
3. Install vc17 from internal testing and sign in.
4. Confirm logcat shows **no** `Default FirebaseApp failed to initialize`, and that
   FirebaseApp initializes.
5. Grant notification permission → confirm a **new Android device token registers**.
6. Then, under separate authorization, send **one** push and verify: organization-branded
   title, category subtitle, Android monochrome status-bar icon, deep link opens only an
   approved in-app destination, and tenant isolation on tap.

## Rollback

- vc17 can be **halted for new testers** on the internal track.
- **Devices already updated to vc17 cannot be downgraded to vc16** — Android/Play does
  not allow installing a lower `versionCode` over a higher one. Correcting a bad vc17
  requires a **higher corrective build (e.g. vc18)**.
- The production track is untouched throughout; no production or credential exposure is
  involved in a rollback.

# Apple Credentials Setup — Unestra macOS Signing & Notarization

This is the exact, human-only checklist for setting up Apple Developer credentials for the macOS release-candidate pipeline (`.github/workflows/macos-signing-notarization.yml`). Only the Apple Developer account owner (Abram) can complete these steps — no amount of tooling can do this on your behalf, and you should never paste certificate contents, private keys, or passwords into chat.

## 1. Confirm your Apple Developer account

1. Sign in at https://developer.apple.com/account.
2. Confirm your membership is active (paid, not expired).
3. Note your **Team ID** (Membership tab, or Xcode → Account → team details) — a 10-character alphanumeric string. This becomes the `APPLE_TEAM_ID` secret.

## 2. Confirm the bundle identifier

The desktop app's permanent bundle identifier is **`com.civicflow.app`** — this is deliberate (see `src/shared/appConfig.js`'s comment: changing it would orphan existing users' local data and license files). You do not need to register a new identifier; if `com.civicflow.app` isn't already registered under your Team in Certificates, Identifiers & Profiles, register it there now (Identifiers → App IDs → register `com.civicflow.app`).

## 3. Create a Developer ID Application certificate

This is the certificate type required to sign an app distributed **outside** the Mac App Store (which is exactly what this DMG is). Do not use an "Apple Development" or "Apple Distribution" certificate — neither is valid for this purpose.

1. On a Mac, open **Keychain Access** → Certificate Assistant → Request a Certificate from a Certificate Authority, save the `.certSigningRequest` file to disk.
2. In Apple Developer → Certificates → **+** → choose **Developer ID Application** (under "Software") → upload the CSR → download the resulting `.cer` file.
3. Double-click the downloaded `.cer` to install it into Keychain Access. Confirm it appears under **My Certificates** with a disclosure triangle revealing its private key underneath — if there's no private key, the certificate is unusable for signing and must be re-requested from the machine that generated the original CSR.

## 4. Export the certificate as a password-protected `.p12`

1. In Keychain Access, select **both** the certificate and its private key (expand the disclosure triangle, select both rows).
2. Right-click → Export 2 items… → format **Personal Information Exchange (.p12)**.
3. Set a strong export password when prompted — this becomes the `MACOS_CERTIFICATE_PASSWORD` secret. Do not reuse your Apple ID password or any password used elsewhere.
4. Save the file somewhere private, e.g. `~/Desktop/developer_id.p12` (temporarily).

## 5. Base64-encode the `.p12` for GitHub Secrets

GitHub Secrets store text, not binary files, so the certificate must be base64-encoded first:

```bash
base64 -i developer_id.p12 -o developer_id.p12.b64
```

The contents of `developer_id.p12.b64` (a single long line of text) become the `MACOS_CERTIFICATE_BASE64` secret value.

**Immediately delete `developer_id.p12` and `developer_id.p12.b64` from disk once the secret is saved in GitHub** (or move them to a password manager's secure file storage — never leave them sitting in `~/Desktop` or any synced folder).

## 6. Create an App Store Connect API key (preferred notarization method)

This is the recommended, non-expiring (until manually revoked) way to authenticate notarization requests — preferred over the legacy Apple ID + app-specific password method.

1. Go to https://appstoreconnect.apple.com/access/integrations/api.
2. Under **Team Keys**, click **+** to generate a new key.
3. Name it something identifiable, e.g. "Unestra macOS Notarization CI".
4. Access level: **Developer** is sufficient for notarization — do not grant Admin access, which this key doesn't need.
5. Click **Generate**, then **Download API Key** — **you can only download the `.p8` file once, ever.** If you lose it, you must revoke this key and generate a new one.
6. Record, from the same page:
   - **Key ID** (short alphanumeric, e.g. `ABCD123456`) → becomes `APPLE_API_KEY_ID`.
   - **Issuer ID** (a UUID, shown above the key list) → becomes `APPLE_API_ISSUER_ID`.

## 7. Base64-encode the `.p8` key

```bash
base64 -i AuthKey_ABCD123456.p8 -o AuthKey.p8.b64
```

The contents of `AuthKey.p8.b64` become the `APPLE_API_PRIVATE_KEY_BASE64` secret value.

**Delete the local `.p8` and `.b64` files immediately after the secret is saved.** Store the original `.p8` in a password manager if you need a durable backup — never in this repository, never in chat, never in a synced plain-text folder.

## 8. (Fallback only) Apple ID + app-specific password

Only needed if you skip the API-key method entirely. Prefer the API key above.

1. Sign in at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords → generate one, label it "Unestra Notarization".
2. `APPLE_ID` = your Apple ID email. `APPLE_APP_SPECIFIC_PASSWORD` = the generated password. `APPLE_TEAM_ID` = same Team ID from step 1.

## 9. Add the secrets to GitHub

Repository → Settings → Secrets and variables → Actions → **New repository secret**, one per row below. Paste only the exact value described — never a filename, never a partial value.

| Secret name | Value |
|---|---|
| `APPLE_TEAM_ID` | Your 10-character Team ID |
| `MACOS_CERTIFICATE_BASE64` | Contents of `developer_id.p12.b64` |
| `MACOS_CERTIFICATE_PASSWORD` | The export password you set in step 4 |
| `MACOS_KEYCHAIN_PASSWORD` | A new, random password (e.g. generate with `openssl rand -base64 32`) — used only to protect the temporary CI keychain for the duration of one job run; it is never reused or persisted anywhere |
| `APPLE_API_KEY_ID` | Key ID from step 6 |
| `APPLE_API_ISSUER_ID` | Issuer ID from step 6 |
| `APPLE_API_PRIVATE_KEY_BASE64` | Contents of `AuthKey.p8.b64` |
| `APPLE_ID` *(fallback only)* | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` *(fallback only)* | The app-specific password from step 8 |

## 10. Never do this

- Never paste any of the above values into a chat message, an issue, a commit message, or a code comment.
- Never commit the `.p12` or `.p8` files, even temporarily, even in a private branch (`.gitignore` now blocks these extensions, but don't rely on that alone).
- Never send the certificate or private key to anyone by email or chat, including to an AI assistant.

## 11. Run the workflow

Once all secrets above are set:

1. Go to the **Actions** tab → **macOS Signing, Notarization, and DMG Release Candidate** → **Run workflow**.
2. Choose the `agent/macos-signing-notarization` branch (or `main` once merged).
3. Leave `run_notarization` checked, leave `create_draft_release_candidate` unchecked for a first test run.
4. Watch the `preflight` job first — it reports exactly which secrets it found (never their values). If anything shows `missing`, fix that secret and re-run before worrying about the rest of the pipeline.
5. Download and test the resulting DMG from the workflow's private artifacts before ever considering `create_draft_release_candidate`.

## 12. Certificate and key rotation

- **Developer ID Application certificates** are valid for 5 years. Set a calendar reminder before expiry — re-run steps 3–5 and 9 (cert row only) to rotate.
- **App Store Connect API keys** do not expire but can be revoked at any time from the same integrations page. Rotate immediately if you suspect the `.p8` or the `APPLE_API_PRIVATE_KEY_BASE64` secret was ever exposed — revoke the old key, generate a new one, repeat steps 6–7 and 9.

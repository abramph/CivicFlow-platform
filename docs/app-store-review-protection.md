# Unestra — App Store Review Protection

## Current status

**Waiting for Review** (confirmed by the maintainer, 2026-07-30) — the iOS build has been submitted through App Store Connect and is in Apple's queue, not yet picked up by a reviewer.

## Why this matters for ongoing development

Repository work on `civicflow-mobile` continues independently of the App Store review — the submitted build is a frozen snapshot (a specific EAS build artifact + its exact bundle/version/build-number combination), not a moving target tied to the `main` branch. Nothing merged to `main` after the submission automatically becomes part of what Apple is reviewing. This is what makes it safe to keep developing (as this session did — the accessibility baseline, push-notification fix, and PTA mobile parity work all landed on `main` after this submission) without disturbing the review.

## What must not happen while a build is in review

Per this project's standing constraints:

- Do not withdraw the current App Store submission.
- Do not replace the submitted build.
- Do not alter App Store Connect metadata (screenshots, description, keywords, age rating, etc.) for the in-review version.
- Do not submit a new version unless a confirmed critical review blocker requires it.
- Do not change the bundle identifier.
- Do not revoke the Apple Distribution certificate or change the provisioning profile the review build was signed with.

None of these were touched this session. `civicflow-mobile/eas.json`, `app.json` (bundle ID `com.aphtechnologies.unestra`, associated domains), and the signing/certificate secrets (`APPLE_API_ISSUER_ID`, `APPLE_API_KEY_ID`, `APPLE_API_PRIVATE_KEY_BASE64`, `APPLE_TEAM_ID` — used for macOS notarization, and potentially shared with iOS submission depending on how EAS Submit is configured) were inspected only to confirm their names exist as GitHub secrets, never read or modified.

## If Apple reports an issue during review

1. Assess the specific rejection reason from App Store Connect (Resolution Center).
2. Apply the smallest necessary correction — do not use a rejection as an excuse to bundle in unrelated fixes or ship whatever has accumulated on `main` since submission.
3. Preserve all other in-flight production-development work; a rejection on the mobile submission has no bearing on the portal/API/desktop release cadence.
4. Document whether a new build is required (most rejections do require a new build + new submission; metadata-only rejections sometimes don't).
5. **Do not resubmit without explicit authorization** unless a future task grants automatic resubmission authority — this task's authority explicitly excludes submitting a new version except to fix a confirmed critical blocker.

## What's ready for the next mobile release, once review completes

The following work has landed on `main` since this build was submitted and will be included in the *next* build once one is cut:

- Push-notification recipient-targeting fix (household adults now correctly resolved instead of the unset billing-member `userId`) — see `docs/push-notification-architecture.md` if present, or the PR history for #22.
- Org-discovery capability-flag fix (PTA navigation no longer shown once Labs enrollment is removed).
- Full mobile accessibility baseline (PR #25).
- React Native component-test infrastructure (PR #25).

None of this requires resubmitting the current in-review build — it's simply what a future, separate build/submission would include.

## Recommended next mobile release step

Once Apple's review on the current submission concludes (approved or rejected):
- **If approved**: cut the next internal/preview build incorporating the work above, run the physical-device pass (screen reader, Dynamic Type, the PTA parent + Riverdale isolation scripts) that this Windows environment cannot perform, then submit through the normal EAS Submit flow when ready.
- **If rejected**: address the specific rejection first, in isolation from the accumulated `main` work, to get the original submission (or its minimal fix) through review before bundling in anything else.

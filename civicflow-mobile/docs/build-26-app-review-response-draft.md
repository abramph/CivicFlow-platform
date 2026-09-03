# Draft App Review response — build 26

For the human submitter to review, edit, and paste into App Store Connect's
Resolution Center when responding to the Guideline 5.1.1(iv) rejection of
build 1.0.0 (25). Not sent by anyone other than the account holder.

---

> Thank you for the review. We've corrected the camera-permission flow
> flagged under Guideline 5.1.1(iv).
>
> The screen in question (attendance check-in, reached from the app's
> dashboard when a member chooses to scan a meeting QR code) previously
> asked "Grant Camera Access" before requesting system permission. We've
> replaced this with neutral copy that explains why the camera is needed
> and offers "Continue" / "Not Now" — "Continue" only advances to the
> system permission dialog and does not itself claim to grant, allow, or
> enable anything. The system dialog's own Allow/Don't Allow choice is the
> only place a permission decision is made.
>
> This screen continues to appear only in context — after the user has
> already navigated to the QR-scan feature specifically — never at launch,
> sign-in, or registration.
>
> We also found and fixed the same class of issue would have applied to a
> new feature in this build: an optional family-photo upload for PTA
> households, which uses the same neutral pattern from first release.
>
> Build 26 includes this correction. We're happy to answer any follow-up
> questions.

---

## Internal notes (not part of the submitted text)

- The corrected screen is `attendance-scan.tsx`; see
  `src/app/__tests__/attendance-scan.test.tsx` for the automated proof this
  screen's copy never regresses to directive wording (asserts the rendered
  tree never contains "Grant", "Allow Access", "Enable Camera", or "You
  Must Allow").
- The new family-photo feature (`pta-family-photo.tsx`) shipped with the
  corrected pattern from the start — it was never in a rejected build, but
  is mentioned above because it's the same class of UI and a reviewer may
  reasonably check it too.
- `Info.plist`'s `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`
  strings (set via `app.json`'s `expo-camera` / `expo-image-picker` plugin
  config) were updated to describe both real uses of each permission
  (QR scan + family photo; receipt photo + family photo) — a reviewer
  cross-checking the system prompt text against actual app behavior should
  find it accurate for every path that can trigger it.

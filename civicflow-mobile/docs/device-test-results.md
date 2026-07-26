# Unestra Mobile — Device Test Results

**No physical device, iOS Simulator, or Android emulator was available in this environment** (Windows, no Mac, no configured emulator) — the same constraint documented in every prior pass's release checklist. Every result below was obtained one of two ways, and each finding says which: (a) real HTTP calls against a real disposable Postgres database with real seeded accounts and real bearer tokens (proves business logic and API correctness, not rendering), or (b) static analysis of the app's source code (proves what the code declares/contains, not what actually renders or behaves on a device). Neither substitutes for an actual on-device pass — see "What must happen next" at the end.

## PTA parent walkthrough (Pine Grove, `parent@pinegrovepta.example` / Casey Kim)

All 18 steps executed via direct HTTP calls with a real bearer token. **Zero failures.**

| Step | Result |
|---|---|
| 1. Login | Success — token issued |
| 2. MFA | **Not exercised** — this seed account has no MFA configured; login returned tokens directly rather than an MFA challenge. Not a failure, a seed-data gap: no PTA-parent seed account has MFA enabled to test against. |
| 3. Organization selection | Correct — only Pine Grove listed, `memberId: null`, `pta.householdAdultId` present |
| 4. Dashboard (composed) | All four source calls (announcements, events, dues, volunteer hours) returned 200 with real data |
| 5. Announcements | Real seeded "Welcome to Pine Grove PTA!" announcement returned |
| 6. Events | Both seeded events returned, with real RSVP state |
| 7. RSVP | Changed Family Movie Night from GOING → MAYBE; persisted correctly (verified via re-fetch) |
| 8. Volunteer opportunities | Real seeded "Picture Day Helpers" opportunity returned |
| 9. Volunteer commitments | Real commitment history returned (one ATTENDED, one SIGNED_UP) |
| 10. Volunteer hours | `0 approved / 480 pending / 600 required` — real, consistent numbers |
| 11. Membership/Dues | Real WAIVED charge with adjustment history returned |
| 12. Payment report | Submitted successfully, `status: "pending"` |
| 13. Inbox | 200 with correct empty state (no conversations exist for this household in seed data) |
| 14. Minutes | Real approved September minutes record returned |
| 15. Documents | Real budget + bylaws documents returned, both honestly `downloadable: false` |
| 16. Profile | Org-discovery-sourced name/email/org display confirmed correct |
| 17. Organization switch | Correctly shows only one option (Pine Grove) — no other org to switch to for this identity, which is correct, not a bug |
| 18. Logout | Token immediately invalidated — confirmed the same token returns 401 on the next call |

## Conventional organization walkthrough (Riverdale Community Association)

Tested using `president@pinegrovepta.example` (Alex Morgan), who holds a PTA officer identity in Pine Grove **and** a plain `STAFF` (non-`MEMBER`) `OrganizationMembership` in Riverdale — the most rigorous available cross-org identity in the seed data.

- **No seeded conventional `MEMBER`-role login exists for Riverdale** — its only `OrgMember` (Taylor Brooks) has no linked `User` account, and both Users tied to Riverdale (`director@riverdaleassociation.example`, and Alex Morgan) hold non-`MEMBER` roles (`ORG_OWNER`, `STAFF`). This means a full "conventional member" UI walkthrough for Riverdale specifically could not be performed — a real, honestly-reported seed-data gap, not a code gap.
- **PTA leakage check**: with Alex Morgan's token, all `/api/mobile/pta/*` routes against Riverdale's organization ID returned `403 "PTA is not available for this organization"`. Org discovery for this account does not list Riverdale at all (a `STAFF` membership without a PTA permission is correctly excluded from the mobile org-switcher by design — see `mobile-architecture.md`). **Zero PTA data or navigation leaked into Riverdale.**
- **Role-check correctness**: the same token against Riverdale's conventional member-only routes (`dues`, `announcements`, `events`) returned `403 "No active membership for this organization"` — confirming `requireMobileMembership`'s strict `role === "MEMBER"` check correctly rejects a real, active, but wrong-role membership, not just a nonexistent one.
- **Org-access-guarded routes** (Inbox, payment-methods) correctly returned `200` with empty data — this account does have *some* active identity in Riverdale (`STAFF`), which is sufficient for those intentionally-loosened guards.

## Accessibility (static analysis only — no screen reader available)

| Check | Method | Finding |
|---|---|---|
| VoiceOver / TalkBack | Static: searched for `accessibilityLabel`, `accessibilityRole`, `accessibilityHint`, `accessible=` | **Zero occurrences anywhere in the codebase.** Screen-reader support relies entirely on React Native's untailored defaults. This is a real gap — interactive elements (icon-only buttons, custom RSVP chips, status pills) likely have no meaningful spoken label today. Not verified with an actual screen reader. |
| Dynamic Type / large fonts | Static: searched for `allowFontScaling` | Never disabled anywhere — system font scaling should work via React Native's default behavior. Positive finding, **not confirmed on a real device with large-text settings enabled.** |
| Landscape | Config: `app.json` → `"orientation": "portrait"` | **Definitively locked to portrait** — this doesn't require a device to confirm; the OS enforces it from this config alone. Landscape is not supported at all. |
| Tablet layout | Config: `ios.supportsTablet: true`; no equivalent Android declaration; no dedicated tablet layouts anywhere in the code (flexible/flex-based layouts only) | iPad would run the app but with no tablet-optimized layout; not verified on an actual iPad. |
| Color contrast | Computed WCAG 2.1 contrast ratios from `constants/theme.ts`'s defined palette | All text/background pairs pass AA (≥4.5:1) comfortably — light theme 5.94–21:1, dark theme 10.08–21:1. Accent colors (green `#047857`, red `#B42318`, amber `#B54708`) pass AA normal text (5.4–6.6:1) but not AAA (7:1). No real contrast problems found. |
| Touch targets | Static: consistent `Spacing.three` (16pt) vertical padding on buttons app-wide; no `hitSlop` usage anywhere | Likely close to or above the 44pt (iOS) / 48dp (Android) minimum given consistent padding, but **not measured on an actual rendered device.** |
| Keyboard navigation | Static: `KeyboardAvoidingView` usage | Present and consistently applied on every text-input screen (login, MFA, invite-accept, conversation reply, both payment-report forms) — on-screen keyboard avoidance is handled. External/physical keyboard focus order was not tested and isn't strongly supported by React Native without additional work. |

## Performance

| Measurement | Method | Result |
|---|---|---|
| API latency | `curl -w "%{time_total}"` against the local dev server + local disposable Postgres, 3 runs per endpoint | 7–9ms per call after warm-up. **Not representative of production or mobile-network conditions** — this only proves the query/route logic itself isn't a bottleneck locally; says nothing about real device-to-server latency, cold serverless-function starts, or cellular network conditions. |
| Cold launch, warm launch, memory | Requires a running app instance on a device/simulator | **Not measurable in this environment.** |
| Organization switching | Same as API latency — the org-discovery call itself is fast locally | Actual perceived switch time (including React re-render, screen re-fetch) not measurable without a running app. |
| Large announcement/volunteer lists | Requires either bulk synthetic data or a load-testing tool | **Not tested.** Current seed data has 1–2 items per list — too small to be a meaningful stress test. Generating bulk synthetic data was judged out of scope for this validation pass (would mean adding new test data, not validating existing behavior). |
| Offline behavior | Requires a device to toggle airplane mode against a running app | **Not tested.** Known and unchanged from every prior pass: no offline caching layer exists anywhere in this app; screens are expected to show a loading state that never resolves, or a raw fetch failure, when offline. |

## What must happen next

Every item marked "not measurable/not tested" above requires one thing this environment cannot provide: a real device, simulator, or emulator with the app actually installed and running. The two Android preview build APKs produced this pass (see `android-preview.md`) are the concrete artifacts to install and interact with — that manual pass is the next, necessary step before any beta distribution, and should specifically re-walk the 18-step PTA parent script and the Riverdale isolation checks above with an actual screen reader enabled at least once.

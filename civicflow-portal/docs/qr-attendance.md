# QR Meeting Attendance

Lets an organization administrator generate a secure, scannable check-in code for a scheduled `Meeting`, and lets members check themselves in via the Unestra mobile app, their phone's regular camera (opening a web fallback page), or an authenticated Unestra web session. Staff can also record attendance manually when scanning isn't available.

## For administrators

### Setting up and opening attendance

1. Open a meeting's detail page (`/meetings/[id]`) and click **QR Attendance**.
2. If no session exists yet, choose a mode:
   - **Rotating QR (recommended)** — the code re-signs every 30 seconds. A photo of the screen goes stale within seconds, which is the main defense against someone sharing a screenshot.
   - **Static QR** — one code valid for the whole check-in window. Meant for printed sheets or venues with unreliable connectivity for the projector/display device — clearly labeled as easier to share/forward than a rotating code.
3. Click **Open Attendance**. This is the actual "accepting scans" switch — creating a session doesn't by itself let anyone check in.
4. Click **Full-Screen QR** to project it, or **Print QR Sheet** for a printable version (best paired with Static mode, since a printed rotating code goes stale almost immediately).

### While attendance is open

- The live roster shows present/late/excused/absent counts and an attendance percentage, refreshing automatically (polling stops the moment you close attendance or switch to another browser tab).
- **Regenerate Code** bumps the session to a new signing version, instantly invalidating every code issued so far — use this if you suspect a code was shared or photographed and forwarded.
- **Close Attendance** stops accepting new scans. Reopening a closed session requires an ORG_ADMIN role or above (not just attendance-write permission) and is itself audit-logged, since it can affect a report that was already treated as final.
- **Correct** next to any roster row lets you change a member's status or add a reason — a reason is required whenever you change an already-set status, or set it to Excused.

### Exporting and audit history

- **Export CSV** requires the same permission as viewing the roster — nothing exportable that wasn't already viewable on-screen. Spreadsheet formula injection (cells starting with `=`, `+`, `-`, `@`) is neutralized.
- **View attendance audit history** (linked from the Attendance Session page) shows every session and record change: who opened/closed/regenerated/reopened the session, every manual correction and its reason, and every export.

## For members

- **Unestra app**: Dashboard → **Scan Attendance Code**, or from the Events tab. Grant camera access when prompted (used only to read the code, nothing is recorded from the camera). Scanning is paused automatically while a check-in request is in flight, so holding the code in frame doesn't send duplicate requests.
- **Regular phone camera**: scanning with the built-in camera app opens a Unestra web page. If you're signed out, you're sent to log in (and complete MFA if enabled) and automatically brought back to finish checking in — the code itself is never exposed in a way that lets anyone but you complete the check-in.
- **Manual alternative**: if scanning isn't possible, ask an administrator to record your attendance manually from the roster.
- Your attendance history is available in the app under Profile → **Attendance History**.

### Multi-organization members

If you belong to more than one organization, checking in always applies to whichever organization the scanned meeting actually belongs to — never whatever organization happens to be selected in the app at the time. This is enforced server-side: the organization comes from the code itself, not from client state.

## Security design (what a scanned code actually proves)

- The QR encodes a signed token (JWT, HS256) — never a raw database ID. The signing key for a given code is derived from a server-side secret plus the session's id and current "token version," so there's no separate reusable secret stored in the database at all.
- **Regenerating** a session bumps its token version — every code issued under the old version fails verification immediately, with no denylist to maintain.
- Verification always re-derives the organization and meeting from the session row looked up by the token's session id — the token's own claims about organization/meeting are a tamper-check, never the authorization source of truth.
- PRESENT vs. LATE is computed server-side from the meeting's scheduled start time and the session's grace period — the scanning device's clock is never trusted.
- A database-level unique constraint (`organizationId`, `memberId`, `meetingId`) prevents duplicate attendance rows even under concurrent/repeated requests — the first valid request creates the record, every later one (including a genuine race) returns that same confirmation instead of erroring or duplicating.
- Check-in attempts are rate-limited per IP.

### What this does *not* protect against

Scanning cannot fully prevent someone from photographing a code and forwarding it to someone else physically present at (or near) the venue — rotation, the short overall code lifetime, requiring the scanner to be signed in as themselves, and tenant/eligibility checks all raise the cost of doing this, but none of it is a substitute for an administrator physically supervising check-in if that level of assurance is actually required. No location verification or device fingerprinting is implemented in this version — if added later, it should be organization-opt-in, require explicit member permission, and always have a manual fallback.

## Camera permissions (mobile)

The app requests camera access with an explicit explanation ("Unestra uses your camera to scan the meeting QR code..."). If denied, the scanner screen shows a retry button (or a prompt to open Settings if the OS reports permission can't be re-requested in-app).

## Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `ATTENDANCE_QR_SECRET` | Signs/verifies check-in tokens. Falls back to an insecure development default outside of `NODE_ENV=production` — **must** be set to a real random value in production. | Production only |

Generate one the same way as other secrets in this project, e.g.:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Local development

No new local setup beyond the usual `civicflow-portal` dev flow (`npm run dev`) — the dev-mode fallback secret means QR sign/verify works locally without configuring `ATTENDANCE_QR_SECRET`. To test scanning end-to-end locally you'll need the mobile app's dev client (see `civicflow-mobile`'s own docs) pointed at your local API, since `expo-camera` requires a development build, not plain Expo Go.

## Testing

```bash
cd civicflow-portal
npm test                 # unit/route tests, incl. attendance-token, check-in idempotency, tenant isolation, CSV export
npx tsc --noEmit          # typecheck
npm run lint
npm run build             # production build
```

Key test files: `src/lib/__tests__/attendance-token.test.ts`, `attendance-checkin.test.ts`, `mobile-attendance-check-in-route.test.ts`, `attendance-session-tenant-isolation.test.ts`, `meeting-attendance-export-route.test.ts`.

## Deployment

Same process as every other portal change: push to `main`, DigitalOcean App Platform auto-deploys and runs `prisma migrate deploy` (via `npm run db:deploy`) automatically before restarting. The migration in this feature (`prisma/migrations/20260713120207_meeting_attendance_qr_sessions`) is purely additive — two new enums, two new tables' worth of columns, one new table, one new unique index — confirmed safe against production data before writing it (zero existing duplicate `(organizationId, memberId, meetingId)` groups).

Set `ATTENDANCE_QR_SECRET` in the DigitalOcean app spec before relying on this in production (see Environment Variables above).

## Rollback

Since the migration is additive-only:
- **App-level rollback**: revert the deploying commit(s) and let the normal deploy pipeline redeploy the prior version. The new tables/columns simply go unused by older code — no data loss.
- **Schema-level rollback** (only if truly necessary): a down-migration would `DROP TABLE "MeetingAttendanceSession"`, drop the `attendanceSessionId`/`method`/`correctionReason` columns and the new unique index from `AttendanceRecord`, and drop the three new enums. Not applied as part of this change; write and review it separately if actually needed, since it would delete any QR-sourced attendance data recorded in the meantime.
- **Full restore**: DigitalOcean's automated daily backups + point-in-time recovery for `civicflowprod`, per `docs/backup-and-disaster-recovery.md`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Attendance isn't currently open for this meeting" | Session status is DRAFT, CLOSED, or CANCELLED — open it from the Attendance Session page. |
| "This code has expired" / "was replaced with a new one" | Rotating code's ~2 minute lifetime passed, or the session was regenerated after the code was issued — rescan the currently-displayed code. |
| "Code belongs to another organization" / not eligible | The scanning member has no active membership in the meeting's organization, or their membership status isn't active. |
| Member stuck at login mid-scan | The `redirectTo` value on the web check-in flow only survives for the literal `/attendance/check-in` path — if this ever needs to cover more destinations, extend the allow-list in `middleware.ts`, `LoginForm.tsx`, and `login/mfa/page.tsx` together (they're intentionally kept in lockstep, not driven by a single shared constant, to keep the change auditable in each file). |
| `ATTENDANCE_QR_SECRET is not configured` error in logs | Env var missing in that environment — set it in the DO app spec (production) or accept the insecure dev fallback (non-production only). |

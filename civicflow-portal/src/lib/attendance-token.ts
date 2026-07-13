/**
 * Unestra SaaS — Meeting attendance QR check-in tokens
 *
 * The QR code a member scans never contains a raw MeetingAttendanceSession id,
 * meeting id, or organization id alone — it's a signed, short-lived JWT whose
 * signing key is *derived* per (sessionId, tokenVersion) from the server-wide
 * ATTENDANCE_QR_SECRET. This means:
 *
 *   - No reusable plaintext QR secret is ever stored in the database — only
 *     `tokenVersion` (an integer) lives on MeetingAttendanceSession.
 *   - Regenerating/revoking a session's QR is just bumping tokenVersion:
 *     every previously-issued token was signed with the *old* derived key,
 *     so it fails signature verification against the new one instantly,
 *     with no denylist to maintain.
 *   - Rotating-mode tokens embed a `slot` (a coarse time bucket, one per
 *     rotationSeconds) rather than being freshly random each time, so the
 *     server can validate against the current slot without a DB write per
 *     rotation — the QR image itself changes, no new row does.
 *
 * The payload is intentionally minimal (session/org/meeting ids, version,
 * slot, mode) — no member-identifying data, since the same code is shown to
 * everyone in the room. Verification always re-derives organizationId and
 * meetingId from the MeetingAttendanceSession row looked up by sessionId,
 * never trusts them from the token payload for authorization decisions.
 */
import { SignJWT, jwtVerify, decodeJwt } from "jose";
import crypto from "crypto";
import { getServerEnv } from "@/lib/env";
import type { AttendanceSessionMode } from "@prisma/client";

const TOKEN_ISSUER = "unestra-attendance";

interface AttendanceTokenPayload {
  sid: string; // MeetingAttendanceSession id
  oid: string; // organizationId (defense-in-depth only — never trusted alone)
  mid: string; // meetingId (defense-in-depth only — never trusted alone)
  v: number; // tokenVersion this token was signed under
  mode: AttendanceSessionMode;
  slot: number; // rotating: floor(now / rotationSeconds); static: 0
}

function getSecret(): string {
  const secret = getServerEnv().ATTENDANCE_QR_SECRET;
  if (!secret) {
    throw new Error("ATTENDANCE_QR_SECRET is not configured — set it in the environment before using attendance QR codes.");
  }
  return secret;
}

/** Per-(session, version) derived signing key — see module doc for why. */
function deriveKey(sessionId: string, tokenVersion: number): Uint8Array {
  return crypto.createHmac("sha256", getSecret()).update(`${sessionId}:${tokenVersion}`).digest();
}

export function currentRotationSlot(rotationSeconds: number): number {
  return Math.floor(Date.now() / 1000 / Math.max(1, rotationSeconds));
}

/** Tokens are short-lived regardless of mode — the session's own opensAt/closesAt
 * window and status are the real access control; token TTL just bounds how long
 * a captured/forwarded image stays scannable at all before needing a fresh scan. */
const TOKEN_TTL_SECONDS = 120;

export async function signAttendanceToken(params: {
  sessionId: string;
  organizationId: string;
  meetingId: string;
  tokenVersion: number;
  mode: AttendanceSessionMode;
  rotationSeconds: number;
}): Promise<string> {
  const slot = params.mode === "ROTATING_QR" ? currentRotationSlot(params.rotationSeconds) : 0;
  const key = deriveKey(params.sessionId, params.tokenVersion);
  return new SignJWT({
    sid: params.sessionId,
    oid: params.organizationId,
    mid: params.meetingId,
    v: params.tokenVersion,
    mode: params.mode,
    slot,
  } satisfies AttendanceTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS)
    .sign(key);
}

export type AttendanceTokenRejection =
  | "invalid"
  | "expired"
  | "session_not_found"
  | "session_not_open"
  | "outside_window"
  | "stale_version"
  | "future_slot"
  | "slot_too_old";

export type AttendanceTokenResult =
  | { ok: true; sessionId: string; organizationId: string; meetingId: string }
  | { ok: false; reason: AttendanceTokenRejection };

/** How many rotation slots in the past are still accepted, to absorb clock
 * skew and scan-to-submit latency. A future slot is never accepted. */
const ROTATION_TOLERANCE_SLOTS = 1;

/**
 * Verifies a scanned token against the *current* state of its
 * MeetingAttendanceSession (passed in by the caller, who is expected to have
 * peeked the session id via `unsafeDecodeSessionId` and freshly loaded the
 * row from the database — never from a cache — immediately before calling
 * this function).
 */
export async function verifyAttendanceToken(
  token: string,
  session: {
    id: string;
    organizationId: string;
    meetingId: string;
    status: string;
    mode: AttendanceSessionMode;
    tokenVersion: number;
    rotationSeconds: number;
    opensAt: Date | null;
    closesAt: Date | null;
  }
): Promise<AttendanceTokenResult> {
  if (session.status !== "OPEN") return { ok: false, reason: "session_not_open" };

  const now = new Date();
  if (session.opensAt && now < session.opensAt) return { ok: false, reason: "outside_window" };
  if (session.closesAt && now > session.closesAt) return { ok: false, reason: "outside_window" };

  let claimedVersion: number;
  try {
    const unverified = decodeJwt(token) as unknown as AttendanceTokenPayload;
    if (typeof unverified.v !== "number" || unverified.sid !== session.id) {
      return { ok: false, reason: "invalid" };
    }
    claimedVersion = unverified.v;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  // Verify the signature using the key derived from the token's *own*
  // claimed version — this proves the token was genuinely signed by us for
  // that exact (session, version) pair (a tampered/forged version claim
  // can't produce a valid signature without the server secret).
  let payload: AttendanceTokenPayload;
  try {
    const key = deriveKey(session.id, claimedVersion);
    const { payload: verified } = await jwtVerify(token, key, { issuer: TOKEN_ISSUER });
    payload = verified as unknown as AttendanceTokenPayload;
  } catch (err) {
    if (err instanceof Error && err.name === "JWTExpired") return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }

  // Now the *separate* revocation check: does the version this token was
  // genuinely signed under still match the session's current version? A
  // regenerate/revoke bumps tokenVersion, so a validly-signed-but-old-version
  // token is rejected here even though its own signature checks out.
  if (payload.v !== session.tokenVersion) return { ok: false, reason: "stale_version" };
  if (payload.oid !== session.organizationId || payload.mid !== session.meetingId) {
    return { ok: false, reason: "invalid" };
  }

  if (session.mode === "ROTATING_QR") {
    const currentSlot = currentRotationSlot(session.rotationSeconds);
    if (payload.slot > currentSlot) return { ok: false, reason: "future_slot" };
    if (currentSlot - payload.slot > ROTATION_TOLERANCE_SLOTS) return { ok: false, reason: "slot_too_old" };
  }

  return { ok: true, sessionId: session.id, organizationId: session.organizationId, meetingId: session.meetingId };
}

/** Peeks the session id from a token *without* verifying its signature, so
 * the caller can load the corresponding MeetingAttendanceSession row (the
 * source of truth for organizationId/meetingId/status/tokenVersion) before
 * calling `verifyAttendanceToken`. Never use this value for anything other
 * than a database lookup key. */
export function unsafeDecodeSessionId(token: string): string | null {
  try {
    const payload = decodeJwt(token) as unknown as AttendanceTokenPayload;
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

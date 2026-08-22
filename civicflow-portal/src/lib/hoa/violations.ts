import { Prisma } from "@prisma/client";
import type { Violation, ViolationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { sendPushToTokens } from "@/lib/push";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";
import { HoaError } from "./errors";

type TxClient = Prisma.TransactionClient;

/**
 * HOA Violations MVP — service layer. Every write goes through here, never
 * a raw `prisma.violation.update({ data: { status: ... } })` at a call
 * site, so the state machine and audit/notification side effects can never
 * be bypassed (mirrors this codebase's established convention for every
 * other stateful workflow — DuesCharge, MeetingMinutes approval, PTA
 * volunteer-hours approval).
 */

// ── State machine ─────────────────────────────────────────────────────────

const TRANSITIONS: Record<ViolationStatus, ViolationStatus[]> = {
  DRAFT: ["ISSUED", "DISMISSED"],
  ISSUED: ["ACKNOWLEDGED", "IN_REVIEW", "CURED", "DISMISSED"],
  ACKNOWLEDGED: ["IN_REVIEW", "CURED", "DISMISSED"],
  IN_REVIEW: ["CURED", "RESOLVED", "DISMISSED"],
  CURED: [],
  RESOLVED: [],
  DISMISSED: [],
};

const TERMINAL_STATUSES: ViolationStatus[] = ["CURED", "RESOLVED", "DISMISSED"];

export function isTerminalStatus(status: ViolationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function assertValidTransition(from: ViolationStatus, to: ViolationStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new HoaError(
      "HOA_VIOLATION_INVALID_TRANSITION",
      `Cannot move a violation from ${from} to ${to}. Valid next steps from ${from}: ${TRANSITIONS[from].join(", ") || "none (terminal)"}.`
    );
  }
}

// ── Create / edit (DRAFT only) ───────────────────────────────────────────

export async function createViolationDraft(input: {
  organizationId: string;
  propertyId: string;
  violationType: string;
  description: string;
  cureByDate?: Date | null;
  actorUserId: string;
}): Promise<Violation> {
  const property = await prisma.property.findFirst({ where: { id: input.propertyId, organizationId: input.organizationId } });
  if (!property) throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");

  const violation = await prisma.$transaction(async (tx) => {
    const created = await tx.violation.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        violationType: input.violationType,
        description: input.description,
        cureByDate: input.cureByDate ?? null,
        createdByUserId: input.actorUserId,
        status: "DRAFT",
      },
    });

    await tx.violationStatusHistory.create({
      data: {
        organizationId: input.organizationId,
        violationId: created.id,
        fromStatus: null,
        toStatus: "DRAFT",
        changedByUserId: input.actorUserId,
      },
    });

    return created;
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "create",
    entityType: "hoa_violation",
    entityId: violation.id,
    metadata: { propertyId: input.propertyId, violationType: input.violationType },
  });

  return violation;
}

/** Only a DRAFT violation can be edited directly — once issued, corrections
 * happen through status transitions and comments (an append-only record of
 * what happened), never a silent field edit that would rewrite history. */
export async function updateViolationDraft(input: {
  organizationId: string;
  violationId: string;
  violationType?: string;
  description?: string;
  cureByDate?: Date | null;
}): Promise<Violation> {
  const existing = await prisma.violation.findFirst({ where: { id: input.violationId, organizationId: input.organizationId } });
  if (!existing) throw new HoaError("HOA_VIOLATION_NOT_FOUND", "Violation not found.");
  if (existing.status !== "DRAFT") {
    throw new HoaError(
      "HOA_VIOLATION_INVALID_TRANSITION",
      "Only a DRAFT violation can be edited directly. Once issued, use a status transition or a comment instead."
    );
  }

  return prisma.violation.update({
    where: { id: input.violationId },
    data: {
      violationType: input.violationType ?? undefined,
      description: input.description ?? undefined,
      cureByDate: input.cureByDate === undefined ? undefined : input.cureByDate,
    },
  });
}

// ── Transitions ────────────────────────────────────────────────────────────
//
// issueViolation() and transitionViolationStatus() both follow the same
// two-phase shape, closing a real concurrency gap found in independent
// review: two simultaneous requests against the same violation (e.g. one
// officer clicking "Acknowledge" while another clicks "Dismiss", or a
// double-submitted "Issue" click) previously both read the same starting
// status, both passed assertValidTransition, and both wrote — silently
// corrupting state (last write wins) while BOTH transitions landed in
// violationStatusHistory, diverging the audit trail from reality.
//
// Phase 1 (inside a $transaction): re-read the violation, validate the
// transition, then apply it via a conditional updateMany() whose WHERE
// clause repeats the expected starting status — a compare-and-swap. If a
// concurrent request already changed the status, `count` is 0 and this
// throws HOA_VIOLATION_STALE_UPDATE instead of silently overwriting
// whatever the other request just committed. The status-history row is
// written in the same transaction, so the two can never diverge.
//
// Phase 2 (after the transaction commits): notify residents. Deliberately
// OUTSIDE the transaction and wrapped in try/catch — a provider outage
// must never roll back (there's nothing to roll back for an email) nor
// surface as a failed API response when the state change itself actually
// succeeded and was already committed.

async function recordTransitionTx(
  tx: TxClient,
  input: {
    organizationId: string;
    violationId: string;
    fromStatus: ViolationStatus;
    toStatus: ViolationStatus;
    actorUserId: string;
    notes?: string | null;
  }
): Promise<void> {
  await tx.violationStatusHistory.create({
    data: {
      organizationId: input.organizationId,
      violationId: input.violationId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      changedByUserId: input.actorUserId,
      notes: input.notes ?? null,
    },
  });
}

/** Never throws — a notification-delivery failure is logged and swallowed,
 * never allowed to make an already-committed state transition look like it
 * failed, and never allowed to abort a cron batch after one bad recipient. */
async function notifyPropertyResidentsSafely(
  organizationId: string,
  propertyId: string,
  notification: { kind: NotificationKind; title: string; body: string; violationId: string }
): Promise<void> {
  try {
    await notifyPropertyResidents(organizationId, propertyId, notification);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "hoa_violation_notification_failed",
        organizationId,
        violationId: notification.violationId,
        kind: notification.kind,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

/** DRAFT -> ISSUED: the only transition that also sends the resident's
 * first notice of the violation and stamps issuedAt. */
export async function issueViolation(input: {
  organizationId: string;
  violationId: string;
  cureByDate?: Date | null;
  noticeBody: string;
  actorUserId: string;
}): Promise<Violation> {
  const { updated, propertyId } = await prisma.$transaction(async (tx) => {
    const violation = await tx.violation.findFirst({ where: { id: input.violationId, organizationId: input.organizationId } });
    if (!violation) throw new HoaError("HOA_VIOLATION_NOT_FOUND", "Violation not found.");
    assertValidTransition(violation.status, "ISSUED");

    const { count } = await tx.violation.updateMany({
      where: { id: violation.id, organizationId: input.organizationId, status: violation.status },
      data: {
        status: "ISSUED",
        issuedAt: new Date(),
        cureByDate: input.cureByDate === undefined ? violation.cureByDate : input.cureByDate,
      },
    });
    if (count === 0) {
      throw new HoaError("HOA_VIOLATION_STALE_UPDATE", "This violation was just updated by someone else. Refresh and try again.");
    }

    await tx.violationNotice.create({
      data: {
        organizationId: input.organizationId,
        violationId: violation.id,
        noticeType: "INITIAL",
        channel: "EMAIL",
        body: input.noticeBody,
        sentByUserId: input.actorUserId,
      },
    });

    await recordTransitionTx(tx, {
      organizationId: input.organizationId,
      violationId: violation.id,
      fromStatus: violation.status,
      toStatus: "ISSUED",
      actorUserId: input.actorUserId,
    });

    const updated = await tx.violation.findUniqueOrThrow({ where: { id: violation.id } });
    return { updated, propertyId: violation.propertyId };
  });

  // Best-effort, outside the transaction: an audit-event write failure or a
  // notification failure must never undo (or misreport) the state change
  // above, which has already committed. Matches this codebase's existing
  // convention elsewhere of audit events not being strictly transactional
  // with their triggering write.
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "update",
    entityType: "hoa_violation",
    entityId: updated.id,
    metadata: { fromStatus: "DRAFT", toStatus: "ISSUED" },
  });

  await notifyPropertyResidentsSafely(input.organizationId, propertyId, {
    kind: "issued",
    title: "New violation notice",
    body: input.noticeBody,
    violationId: updated.id,
  });

  return updated;
}

/** Every transition other than DRAFT->ISSUED (which has its own function
 * above, since it uniquely also sends the initial notice). `resolutionNotes`
 * is only meaningful — and only ever stored — when `toStatus` is terminal;
 * it is board/property-manager-only and never included in the
 * resident-facing payload (see toResidentSafeViolation below). */
export async function transitionViolationStatus(input: {
  organizationId: string;
  violationId: string;
  toStatus: ViolationStatus;
  notes?: string | null;
  resolutionNotes?: string | null;
  actorUserId: string;
}): Promise<Violation> {
  const terminal = isTerminalStatus(input.toStatus);

  const { updated, propertyId, fromStatus } = await prisma.$transaction(async (tx) => {
    const violation = await tx.violation.findFirst({ where: { id: input.violationId, organizationId: input.organizationId } });
    if (!violation) throw new HoaError("HOA_VIOLATION_NOT_FOUND", "Violation not found.");
    assertValidTransition(violation.status, input.toStatus);

    const { count } = await tx.violation.updateMany({
      where: { id: violation.id, organizationId: input.organizationId, status: violation.status },
      data: {
        status: input.toStatus,
        resolvedAt: terminal ? new Date() : undefined,
        resolutionNotes: terminal && input.resolutionNotes !== undefined ? input.resolutionNotes : undefined,
      },
    });
    if (count === 0) {
      throw new HoaError("HOA_VIOLATION_STALE_UPDATE", "This violation was just updated by someone else. Refresh and try again.");
    }

    await recordTransitionTx(tx, {
      organizationId: input.organizationId,
      violationId: violation.id,
      fromStatus: violation.status,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId,
      notes: input.notes,
    });

    const updated = await tx.violation.findUniqueOrThrow({ where: { id: violation.id } });
    return { updated, propertyId: violation.propertyId, fromStatus: violation.status };
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "update",
    entityType: "hoa_violation",
    entityId: updated.id,
    metadata: { fromStatus, toStatus: input.toStatus },
  });

  await notifyPropertyResidentsSafely(input.organizationId, propertyId, {
    kind: terminal ? "resolved_dismissed" : "status_changed",
    title: terminal ? "Violation notice closed" : "Violation status updated",
    body: `Your ${updated.violationType} violation status changed to "${formatStatusForResident(input.toStatus)}".`,
    violationId: updated.id,
  });

  return updated;
}

function formatStatusForResident(status: ViolationStatus): string {
  return status.replace(/_/g, " ").toLowerCase();
}

// ── Comments ─────────────────────────────────────────────────────────────

/** isPrivate defaults true at the schema level too (see schema.prisma) —
 * callers must explicitly opt in to a resident-visible comment, never the
 * reverse. */
export async function addViolationComment(input: {
  organizationId: string;
  violationId: string;
  body: string;
  isPrivate: boolean;
  actorUserId: string;
}) {
  const violation = await prisma.violation.findFirst({ where: { id: input.violationId, organizationId: input.organizationId } });
  if (!violation) throw new HoaError("HOA_VIOLATION_NOT_FOUND", "Violation not found.");

  return prisma.violationComment.create({
    data: {
      organizationId: input.organizationId,
      violationId: input.violationId,
      authorUserId: input.actorUserId,
      body: input.body,
      isPrivate: input.isPrivate,
    },
  });
}

// ── Officer reads ────────────────────────────────────────────────────────

export async function listViolations(
  organizationId: string,
  filters: { propertyId?: string; status?: ViolationStatus }
) {
  return prisma.violation.findMany({
    where: {
      organizationId,
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { property: { select: { id: true, addressLine1: true, unitLabel: true, displayName: true } } },
  });
}

export async function getViolationDetail(organizationId: string, violationId: string) {
  const violation = await prisma.violation.findFirst({
    where: { id: violationId, organizationId },
    include: {
      property: { select: { id: true, addressLine1: true, unitLabel: true, displayName: true } },
      notices: { orderBy: { sentAt: "desc" } },
      comments: { orderBy: { createdAt: "desc" } },
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!violation) throw new HoaError("HOA_VIOLATION_NOT_FOUND", "Violation not found.");
  return violation;
}

// ── Resident-safe projection ─────────────────────────────────────────────

export interface ResidentSafeViolation {
  id: string;
  propertyId: string;
  violationType: string;
  description: string;
  status: ViolationStatus;
  issuedAt: Date | null;
  cureByDate: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  notices: { id: string; noticeType: string; sentAt: Date; body: string }[];
  comments: { id: string; body: string; createdAt: Date }[];
}

/**
 * The ONLY function allowed to produce a resident-facing violation
 * payload — strips resolutionNotes and every private comment.
 * `resolutionNotes`/private comments never even reach the destructured
 * fields below, so a future field added to Violation without updating
 * this function stays excluded by default rather than silently leaking
 * (opt-in inclusion, not opt-out exclusion).
 */
export function toResidentSafeViolation(violation: {
  id: string;
  propertyId: string;
  violationType: string;
  description: string;
  status: ViolationStatus;
  issuedAt: Date | null;
  cureByDate: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  notices?: { id: string; noticeType: string; sentAt: Date; body: string }[];
  comments?: { id: string; body: string; isPrivate: boolean; createdAt: Date }[];
}): ResidentSafeViolation {
  return {
    id: violation.id,
    propertyId: violation.propertyId,
    violationType: violation.violationType,
    description: violation.description,
    status: violation.status,
    issuedAt: violation.issuedAt,
    cureByDate: violation.cureByDate,
    resolvedAt: violation.resolvedAt,
    createdAt: violation.createdAt,
    updatedAt: violation.updatedAt,
    notices: (violation.notices ?? []).map((n) => ({ id: n.id, noticeType: n.noticeType, sentAt: n.sentAt, body: n.body })),
    comments: (violation.comments ?? []).filter((c) => !c.isPrivate).map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt })),
  };
}

// ── Notifications ────────────────────────────────────────────────────────
// Deliberately only these four kinds — no notification on DRAFT creation
// or edit (an officer's internal working state, nothing to tell a resident
// yet).

type NotificationKind = "issued" | "deadline_reminder" | "status_changed" | "resolved_dismissed";

interface ResolvedResident {
  orgMember: { id: string; userId: string | null; email: string | null; commsEmailEnabled: boolean; commsPushEnabled: boolean };
  tokens: string[];
}

/** Shared by notifyPropertyResidents (broadcast) and sendDeadlineReminders
 * (per-recipient claim-then-send) so both read the exact same ACTIVE-only,
 * tenant-scoped resident set and device-token lookup. */
async function resolveActivePropertyResidents(organizationId: string, propertyId: string): Promise<ResolvedResident[]> {
  const residents = await prisma.propertyResident.findMany({
    where: { organizationId, propertyId, status: "ACTIVE" },
    select: {
      orgMember: {
        select: { id: true, userId: true, email: true, commsEmailEnabled: true, commsPushEnabled: true },
      },
    },
  });

  const userIds = residents.map((r) => r.orgMember.userId).filter((id): id is string => Boolean(id));
  const deviceTokens = userIds.length
    ? await prisma.mobileDeviceToken.findMany({ where: { userId: { in: userIds } }, select: { userId: true, token: true } })
    : [];
  const tokensByUserId = new Map<string, string[]>();
  for (const deviceToken of deviceTokens) {
    const list = tokensByUserId.get(deviceToken.userId) ?? [];
    list.push(deviceToken.token);
    tokensByUserId.set(deviceToken.userId, list);
  }

  return residents.map((r) => ({ orgMember: r.orgMember, tokens: tokensByUserId.get(r.orgMember.userId ?? "") ?? [] }));
}

/** Sends to exactly one already-resolved resident. Mirrors the same
 * commsEmailEnabled/commsPushEnabled opt-out check bulk communication
 * campaigns respect (src/lib/communication-campaigns.ts) -- a violation
 * notice is exactly the kind of message a member's own notification
 * preferences should govern, required-notice status aside (no
 * requiredNoticesOnly override exists for violations, unlike push's
 * existing bypass for legally-required notices, since this MVP has no
 * validated need for one yet). */
async function notifyOneResident(resident: ResolvedResident, notification: { title: string; body: string }): Promise<void> {
  const { orgMember, tokens } = resident;
  if (orgMember.email && orgMember.commsEmailEnabled) {
    await sendEmail({ to: orgMember.email, subject: notification.title, text: notification.body });
  }
  if (orgMember.userId && orgMember.commsPushEnabled && tokens.length > 0) {
    await sendPushToTokens(tokens, {
      title: notification.title,
      body: notification.body,
      // /hoa/violations/[id] is the OFFICER-only detail page (gated by
      // hoa:violations:read) -- a resident tapping this push must never
      // land there. There is no resident-facing per-violation detail
      // page yet, only the list at /m/violations (see
      // docs/hoa-violations-mvp.md's "deliberately not built" mobile
      // scope note), so that's the correct, actually-reachable target.
      deepLink: "/m/violations",
    });
  }
}

async function notifyPropertyResidents(
  organizationId: string,
  propertyId: string,
  notification: { kind: NotificationKind; title: string; body: string; violationId: string }
): Promise<void> {
  const residents = await resolveActivePropertyResidents(organizationId, propertyId);
  for (const resident of residents) {
    await notifyOneResident(resident, notification);
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEADLINE_REMINDER_TYPE = "DEADLINE_REMINDER";

/**
 * Scans for violations approaching their cureByDate and sends a
 * deadline-reminder notification to each of the property's ACTIVE
 * residents — called by a dedicated cron route
 * (src/app/api/cron/hoa-violation-reminders/route.ts), mirroring
 * processPendingReminderLogs's cron-worker pattern.
 *
 * Deduplication is per (violation, recipient, dueOffsetDays) via
 * ViolationReminderLog's unique constraint, NOT the server's local
 * calendar day. dueOffsetDays = floor((cureByDate - now) / 1 day) is
 * computed from absolute UTC epoch math, so it's identical no matter what
 * timezone the cron server runs in and can't be perturbed by a DST
 * transition. The unique constraint (not a preceding read) is what makes
 * this safe under real concurrency: two overlapping cron runs, retries, or
 * multiple app instances racing the same (violation, recipient, offset)
 * triple will see exactly one insert succeed and one hit P2002, which is
 * treated as "already sent" rather than an error — the same
 * compare-and-swap shape as the status-transition fix above, just via a
 * unique index instead of a conditional updateMany.
 *
 * A resident whose relationship starts partway through today, or a
 * delivery that fails transiently, isn't permanently stuck: dueOffsetDays
 * decreases by one on each later run (as cureByDate gets closer), so the
 * next day's claim is a fresh, distinct key rather than a repeat of
 * today's — a deliberately simple self-healing property rather than a
 * separate retry-queue mechanism.
 *
 * The per-recipient claim above is NOT by itself enough to make the
 * violation-level audit notice idempotent: two overlapping runs that each
 * win a *different* recipient's claim would, without a further guard,
 * each independently conclude "I sent a reminder for this violation" and
 * both write a resident-visible ViolationNotice row. So the very first
 * thing each run does for a violation is its own compare-and-swap — a
 * claim on ViolationNotice itself, unique on (violationId, noticeType,
 * dueOffsetDays) — and only the run that wins it processes any recipients
 * at all. This means at most one run per (violation, offset) ever gets
 * past this point, which also makes the per-recipient loop below
 * effectively non-concurrent for a given violation (the ViolationReminderLog
 * claim per recipient remains as defense-in-depth, not the sole guard).
 */
export async function sendDeadlineReminders(reminderWindowDays = 3): Promise<{ remindersSent: number }> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + reminderWindowDays * MS_PER_DAY);

  const dueSoon = await prisma.violation.findMany({
    where: {
      status: { in: ["ISSUED", "ACKNOWLEDGED", "IN_REVIEW"] },
      cureByDate: { not: null, gte: now, lte: windowEnd },
    },
    select: { id: true, organizationId: true, propertyId: true, violationType: true, cureByDate: true },
  });
  if (dueSoon.length === 0) return { remindersSent: 0 };

  // E2E-1 finding: this cron previously ran with no billing check at all.
  // Unlike CommunicationCampaign/EmailReminderLog/SmsMessage, a due-soon
  // violation isn't a discrete queued item with its own FAILED state — the
  // same violation is reconsidered on every tick as its offset counts down,
  // so a billing-inactive org's violation simply isn't claimed today (no
  // ViolationNotice/ViolationReminderLog row burned) and is naturally
  // reconsidered on a later tick, without needing FAILED-state bookkeeping.
  // Cached per organizationId since one tick's dueSoon list commonly spans
  // many violations for the same org.
  const billingActiveByOrg = new Map<string, boolean>();
  async function isBillingActive(organizationId: string): Promise<boolean> {
    const cached = billingActiveByOrg.get(organizationId);
    if (cached !== undefined) return cached;
    const access = await resolveOrganizationAccess(organizationId);
    billingActiveByOrg.set(organizationId, access.allowed);
    return access.allowed;
  }

  let remindersSent = 0;
  for (const violation of dueSoon) {
    if (!violation.cureByDate) continue;
    if (!(await isBillingActive(violation.organizationId))) {
      await createAuditEvent({
        organizationId: violation.organizationId,
        actorUserId: null,
        action: "hoa_violation_reminder.blocked",
        entityType: "violation",
        entityId: violation.id,
        metadata: { reason: "organization_subscription_required" },
      });
      continue;
    }
    const dueOffsetDays = Math.floor((violation.cureByDate.getTime() - now.getTime()) / MS_PER_DAY);
    const body = `Your ${violation.violationType} violation must be resolved by ${violation.cureByDate.toLocaleDateString()}.`;

    try {
      await prisma.violationNotice.create({
        data: {
          organizationId: violation.organizationId,
          violationId: violation.id,
          noticeType: DEADLINE_REMINDER_TYPE,
          channel: "EMAIL",
          body,
          dueOffsetDays,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) continue; // another run already owns this violation's reminder for this offset
      throw error;
    }

    const residents = await resolveActivePropertyResidents(violation.organizationId, violation.propertyId);
    let sentToAnyRecipient = false;

    for (const resident of residents) {
      try {
        await prisma.violationReminderLog.create({
          data: {
            organizationId: violation.organizationId,
            violationId: violation.id,
            orgMemberId: resident.orgMember.id,
            reminderType: DEADLINE_REMINDER_TYPE,
            dueOffsetDays,
          },
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) continue; // already reminded this recipient for this offset
        throw error;
      }

      sentToAnyRecipient = true;
      try {
        await notifyOneResident(resident, { title: "Violation deadline approaching", body });
      } catch (error) {
        // The claim row already committed -- see the function doc for why
        // that's the correct order (a transient failure gets a fresh
        // chance tomorrow rather than looping forever today).
        console.error(
          JSON.stringify({
            event: "hoa_violation_reminder_notification_failed",
            organizationId: violation.organizationId,
            violationId: violation.id,
            orgMemberId: resident.orgMember.id,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    if (sentToAnyRecipient) remindersSent++;
  }

  return { remindersSent };
}

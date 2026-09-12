import "server-only";
import type { OrganizationSmsSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { SMS_PLAN_TIERS } from "@/lib/sms-admin-pricing";

/**
 * Super-admin SMS-settings writer for a single organization.
 *
 * The enable/disable transition is the concurrency-sensitive part: two
 * requests from separate tabs/clients could both READ an inactive row and
 * then both "activate" it — double-resetting the billing period and emitting
 * two `sms_admin.addon_activated` audit events. This module makes the
 * transition a **database-safe atomic conditional UPDATE** (the same
 * row-locked `updateMany`-with-precondition idiom used by
 * reserveSmsAllowance() and grantInternalOrganizationTrial()), committed
 * together with its audit event in one transaction — never an in-memory
 * mutex. The winner is the single request whose `WHERE smsAddOnActive:<from>`
 * matched exactly one row; every concurrent loser gets truthful idempotent
 * state (no period reset, no duplicate activation audit).
 *
 * It never calls Stripe: billing-exempt enrollment must not create a
 * customer, subscription, invoice, or line item.
 */

export type SmsAdminAuditAction =
  | "sms_admin.addon_activated"
  | "sms_admin.addon_deactivated"
  | "sms_admin.org_settings_updated";

export interface SmsAdminSettingsInput {
  smsAddOnActive?: boolean;
  plan?: "STARTER" | "GROWTH" | "ENTERPRISE";
  smsMonthlyLimit?: number;
  smsOverageRateCents?: number;
  planPriceCents?: number;
  suspended?: boolean;
}

export interface ApplySmsAdminSettingsParams {
  organizationId: string;
  input: SmsAdminSettingsInput;
  reason: string | null;
  billingExempt: boolean;
  actor: { userId: string; userEmail?: string | null };
}

export interface ApplySmsAdminSettingsResult {
  settings: OrganizationSmsSettings;
  action: SmsAdminAuditAction;
  /** True only for the single request that actually flipped active state. */
  transitioned: boolean;
}

/** Non-transition fields (plan/overrides/suspension) shared by every path. */
function buildOrdinaryData(input: SmsAdminSettingsInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.suspended !== undefined) data.suspendedAt = input.suspended ? new Date() : null;
  if (input.plan) {
    data.plan = input.plan;
    const tier = SMS_PLAN_TIERS[input.plan];
    if (!tier.custom) {
      data.smsMonthlyLimit = tier.includedMessages;
      data.smsOverageRateCents = tier.overageRateCents;
      data.planPriceCents = tier.monthlyPriceCents;
    }
  }
  // Explicit numeric overrides always win (required for ENTERPRISE; also an
  // ad-hoc adjustment on any plan).
  if (input.smsMonthlyLimit !== undefined) data.smsMonthlyLimit = input.smsMonthlyLimit;
  if (input.smsOverageRateCents !== undefined) data.smsOverageRateCents = input.smsOverageRateCents;
  if (input.planPriceCents !== undefined) data.planPriceCents = input.planPriceCents;
  return data;
}

export async function applySmsAdminOrgSettings(params: ApplySmsAdminSettingsParams): Promise<ApplySmsAdminSettingsResult> {
  const { organizationId, input, reason, billingExempt, actor } = params;
  const ordinary = buildOrdinaryData(input);
  const hasOrdinary = Object.keys(ordinary).length > 0;

  // Guarantee the settings row exists WITHOUT disturbing an existing one
  // (atomic INSERT ... ON CONFLICT DO NOTHING). This removes the create-vs-
  // update race, so the conditional flips below are decided purely by the
  // smsAddOnActive precondition on a row that is certain to exist.
  await prisma.organizationSmsSettings.createMany({
    data: [{ organizationId, smsAddOnActive: false }],
    skipDuplicates: true,
  });

  return prisma.$transaction(async (tx) => {
    let action: SmsAdminAuditAction = "sms_admin.org_settings_updated";
    let transitioned = false;
    let previousAddOnActive = false;
    let newAddOnActive = false;

    if (input.smsAddOnActive === true) {
      const periodStart = new Date();
      const periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      // Atomic inactive→active claim + fresh period. Postgres row-locks the
      // matching row, so of N concurrent activations exactly ONE sees
      // smsAddOnActive:false and flips it (count 1); the rest match zero rows.
      const claim = await tx.organizationSmsSettings.updateMany({
        where: { organizationId, smsAddOnActive: false },
        data: {
          ...ordinary,
          smsAddOnActive: true,
          smsBillingPeriodStart: periodStart,
          smsBillingPeriodEnd: periodEnd,
          smsUsedThisPeriod: 0,
          lastUsageThresholdNotified: 0,
        },
      });

      if (claim.count === 1) {
        action = "sms_admin.addon_activated";
        transitioned = true;
        previousAddOnActive = false;
        newAddOnActive = true;
      } else {
        // Already active (idempotent re-send / concurrent loser): apply only
        // the ordinary edits — never re-reset the live period or re-audit as
        // an activation.
        if (hasOrdinary) await tx.organizationSmsSettings.update({ where: { organizationId }, data: ordinary });
        previousAddOnActive = true;
        newAddOnActive = true;
      }
    } else if (input.smsAddOnActive === false) {
      // Atomic active→inactive claim. Deactivation deliberately preserves
      // usage counters and billing-period history (no reset).
      const claim = await tx.organizationSmsSettings.updateMany({
        where: { organizationId, smsAddOnActive: true },
        data: { ...ordinary, smsAddOnActive: false },
      });

      if (claim.count === 1) {
        action = "sms_admin.addon_deactivated";
        transitioned = true;
        previousAddOnActive = true;
        newAddOnActive = false;
      } else {
        if (hasOrdinary) await tx.organizationSmsSettings.update({ where: { organizationId }, data: ordinary });
        previousAddOnActive = false;
        newAddOnActive = false;
      }
    } else {
      // No active-state change — ordinary settings edit only.
      if (hasOrdinary) await tx.organizationSmsSettings.update({ where: { organizationId }, data: ordinary });
      const current = await tx.organizationSmsSettings.findUniqueOrThrow({
        where: { organizationId },
        select: { smsAddOnActive: true },
      });
      previousAddOnActive = current.smsAddOnActive;
      newAddOnActive = current.smsAddOnActive;
    }

    const settings = await tx.organizationSmsSettings.findUniqueOrThrow({ where: { organizationId } });

    // Committed in the SAME transaction as the transition — a failed audit
    // insert rolls the transition back, so an org can never flip state without
    // a matching audit row, and (crucially) the loser never writes a second
    // addon_activated event.
    await createAuditEvent({
      organizationId,
      actorUserId: actor.userId,
      actorEmail: actor.userEmail,
      action,
      entityType: "OrganizationSmsSettings",
      entityId: settings.id,
      metadata: {
        ...input,
        reason,
        billingExempt,
        previousAddOnActive,
        newAddOnActive,
        quota: settings.smsMonthlyLimit,
      },
      tx,
    });

    return { settings, action, transitioned };
  });
}

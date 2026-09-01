import type { Role } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

type FinancialRecord = {
  createdAt: Date;
  lockedAt?: Date | null;
  voidedAt?: Date | null;
};

export async function getFinancialEditPolicy(organizationId: string) {
  const settings = await prisma.orgSettings.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });

  return {
    editWindowHours: settings.financialEditWindowHours,
    requireReasonForFinancialEdits: settings.requireReasonForFinancialEdits,
    allowFinanceCorrections: settings.allowFinanceCorrections,
    lockReceiptsAfterIssue: settings.lockReceiptsAfterIssue,
  };
}

export interface FinancialEditCheck {
  allowed: boolean;
  reason: string;
  /** True when this record can only be saved alongside a non-empty
   * editReason (a privileged, outside-window correction where the org
   * policy requires one). Callers rendering a form use this to decide
   * whether to show/require the reason field *before* the user has typed
   * anything -- computed here, once, so no caller has to re-derive the
   * window/lock/policy branching above to answer that question. */
  requiresReason: boolean;
}

export function canEditFinancialRecord(input: {
  record: FinancialRecord;
  role: Role;
  policy: Awaited<ReturnType<typeof getFinancialEditPolicy>>;
  now?: Date;
  editReason?: string | null;
}): FinancialEditCheck {
  if (input.record.voidedAt) {
    return { allowed: false, reason: "Voided financial records cannot be edited. Create a correction instead.", requiresReason: false };
  }

  const now = input.now ?? new Date();
  const editWindowMs = input.policy.editWindowHours * 60 * 60 * 1000;
  const withinWindow = now.getTime() - input.record.createdAt.getTime() <= editWindowMs;
  const privileged = ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"].includes(input.role);

  if (withinWindow && !input.record.lockedAt) {
    return { allowed: true, reason: "Record is inside the organization edit window.", requiresReason: false };
  }

  if (!privileged) {
    return { allowed: false, reason: "Locked financial records require finance/admin permission.", requiresReason: false };
  }

  if (!input.policy.allowFinanceCorrections) {
    return { allowed: false, reason: "Finance corrections are disabled for this organization.", requiresReason: false };
  }

  if (input.policy.requireReasonForFinancialEdits && !input.editReason?.trim()) {
    return { allowed: false, reason: "An edit reason is required for locked financial records.", requiresReason: true };
  }

  return { allowed: true, reason: "Privileged correction with audit reason.", requiresReason: input.policy.requireReasonForFinancialEdits };
}

export function canVoidFinancialRecord(role: Role) {
  return ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"].includes(role);
}

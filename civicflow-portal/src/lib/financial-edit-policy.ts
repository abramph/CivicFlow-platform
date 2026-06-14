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

export function canEditFinancialRecord(input: {
  record: FinancialRecord;
  role: Role;
  policy: Awaited<ReturnType<typeof getFinancialEditPolicy>>;
  now?: Date;
  editReason?: string | null;
}) {
  if (input.record.voidedAt) {
    return { allowed: false, reason: "Voided financial records cannot be edited. Create a correction instead." };
  }

  const now = input.now ?? new Date();
  const editWindowMs = input.policy.editWindowHours * 60 * 60 * 1000;
  const withinWindow = now.getTime() - input.record.createdAt.getTime() <= editWindowMs;
  const privileged = ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"].includes(input.role);

  if (withinWindow && !input.record.lockedAt) {
    return { allowed: true, reason: "Record is inside the organization edit window." };
  }

  if (!privileged) {
    return { allowed: false, reason: "Locked financial records require finance/admin permission." };
  }

  if (!input.policy.allowFinanceCorrections) {
    return { allowed: false, reason: "Finance corrections are disabled for this organization." };
  }

  if (input.policy.requireReasonForFinancialEdits && !input.editReason?.trim()) {
    return { allowed: false, reason: "An edit reason is required for locked financial records." };
  }

  return { allowed: true, reason: "Privileged correction with audit reason." };
}

export function canVoidFinancialRecord(role: Role) {
  return ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"].includes(role);
}

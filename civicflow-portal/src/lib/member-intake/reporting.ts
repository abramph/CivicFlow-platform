import { prisma } from "@/lib/prisma";
import { MemberIntakeError } from "./errors";

/**
 * Member Intake & Profile Update (MEMBER-QR-I) — reporting and member-profile
 * provenance. Read-only throughout; never mutates a submission or member.
 *
 * addressFieldUpdates/phoneFieldUpdates/emailFieldUpdates are a deliberate
 * approximation, not a forensic diff: they count APPLIED update submissions
 * (matchedMemberId + appliedAt both set) that submitted a non-blank value for
 * a field mapped to that target column, not "the value actually changed"
 * (which would need a permanently stored diff snapshot — a real, useful
 * future enhancement, but a separate schema addition, not built here). Good
 * enough for "roughly how many people touched their address through this
 * form," which is what §29's reporting list actually asks for.
 */

export interface FormStatistics {
  totalSubmissions: number;
  completedSubmissions: number;
  newMembersCreated: number;
  existingMembersUpdated: number;
  needsReview: number;
  possibleDuplicates: number;
  rejected: number;
  verificationRequested: number;
  verificationCompleted: number;
  /** Null when no submission on this form ever required verification. */
  verificationCompletionRate: number | null;
  bySource: { sourceId: string | null; sourceName: string; count: number }[];
  addressFieldUpdates: number;
  phoneFieldUpdates: number;
  emailFieldUpdates: number;
}

export async function getFormStatistics(organizationId: string, formId: string): Promise<FormStatistics> {
  const form = await prisma.memberIntakeForm.findFirst({
    where: { id: formId, organizationId },
    include: { fields: true, sources: true },
  });
  if (!form) throw new MemberIntakeError("MEMBER_INTAKE_FORM_NOT_FOUND", "Form not found.");

  const submissions = await prisma.memberIntakeSubmission.findMany({
    where: { organizationId, formId },
    select: {
      status: true,
      createdMemberId: true,
      matchedMemberId: true,
      appliedAt: true,
      candidateMemberIds: true,
      verificationStatus: true,
      sourceId: true,
      fieldValues: true,
    },
  });

  const fieldKeyToTarget = new Map(form.fields.filter((f) => f.targetField).map((f) => [f.fieldKey, f.targetField as string]));
  const sourceNameById = new Map(form.sources.map((s) => [s.id, s.name]));
  const sourceCounts = new Map<string, number>();

  let completedSubmissions = 0;
  let newMembersCreated = 0;
  let existingMembersUpdated = 0;
  let needsReview = 0;
  let possibleDuplicates = 0;
  let rejected = 0;
  let verificationRequested = 0;
  let verificationCompleted = 0;
  let addressFieldUpdates = 0;
  let phoneFieldUpdates = 0;
  let emailFieldUpdates = 0;

  for (const submission of submissions) {
    if (submission.status === "APPLIED") completedSubmissions++;
    if (submission.createdMemberId) newMembersCreated++;

    const isAppliedUpdate = Boolean(submission.matchedMemberId) && Boolean(submission.appliedAt);
    if (isAppliedUpdate) existingMembersUpdated++;

    if (submission.status === "REVIEW_REQUIRED") {
      needsReview++;
      if (submission.candidateMemberIds.length > 0) possibleDuplicates++;
    }
    if (submission.status === "REJECTED") rejected++;
    if (submission.verificationStatus !== "NOT_REQUIRED") verificationRequested++;
    if (submission.verificationStatus === "VERIFIED") verificationCompleted++;

    if (isAppliedUpdate) {
      const values = submission.fieldValues as Record<string, unknown>;
      for (const [fieldKey, targetField] of fieldKeyToTarget) {
        const value = values[fieldKey];
        if (value === null || value === undefined || value === "") continue;
        if (targetField === "addressLine1") addressFieldUpdates++;
        else if (targetField === "phone") phoneFieldUpdates++;
        else if (targetField === "email") emailFieldUpdates++;
      }
    }

    const sourceKey = submission.sourceId ?? "__none__";
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);
  }

  const bySource = Array.from(sourceCounts.entries())
    .map(([key, count]) => ({
      sourceId: key === "__none__" ? null : key,
      sourceName: key === "__none__" ? "Direct link (no source)" : (sourceNameById.get(key) ?? "Unknown source"),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalSubmissions: submissions.length,
    completedSubmissions,
    newMembersCreated,
    existingMembersUpdated,
    needsReview,
    possibleDuplicates,
    rejected,
    verificationRequested,
    verificationCompleted,
    verificationCompletionRate: verificationRequested > 0 ? verificationCompleted / verificationRequested : null,
    bySource,
    addressFieldUpdates,
    phoneFieldUpdates,
    emailFieldUpdates,
  };
}

export interface MemberIntakeProvenance {
  submissionId: string;
  formName: string;
  appliedAt: Date | null;
  wasNewMember: boolean;
}

/** The most recent Member Intake submission that touched this member's
 * record (either created it or was applied as an update to it) -- powers the
 * §22 "Last updated through Member Update form" profile note. Returns null
 * when this member was never touched by Member Intake, which is the common
 * case and not an error. */
export async function getMemberIntakeProvenance(organizationId: string, memberId: string): Promise<MemberIntakeProvenance | null> {
  const submission = await prisma.memberIntakeSubmission.findFirst({
    where: { organizationId, status: "APPLIED", OR: [{ matchedMemberId: memberId }, { createdMemberId: memberId }] },
    orderBy: { appliedAt: "desc" },
    select: { id: true, appliedAt: true, createdMemberId: true, form: { select: { name: true } } },
  });
  if (!submission) return null;
  return {
    submissionId: submission.id,
    formName: submission.form.name,
    appliedAt: submission.appliedAt,
    wasNewMember: submission.createdMemberId === memberId,
  };
}

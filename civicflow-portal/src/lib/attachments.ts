import type { AttachmentEntityType } from "@prisma/client";
import type { Permission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const attachmentEntityTypes = [
  "ORGANIZATION",
  "ORGANIZATION_DOCUMENT",
  "MEMBER",
  "CAMPAIGN",
  "EVENT",
  "MEETING",
  "COMMUNICATION_CAMPAIGN",
  "RECEIPT",
  "REPORT_EXPORT",
  "REIMBURSEMENT",
  "ORGANIZATION_CONTACT",
  "COMPLIANCE_REQUIREMENT",
  "EXPENDITURE",
  "CONTRIBUTION",
  "PAYMENT_REPORT",
  "HOA_VIOLATION",
  "HOA_ARCHITECTURAL_REQUEST",
  "OTHER",
] as const satisfies readonly AttachmentEntityType[];

export const maxAttachmentBytes = 15 * 1024 * 1024;

const readPermissions: Record<AttachmentEntityType, Permission> = {
  ORGANIZATION: "org_settings:read",
  // PTA-D Document Center — the org-owned document repository (entityId is
  // the organizationId; `purpose` is the folder/category slug).
  ORGANIZATION_DOCUMENT: "documents:read",
  MEMBER: "members:read",
  CAMPAIGN: "campaigns:read",
  EVENT: "events:read",
  MEETING: "meetings:read",
  COMMUNICATION_CAMPAIGN: "communications:read",
  RECEIPT: "receipts:read",
  REPORT_EXPORT: "reports:read",
  // PTA-H: receipts on a reimbursement request. Submit-level on purpose —
  // the submitting officer must be able to attach and re-open their own
  // receipts; reimbursement receipts are ordinary org financial records,
  // not confidential documents.
  REIMBURSEMENT: "reimbursements:submit",
  ORGANIZATION_CONTACT: "contacts:read",
  COMPLIANCE_REQUIREMENT: "pta:board:view",
  EXPENDITURE: "expenditures:read",
  CONTRIBUTION: "contributions:read",
  PAYMENT_REPORT: "dues:read",
  HOA_VIOLATION: "hoa:violations:read",
  // Officer/staff path only -- gates the shared RBAC-based attachment API.
  // A resident's own read access to their own submission's resident-visible
  // attachments does NOT go through this at all; it goes through a
  // dedicated resident-scoped route (mirroring how Violations' resident
  // path bypasses attachmentPermission()/RBAC entirely), which additionally
  // filters by the attachment's `purpose` classification -- see
  // docs/hoa-architectural-requests.md's attachment-visibility section.
  HOA_ARCHITECTURAL_REQUEST: "hoa:architectural-requests:read",
  OTHER: "org_settings:read",
};

const writePermissions: Record<AttachmentEntityType, Permission> = {
  ORGANIZATION: "org_settings:write",
  ORGANIZATION_DOCUMENT: "documents:write",
  MEMBER: "members:write",
  CAMPAIGN: "campaigns:write",
  EVENT: "events:write",
  MEETING: "meetings:write",
  COMMUNICATION_CAMPAIGN: "communications:write",
  RECEIPT: "receipts:write",
  REPORT_EXPORT: "reports:export",
  REIMBURSEMENT: "reimbursements:submit",
  ORGANIZATION_CONTACT: "contacts:write",
  COMPLIANCE_REQUIREMENT: "pta:board:manage",
  EXPENDITURE: "expenditures:write",
  CONTRIBUTION: "contributions:write",
  PAYMENT_REPORT: "dues:write",
  HOA_VIOLATION: "hoa:violations:write",
  HOA_ARCHITECTURAL_REQUEST: "hoa:architectural-requests:write",
  OTHER: "org_settings:write",
};

export function isAttachmentEntityType(value: string | null | undefined): value is AttachmentEntityType {
  return attachmentEntityTypes.includes(value as AttachmentEntityType);
}

export function attachmentPermission(entityType: AttachmentEntityType, mode: "read" | "write") {
  return mode === "read" ? readPermissions[entityType] : writePermissions[entityType];
}

export async function verifyAttachmentEntity(organizationId: string, entityType: AttachmentEntityType, entityId: string) {
  if (!entityId) return false;
  switch (entityType) {
    case "ORGANIZATION":
    case "ORGANIZATION_DOCUMENT":
      return entityId === organizationId && Boolean(await prisma.organization.findFirst({ where: { id: organizationId }, select: { id: true } }));
    case "MEMBER":
      return Boolean(await prisma.orgMember.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "CAMPAIGN":
      return Boolean(await prisma.campaign.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "EVENT":
      return Boolean(await prisma.event.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "MEETING":
      return Boolean(await prisma.meeting.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "COMMUNICATION_CAMPAIGN":
      return Boolean(await prisma.communicationCampaign.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "RECEIPT":
      return Boolean(await prisma.contributionReceipt.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "REPORT_EXPORT":
      return Boolean(await prisma.reportExport.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "EXPENDITURE":
      return Boolean(await prisma.expenditure.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "REIMBURSEMENT":
      return Boolean(await prisma.reimbursementRequest.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "ORGANIZATION_CONTACT":
      return Boolean(await prisma.organizationContact.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "COMPLIANCE_REQUIREMENT":
      return Boolean(await prisma.ptaComplianceRequirement.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "CONTRIBUTION":
      return Boolean(await prisma.contribution.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "PAYMENT_REPORT":
      return Boolean(await prisma.paymentReport.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "HOA_VIOLATION":
      return Boolean(await prisma.violation.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "HOA_ARCHITECTURAL_REQUEST":
      return Boolean(await prisma.architecturalRequest.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "OTHER":
      return true;
    default:
      return false;
  }
}

export function attachmentPrefix(organizationId: string, entityType: AttachmentEntityType, entityId: string) {
  return `attachments/${organizationId}/${entityType.toLowerCase()}/${entityId}`;
}

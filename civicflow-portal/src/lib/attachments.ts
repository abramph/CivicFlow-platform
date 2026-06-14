import type { AttachmentEntityType } from "@prisma/client";
import type { Permission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const attachmentEntityTypes = [
  "ORGANIZATION",
  "MEMBER",
  "CAMPAIGN",
  "EVENT",
  "MEETING",
  "COMMUNICATION_CAMPAIGN",
  "RECEIPT",
  "REPORT_EXPORT",
  "EXPENDITURE",
  "CONTRIBUTION",
  "OTHER",
] as const satisfies readonly AttachmentEntityType[];

export const maxAttachmentBytes = 15 * 1024 * 1024;

const readPermissions: Record<AttachmentEntityType, Permission> = {
  ORGANIZATION: "org_settings:read",
  MEMBER: "members:read",
  CAMPAIGN: "campaigns:read",
  EVENT: "events:read",
  MEETING: "meetings:read",
  COMMUNICATION_CAMPAIGN: "communications:read",
  RECEIPT: "receipts:read",
  REPORT_EXPORT: "reports:read",
  EXPENDITURE: "expenditures:read",
  CONTRIBUTION: "contributions:read",
  OTHER: "org_settings:read",
};

const writePermissions: Record<AttachmentEntityType, Permission> = {
  ORGANIZATION: "org_settings:write",
  MEMBER: "members:write",
  CAMPAIGN: "campaigns:write",
  EVENT: "events:write",
  MEETING: "meetings:write",
  COMMUNICATION_CAMPAIGN: "communications:write",
  RECEIPT: "receipts:write",
  REPORT_EXPORT: "reports:export",
  EXPENDITURE: "expenditures:write",
  CONTRIBUTION: "contributions:write",
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
    case "CONTRIBUTION":
      return Boolean(await prisma.contribution.findFirst({ where: { id: entityId, organizationId }, select: { id: true } }));
    case "OTHER":
      return true;
    default:
      return false;
  }
}

export function attachmentPrefix(organizationId: string, entityType: AttachmentEntityType, entityId: string) {
  return `attachments/${organizationId}/${entityType.toLowerCase()}/${entityId}`;
}

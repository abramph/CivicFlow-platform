import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance-errors";

/**
 * PTA Vertical 2.0, PR PTA-I — institutional contact directory & vendor
 * history (core; brief §23–§24). The directory belongs to the ORGANIZATION,
 * not an outgoing officer. Vendor spend/event history is computed from the
 * expenditure ledger by case-insensitive name match — "historical spend
 * where available" with zero double entry (paid reimbursements flow in
 * automatically because PTA-H books them as Expenditures).
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

export interface UpsertContactInput extends ActorInput {
  organizationId: string;
  contactId?: string;
  name?: string;
  contactPerson?: string | null;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  category?: string | null;
  notes?: string | null;
  isVendor?: boolean;
  rating?: number | null;
  isActive?: boolean;
  markReviewed?: boolean;
}

function validateRating(rating: number | null | undefined) {
  if (rating !== undefined && rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new FinanceError("Rating must be a whole number from 1 to 5.");
  }
}

export async function listContacts(organizationId: string, options: { includeInactive?: boolean } = {}) {
  return prisma.organizationContact.findMany({
    where: { organizationId, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isVendor: "asc" }, { category: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });
}

/** §24 vendor history: spend + events computed from non-void Expenditures
 * whose vendor matches the contact name (case-insensitive). */
export async function getVendorHistory(organizationId: string, contactId: string) {
  const contact = await prisma.organizationContact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) throw new FinanceError("Contact not found.", 404);

  const expenditures = await prisma.expenditure.findMany({
    where: { organizationId, voidedAt: null, vendor: { equals: contact.name, mode: "insensitive" } },
    orderBy: { date: "desc" },
    take: 100,
    select: { id: true, date: true, amount: true, description: true, event: { select: { id: true, title: true } } },
  });

  const totalSpend = expenditures.reduce((sum, row) => sum + Number(row.amount), 0);
  const events = [...new Map(expenditures.filter((row) => row.event).map((row) => [row.event!.id, row.event!.title])).values()];

  return {
    contact,
    totalSpend,
    expenditureCount: expenditures.length,
    events,
    recent: expenditures.slice(0, 20).map((row) => ({
      id: row.id,
      date: row.date,
      amount: Number(row.amount),
      description: row.description,
      eventTitle: row.event?.title ?? null,
    })),
  };
}

export async function createContact(input: UpsertContactInput) {
  const name = input.name?.trim();
  if (!name) throw new FinanceError("Contact name is required.");
  validateRating(input.rating);
  const existing = await prisma.organizationContact.findFirst({ where: { organizationId: input.organizationId, name } });
  if (existing) throw new FinanceError(`"${name}" is already in the directory.`, 409);

  const contact = await prisma.organizationContact.create({
    data: {
      organizationId: input.organizationId,
      name,
      contactPerson: input.contactPerson?.trim() || null,
      role: input.role?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      website: input.website?.trim() || null,
      category: input.category?.trim() || null,
      notes: input.notes?.trim() || null,
      isVendor: input.isVendor ?? false,
      rating: input.rating ?? null,
      lastReviewedAt: new Date(),
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "contacts.created",
    entityType: "organization_contact",
    entityId: contact.id,
    metadata: { name, isVendor: contact.isVendor },
  });
  return contact;
}

export async function updateContact(input: UpsertContactInput & { contactId: string }) {
  const existing = await prisma.organizationContact.findFirst({ where: { id: input.contactId, organizationId: input.organizationId } });
  if (!existing) throw new FinanceError("Contact not found.", 404);
  validateRating(input.rating);

  const contact = await prisma.organizationContact.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.contactPerson !== undefined ? { contactPerson: input.contactPerson?.trim() || null } : {}),
      ...(input.role !== undefined ? { role: input.role?.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
      ...(input.website !== undefined ? { website: input.website?.trim() || null } : {}),
      ...(input.category !== undefined ? { category: input.category?.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.isVendor !== undefined ? { isVendor: input.isVendor } : {}),
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.markReviewed ? { lastReviewedAt: new Date() } : {}),
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "contacts.updated",
    entityType: "organization_contact",
    entityId: contact.id,
    metadata: { name: contact.name },
  });
  return contact;
}

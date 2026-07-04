import { prisma } from "@/lib/prisma";
import type { AttendanceStatus, MembershipStatus } from "@prisma/client";

// ---- Desktop export shape ----

export interface DesktopMember {
  id: number;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  status?: string | null;
  join_date?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  dob?: string | null;
  category_id?: number | null;
}

export interface DesktopCategory {
  id: number;
  name: string;
  monthly_dues_cents?: number | null;
}

export interface DesktopEvent {
  id: number;
  name: string;
  date?: string | null;
  location?: string | null;
  notes?: string | null;
}

export interface DesktopCampaign {
  id: number;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  goal_amount_cents?: number | null;
  notes?: string | null;
}

export interface DesktopMeeting {
  id: number;
  title: string;
  meeting_date: string;
}

export interface DesktopAttendance {
  id?: number;
  member_id: number;
  meeting_id: number;
  attended: number | boolean;
}

export interface DesktopTransaction {
  id: number;
  type: string;
  amount_cents: number;
  occurred_on: string;
  member_id?: number | null;
  campaign_id?: number | null;
  event_id?: number | null;
  note?: string | null;
  contributor_name?: string | null;
  is_deleted?: number | boolean | null;
}

/** Newer financial ledger table (migration 016+). amount is in dollars. */
export interface DesktopFinancialTransaction {
  id: number;
  member_id?: number | null;
  membership_period_id?: number | null;
  txn_type: string; // DUES | CONTRIBUTION | INVOICE | RECEIPT | ADJUSTMENT | REVERSAL
  amount: number;   // dollars
  txn_date: string;
  reference?: string | null;
  notes?: string | null;
  campaign_id?: number | null;
  event_id?: number | null;
}

export interface DesktopExpenditure {
  id: number;
  date: string;
  amount: number;
  category?: string | null;
  description: string;
  payment_method?: string | null;
}

export interface DesktopExport {
  version: number;
  schema: string;
  exportedAt: string;
  organizationName?: string | null;
  members: DesktopMember[];
  categories: DesktopCategory[];
  events: DesktopEvent[];
  campaigns: DesktopCampaign[];
  meetings: DesktopMeeting[];
  attendance: DesktopAttendance[];
  transactions: DesktopTransaction[];
  financialTransactions?: DesktopFinancialTransaction[];
  expenditures: DesktopExpenditure[];
}

// ---- Result ----

export interface ImportCounts {
  categories: number;
  members: number;
  events: number;
  campaigns: number;
  meetings: number;
  attendance: number;
  contributions: number;
  expenditures: number;
}

// ---- Helpers ----

function toDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const VALID_MEMBER_STATUSES = new Set<string>([
  "active",
  "inactive",
  "deactivated",
  "pending",
  "retired",
  "suspended",
  "terminated",
]);

function mapMemberStatus(status?: string | null): MembershipStatus {
  const s = String(status ?? "active").toLowerCase().trim();
  return VALID_MEMBER_STATUSES.has(s) ? (s as MembershipStatus) : "active";
}

// ---- Main import ----

export async function runMigrationImport(
  organizationId: string,
  data: DesktopExport
): Promise<ImportCounts> {
  const counts: ImportCounts = {
    categories: 0,
    members: 0,
    events: 0,
    campaigns: 0,
    meetings: 0,
    attendance: 0,
    contributions: 0,
    expenditures: 0,
  };

  // Maps from desktop integer id → new portal cuid
  const categoryMap = new Map<number, string>();
  const memberMap = new Map<number, string>();
  const eventMap = new Map<number, string>();
  const campaignMap = new Map<number, string>();
  const meetingMap = new Map<number, string>();

  // 1. Categories — upsert by (org, name, type) so re-imports are safe
  for (const cat of data.categories ?? []) {
    if (!cat.name?.trim()) continue;
    const existing = await prisma.category.findFirst({
      where: { organizationId, name: cat.name.trim(), type: "MEMBERSHIP" },
      select: { id: true },
    });
    if (existing) {
      categoryMap.set(cat.id, existing.id);
    } else {
      const created = await prisma.category.create({
        data: {
          organizationId,
          name: cat.name.trim(),
          type: "MEMBERSHIP",
          amountDefault:
            cat.monthly_dues_cents && cat.monthly_dues_cents > 0
              ? cat.monthly_dues_cents / 100
              : null,
        },
        select: { id: true },
      });
      categoryMap.set(cat.id, created.id);
      counts.categories++;
    }
  }

  // 2. Members — upsert by email within org to prevent duplicates on re-import
  for (const m of data.members ?? []) {
    if (!m.first_name && !m.last_name) continue;

    const email = m.email?.trim().toLowerCase() || null;
    const existing = email
      ? await prisma.orgMember.findFirst({
          where: { organizationId, email },
          select: { id: true },
        })
      : null;

    if (existing) {
      memberMap.set(m.id, existing.id);
    } else {
      const created = await prisma.orgMember.create({
        data: {
          organizationId,
          firstName: m.first_name ?? "",
          lastName: m.last_name ?? "",
          email: email || null,
          phone: m.phone ?? null,
          addressLine1: m.address ?? null,
          membershipStatus: mapMemberStatus(m.status),
          joinDate: toDate(m.join_date),
          dateOfBirth: toDate(m.dob),
          city: m.city ?? null,
          state: m.state ?? null,
          zipCode: m.zip ?? null,
          membershipCategoryId:
            m.category_id != null ? (categoryMap.get(m.category_id) ?? null) : null,
        },
        select: { id: true },
      });
      memberMap.set(m.id, created.id);
      counts.members++;
    }
  }

  // 3. Events — upsert by (org, title, startAt date) to prevent duplicates
  for (const e of data.events ?? []) {
    if (!e.name?.trim()) continue;
    const startAt = toDate(e.date);
    const existing = await prisma.event.findFirst({
      where: {
        organizationId,
        title: e.name.trim(),
        ...(startAt ? { startAt } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      eventMap.set(e.id, existing.id);
    } else {
      const created = await prisma.event.create({
        data: {
          organizationId,
          title: e.name.trim(),
          startAt,
          location: e.location ?? null,
          notes: e.notes ?? null,
          status: "completed",
        },
        select: { id: true },
      });
      eventMap.set(e.id, created.id);
      counts.events++;
    }
  }

  // 4. Campaigns — upsert by (org, name)
  for (const c of data.campaigns ?? []) {
    if (!c.name?.trim()) continue;
    const existing = await prisma.campaign.findFirst({
      where: { organizationId, name: c.name.trim() },
      select: { id: true },
    });
    if (existing) {
      campaignMap.set(c.id, existing.id);
    } else {
      const created = await prisma.campaign.create({
        data: {
          organizationId,
          name: c.name.trim(),
          startDate: toDate(c.start_date),
          endDate: toDate(c.end_date),
          goal:
            c.goal_amount_cents && c.goal_amount_cents > 0
              ? c.goal_amount_cents / 100
              : null,
          notes: c.notes ?? null,
          status: "active",
        },
        select: { id: true },
      });
      campaignMap.set(c.id, created.id);
      counts.campaigns++;
    }
  }

  // 5. Meetings — upsert by (org, title, meetingDate)
  for (const m of data.meetings ?? []) {
    const meetingDate = toDate(m.meeting_date);
    if (!meetingDate || !m.title?.trim()) continue;
    const existing = await prisma.meeting.findFirst({
      where: { organizationId, title: m.title.trim(), meetingDate },
      select: { id: true },
    });
    if (existing) {
      meetingMap.set(m.id, existing.id);
    } else {
      const created = await prisma.meeting.create({
        data: {
          organizationId,
          title: m.title.trim(),
          meetingDate,
        },
        select: { id: true },
      });
      meetingMap.set(m.id, created.id);
      counts.meetings++;
    }
  }

  // 6. Attendance — skip if member or meeting wasn't imported
  for (const a of data.attendance ?? []) {
    const memberId = memberMap.get(a.member_id);
    const meetingId = meetingMap.get(a.meeting_id);
    if (!memberId || !meetingId) continue;

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { meetingDate: true },
    });
    if (!meeting) continue;

    // Skip duplicate attendance records
    const existingAttendance = await prisma.attendanceRecord.findFirst({
      where: { memberId, meetingId },
      select: { id: true },
    });
    if (existingAttendance) continue;

    const status: AttendanceStatus = a.attended ? "PRESENT" : "ABSENT";
    await prisma.attendanceRecord.create({
      data: {
        organizationId,
        memberId,
        meetingId,
        meetingDate: meeting.meetingDate,
        attendanceStatus: status,
      },
    });
    counts.attendance++;
  }

  // 7. Contributions — from legacy transactions table
  //    Includes dues, dues_payment, donation, contribution types (all represent money received).
  //    Expense type is excluded — those come from the expenditures table instead.
  for (const t of data.transactions ?? []) {
    const type = String(t.type ?? "").toLowerCase().trim();
    const isExpense = type === "expense";
    const isDeleted = t.is_deleted === 1 || t.is_deleted === true;
    if (isExpense || isDeleted) continue;

    const amount = (t.amount_cents ?? 0) / 100;
    if (amount <= 0) continue;
    const contributionDate = toDate(t.occurred_on);
    if (!contributionDate) continue;

    const noteBase = type === "dues" || type === "dues_payment" ? "Dues payment" : null;
    const note = [noteBase, t.note].filter(Boolean).join(" — ") || null;

    await prisma.contribution.create({
      data: {
        organizationId,
        amount,
        contributionDate,
        memberId: t.member_id != null ? (memberMap.get(t.member_id) ?? null) : null,
        campaignId: t.campaign_id != null ? (campaignMap.get(t.campaign_id) ?? null) : null,
        eventId: t.event_id != null ? (eventMap.get(t.event_id) ?? null) : null,
        notes: note,
        source: "IMPORT",
      },
    });
    counts.contributions++;
  }

  // 7b. Financial transactions ledger (newer desktop schema, migration 016+).
  //     Import RECEIPT and CONTRIBUTION records not already covered by the legacy table.
  //     DUES/INVOICE = charges (not payments), ADJUSTMENT/REVERSAL = skip.
  const LEDGER_INCOME_TYPES = new Set(["receipt", "contribution"]);
  for (const t of data.financialTransactions ?? []) {
    const txnType = String(t.txn_type ?? "").toLowerCase().trim();
    if (!LEDGER_INCOME_TYPES.has(txnType)) continue;

    const amount = Number(t.amount);
    if (!isFinite(amount) || amount <= 0) continue;
    const contributionDate = toDate(t.txn_date);
    if (!contributionDate) continue;

    const noteBase = txnType === "receipt" ? "Dues payment (ledger)" : null;
    const note = [noteBase, t.notes].filter(Boolean).join(" — ") || null;

    await prisma.contribution.create({
      data: {
        organizationId,
        amount,
        contributionDate,
        memberId: t.member_id != null ? (memberMap.get(t.member_id) ?? null) : null,
        campaignId: t.campaign_id != null ? (campaignMap.get(t.campaign_id) ?? null) : null,
        eventId: t.event_id != null ? (eventMap.get(t.event_id) ?? null) : null,
        notes: note,
        source: "IMPORT",
      },
    });
    counts.contributions++;
  }

  // 8. Expenditures
  for (const e of data.expenditures ?? []) {
    const date = toDate(e.date);
    if (!date || !e.description?.trim()) continue;
    const amount = Number(e.amount);
    if (!isFinite(amount) || amount <= 0) continue;

    await prisma.expenditure.create({
      data: {
        organizationId,
        description: e.description.trim(),
        amount,
        date,
        category: e.category ?? null,
        paymentMethod: e.payment_method ?? null,
      },
    });
    counts.expenditures++;
  }

  // 9. Dues accrual floor — this import brings in payment history as
  //    Contribution records (see step 7/7b), not a per-member DuesCharge
  //    ledger, so the org has no historical charge data. Without this,
  //    "Generate Dues" would retroactively bill every member back to their
  //    original join date, since none of their real desktop payments are
  //    linked to a cloud charge. Set the floor to "now" so charges are only
  //    ever generated for periods going forward from the migration itself.
  await prisma.orgSettings.upsert({
    where: { organizationId },
    update: { duesAccrualNotBeforeDate: new Date() },
    create: { organizationId, duesAccrualNotBeforeDate: new Date() },
  });

  return counts;
}

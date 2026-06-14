import { prisma } from "@/lib/prisma";
import type { AttendanceStatus, MembershipStatus } from "@prisma/client";

// ---- Desktop export shape ----

export interface DesktopMember {
  id: number;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
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

  // 2. Members
  for (const m of data.members ?? []) {
    if (!m.first_name && !m.last_name) continue;
    const created = await prisma.orgMember.create({
      data: {
        organizationId,
        firstName: m.first_name ?? "",
        lastName: m.last_name ?? "",
        email: m.email ?? null,
        phone: m.phone ?? null,
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

  // 3. Events
  for (const e of data.events ?? []) {
    if (!e.name?.trim()) continue;
    const created = await prisma.event.create({
      data: {
        organizationId,
        title: e.name.trim(),
        startAt: toDate(e.date),
        location: e.location ?? null,
        notes: e.notes ?? null,
        status: "completed",
      },
      select: { id: true },
    });
    eventMap.set(e.id, created.id);
    counts.events++;
  }

  // 4. Campaigns
  for (const c of data.campaigns ?? []) {
    if (!c.name?.trim()) continue;
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

  // 5. Meetings
  for (const m of data.meetings ?? []) {
    const meetingDate = toDate(m.meeting_date);
    if (!meetingDate || !m.title?.trim()) continue;
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

  // 6. Attendance
  for (const a of data.attendance ?? []) {
    const memberId = memberMap.get(a.member_id);
    const meetingId = meetingMap.get(a.meeting_id);
    if (!memberId || !meetingId) continue;

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { meetingDate: true },
    });
    if (!meeting) continue;

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

  // 7. Contributions — desktop type 'donation' or 'CONTRIBUTION'
  for (const t of data.transactions ?? []) {
    const type = String(t.type ?? "").toLowerCase();
    if (type !== "donation" && type !== "contribution") continue;
    if (t.is_deleted) continue;

    const amount = (t.amount_cents ?? 0) / 100;
    if (amount <= 0) continue;
    const contributionDate = toDate(t.occurred_on);
    if (!contributionDate) continue;

    await prisma.contribution.create({
      data: {
        organizationId,
        amount,
        contributionDate,
        memberId: t.member_id != null ? (memberMap.get(t.member_id) ?? null) : null,
        campaignId: t.campaign_id != null ? (campaignMap.get(t.campaign_id) ?? null) : null,
        eventId: t.event_id != null ? (eventMap.get(t.event_id) ?? null) : null,
        notes: t.note ?? null,
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

  return counts;
}

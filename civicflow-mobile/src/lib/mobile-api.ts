import { apiFetch } from '@/lib/api-client';

export interface DuesCharge {
  id: string;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'WAIVED' | 'VOID';
  duesAccount: { name: string };
}

export interface DuesSummary {
  outstandingBalance: number;
  isDelinquent: boolean;
  delinquentSince: string | null;
  charges: DuesCharge[];
}

export function getDues(organizationId: string) {
  return apiFetch<DuesSummary>(`/api/mobile/dues?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface DuesPaymentRow {
  id: string;
  amount: string;
  paymentDate: string;
  method: string;
}

export interface PaymentReportRow {
  id: string;
  amount: string;
  paymentDate: string;
  paymentMethod: string;
  category: PaymentReportCategory;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  createdAt: string;
}

export function getPaymentHistory(organizationId: string) {
  return apiFetch<{ payments: DuesPaymentRow[]; reports: PaymentReportRow[] }>(
    `/api/mobile/payment-history?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export type PaymentReportCategory =
  | 'MEMBERSHIP_DUES'
  | 'EVENT_REGISTRATION'
  | 'DONATION'
  | 'FUNDRAISER'
  | 'MERCHANDISE'
  | 'SPONSORSHIP'
  | 'ASSESSMENT'
  | 'OTHER';

export interface ReportPaymentInput {
  organizationId: string;
  amount: string;
  category: PaymentReportCategory;
  duesChargeId?: string;
  paymentMethod: string;
  paymentDate: string;
  referenceNumber?: string;
  note?: string;
  receipt?: { uri: string; name: string; type: string } | null;
}

export function submitPaymentReport(input: ReportPaymentInput) {
  const form = new FormData();
  form.append('organizationId', input.organizationId);
  form.append('amount', input.amount);
  form.append('category', input.category);
  if (input.duesChargeId) form.append('duesChargeId', input.duesChargeId);
  form.append('paymentMethod', input.paymentMethod);
  form.append('paymentDate', input.paymentDate);
  if (input.referenceNumber) form.append('referenceNumber', input.referenceNumber);
  if (input.note) form.append('note', input.note);
  if (input.receipt) {
    // React Native's FormData accepts { uri, name, type } file parts.
    form.append('receipt', input.receipt as unknown as Blob);
  }

  return apiFetch(`/api/mobile/report-payment`, { method: 'POST', body: form });
}

export interface Announcement {
  id: string;
  title: string;
  subject: string;
  body: string;
  deepLink: string | null;
  sentAt: string | null;
  isRead: boolean;
}

export function getAnnouncements(organizationId: string) {
  return apiFetch<Announcement[]>(`/api/mobile/announcements?organizationId=${encodeURIComponent(organizationId)}`);
}

export function markAnnouncementRead(organizationId: string, campaignId: string) {
  return apiFetch<void>(`/api/mobile/announcements/${encodeURIComponent(campaignId)}/read`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export interface MobileEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  status: string;
}

export function getEvents(organizationId: string) {
  return apiFetch<MobileEvent[]>(`/api/mobile/events?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface ConversationParticipant {
  userId: string;
  displayName: string;
  role: string;
}

export interface ConversationSummary {
  id: string;
  subject: string | null;
  lastMessageAt: string | null;
  hasUnread: boolean;
  otherParticipants: ConversationParticipant[];
}

export function getConversations(organizationId: string) {
  return apiFetch<ConversationSummary[]>(
    `/api/mobile/messages/conversations?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export interface ConversationMessage {
  id: string;
  body: string;
  senderUserId: string;
  senderDisplayName: string;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  subject: string | null;
  participants: ConversationParticipant[];
  messages: ConversationMessage[];
}

export function getConversation(organizationId: string, conversationId: string) {
  return apiFetch<ConversationDetail>(
    `/api/mobile/messages/conversations/${encodeURIComponent(conversationId)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export function sendConversationMessage(organizationId: string, conversationId: string, body: string) {
  return apiFetch<{ id: string; createdAt: string }>(
    `/api/mobile/messages/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', body: JSON.stringify({ organizationId, body }) }
  );
}

export interface MobileProfile {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  commsPushEnabled: boolean;
  commsEmailEnabled: boolean;
  commsSmsEnabled: boolean;
  smsOptedOutAt: string | null;
}

export function getProfile(organizationId: string) {
  return apiFetch<MobileProfile>(`/api/mobile/profile?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface UpdateProfileInput {
  commsPushEnabled?: boolean;
  commsEmailEnabled?: boolean;
  commsSmsEnabled?: boolean;
}

export function updateProfile(organizationId: string, input: UpdateProfileInput) {
  return apiFetch<Pick<MobileProfile, 'commsPushEnabled' | 'commsEmailEnabled' | 'commsSmsEnabled' | 'smsOptedOutAt'>>(
    `/api/mobile/profile`,
    { method: 'PATCH', body: JSON.stringify({ organizationId, ...input }) }
  );
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  goal: string | null;
  endDate: string | null;
}

export function getCampaigns(organizationId: string) {
  return apiFetch<Campaign[]>(`/api/mobile/campaigns?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface PayableMethod {
  id: string;
  label: string;
  method: string;
  accountIdentifier: string | null;
  instructions: string | null;
}

export function getPaymentMethods(organizationId: string) {
  return apiFetch<PayableMethod[]>(`/api/mobile/payment-methods?organizationId=${encodeURIComponent(organizationId)}`);
}

export type PaymentLinkTarget = { campaignId: string } | { eventId: string } | { dues: true };

export function getPaymentLinkSlug(organizationId: string, target: PaymentLinkTarget) {
  const params = new URLSearchParams({ organizationId });
  if ('campaignId' in target) params.set('campaignId', target.campaignId);
  else if ('eventId' in target) params.set('eventId', target.eventId);
  else params.set('dues', 'true');

  return apiFetch<{ slug: string | null }>(`/api/mobile/payment-link?${params.toString()}`);
}

export interface AttendanceCheckInResult {
  alreadyCheckedIn: boolean;
  attendanceRecordId: string;
  attendanceStatus: 'PRESENT' | 'LATE';
  checkInTime: string;
  meetingTitle: string;
  meetingDate: string;
  organizationId: string;
}

/**
 * organizationId is deliberately not sent — the server derives it from the
 * scanned token's own attendance session, so a member with memberships in
 * several organizations always checks in under whichever org the meeting
 * actually belongs to, never whatever org happens to be selected in the app.
 */
export function checkInWithQrToken(qrToken: string) {
  return apiFetch<AttendanceCheckInResult>('/api/mobile/attendance/check-in', {
    method: 'POST',
    body: JSON.stringify({ qrToken }),
  });
}

export interface AttendanceHistoryRow {
  id: string;
  meetingId: string | null;
  meetingTitle: string | null;
  meetingDate: string;
  attendanceStatus: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE' | 'VIRTUAL';
  checkInTime: string | null;
  method: string;
}

export function getAttendanceHistory(organizationId: string) {
  return apiFetch<AttendanceHistoryRow[]>(`/api/mobile/attendance/history?organizationId=${encodeURIComponent(organizationId)}`);
}

// ── PTA volunteers (parent + limited officer workflow) ──────────────────────
// Backed by /api/mobile/pta/*, a bearer-token bridge over the same
// concurrency-safe, audited library functions the web PTA vertical uses
// (src/lib/labs/pta/volunteers.ts in civicflow-portal) — no business logic
// is duplicated here. A 403 from any of these means either the org isn't
// enrolled in PTA Labs, or (for the parent-side calls) the signed-in user
// has no linked household-adult record in this organization — both are
// normal, expected states, not errors to alert on; see hooks/use-pta-access.

export interface PtaProfileSummary {
  schoolOrPtaName: string;
  designation: string;
  currentSchoolYear: string;
}

export function getPtaProfile(organizationId: string) {
  return apiFetch<PtaProfileSummary>(`/api/mobile/pta/profile?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface PtaVolunteerSlotSummary {
  id: string;
  label: string | null;
  startAt: string | null;
  endAt: string | null;
  locationOverride: string | null;
  capacity: number;
  claimedCount: number;
  full: boolean;
  alreadySignedUp: boolean;
}

export interface PtaVolunteerOpportunitySummary {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  signupDeadline: string | null;
  cancellationDeadline: string | null;
  slots: PtaVolunteerSlotSummary[];
}

export function getPtaVolunteerOpportunities(organizationId: string) {
  return apiFetch<PtaVolunteerOpportunitySummary[]>(
    `/api/mobile/pta/volunteers/opportunities?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export interface PtaVolunteerOpportunityDetail {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: string;
  committee: string | null;
  signupDeadline: string | null;
  cancellationDeadline: string | null;
  slots: {
    id: string;
    label: string | null;
    startAt: string | null;
    endAt: string | null;
    locationOverride: string | null;
    capacity: number;
    claimedCount: number;
    full: boolean;
    mySignup: { id: string; status: string } | null;
  }[];
}

export function getPtaVolunteerOpportunity(organizationId: string, opportunityId: string) {
  return apiFetch<PtaVolunteerOpportunityDetail>(
    `/api/mobile/pta/volunteers/opportunities/${encodeURIComponent(opportunityId)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export function claimPtaVolunteerSlot(organizationId: string, slotId: string) {
  return apiFetch(`/api/mobile/pta/volunteers/slots/${encodeURIComponent(slotId)}/claim`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export function cancelPtaVolunteerSlot(organizationId: string, slotId: string, reason?: string) {
  return apiFetch(`/api/mobile/pta/volunteers/slots/${encodeURIComponent(slotId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, reason: reason ?? null }),
  });
}

export interface PtaVolunteerCommitment {
  id: string;
  status: string;
  updatedAt: string;
  opportunityTitle: string;
  slotLabel: string | null;
  startAt: string | null;
  endAt: string | null;
}

export function getPtaVolunteerCommitments(organizationId: string) {
  return apiFetch<PtaVolunteerCommitment[]>(
    `/api/mobile/pta/volunteers/my-commitments?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export interface PtaVolunteerHours {
  schoolYear: string | null;
  approvedMinutes: number;
  pendingMinutes: number;
  /** null means this PTA doesn't track a required amount — render as "not required", never as a 0-hour goal. */
  requiredMinutes: number | null;
  remainingMinutes: number | null;
}

export function getPtaVolunteerHours(organizationId: string) {
  return apiFetch<PtaVolunteerHours>(`/api/mobile/pta/volunteers/hours?organizationId=${encodeURIComponent(organizationId)}`);
}

// ── PTA volunteers — limited officer (Volunteer Coordinator) workflow ───────

export interface PtaVolunteerTodaySummary {
  opportunities: { id: string; title: string; slotCount: number; claimedCount: number; capacity: number }[];
  understaffedShiftCount: number;
  pendingHourApprovalCount: number;
}

export function getPtaVolunteerToday(organizationId: string) {
  return apiFetch<PtaVolunteerTodaySummary>(`/api/mobile/pta/volunteers/today?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface PtaVolunteerRosterSignup {
  signupId: string;
  name: string;
  status: string;
  manuallyAssigned: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  attendanceStatus: string | null;
  pendingHourEntry: { id: string; creditedMinutes: number } | null;
}

export interface PtaVolunteerRoster {
  id: string;
  title: string;
  status: string;
  slots: {
    id: string;
    label: string | null;
    startAt: string | null;
    endAt: string | null;
    capacity: number;
    claimedCount: number;
    signups: PtaVolunteerRosterSignup[];
  }[];
}

export function getPtaVolunteerRoster(organizationId: string, opportunityId: string) {
  return apiFetch<PtaVolunteerRoster>(
    `/api/mobile/pta/volunteers/opportunities/${encodeURIComponent(opportunityId)}/roster?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export function checkInPtaVolunteer(organizationId: string, signupId: string) {
  return apiFetch(`/api/mobile/pta/volunteers/signups/${encodeURIComponent(signupId)}/checkin`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export function checkOutPtaVolunteer(organizationId: string, signupId: string) {
  return apiFetch(`/api/mobile/pta/volunteers/signups/${encodeURIComponent(signupId)}/checkout`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export function setPtaVolunteerAttendance(
  organizationId: string,
  signupId: string,
  status: 'ATTENDED' | 'PARTIAL' | 'NO_SHOW' | 'EXCUSED',
  manualMinutes?: number | null
) {
  return apiFetch(`/api/mobile/pta/volunteers/signups/${encodeURIComponent(signupId)}/attendance`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, status, manualMinutes: manualMinutes ?? null }),
  });
}

export interface PendingPtaHourEntry {
  id: string;
  creditedMinutes: number;
  source: string;
  submittedAt: string;
  volunteerName: string;
  opportunityTitle: string;
}

export function getPendingPtaHourEntries(organizationId: string) {
  return apiFetch<PendingPtaHourEntry[]>(`/api/mobile/pta/volunteers/hour-entries/pending?organizationId=${encodeURIComponent(organizationId)}`);
}

export function approvePtaHourEntry(organizationId: string, entryId: string, adjustedMinutes?: number | null) {
  return apiFetch(`/api/mobile/pta/volunteers/hour-entries/${encodeURIComponent(entryId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, adjustedMinutes: adjustedMinutes ?? null }),
  });
}

// ── PTA parent parity (dues, events/RSVP, announcements, minutes, documents) ─
// Backed by /api/mobile/pta/*, bridging a household-authorized parent (no
// conventional OrgMember) onto the same web PTA parent library functions —
// see mobile-auth.ts's requireMobilePtaHouseholdAccess(). A 403 here means
// either PTA Labs isn't enrolled for this org, or the caller's account has no
// linked household in it — both normal, not errors to surface as failures.

export function getPtaAnnouncements(organizationId: string) {
  return apiFetch<Announcement[]>(`/api/mobile/pta/announcements?organizationId=${encodeURIComponent(organizationId)}`);
}

export function markPtaAnnouncementRead(organizationId: string, campaignId: string) {
  return apiFetch<void>(`/api/mobile/pta/announcements/${encodeURIComponent(campaignId)}/read`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export interface PtaEventRsvp {
  status: 'GOING' | 'NOT_GOING' | 'MAYBE';
  attendeeCount: number;
}

export interface PtaEventVolunteerOpportunity {
  id: string;
  title: string;
}

export interface PtaEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  status: string;
  myRsvp: PtaEventRsvp | null;
  volunteerOpportunities: PtaEventVolunteerOpportunity[];
}

export function getPtaEvents(organizationId: string) {
  return apiFetch<PtaEvent[]>(`/api/mobile/pta/events?organizationId=${encodeURIComponent(organizationId)}`);
}

export function setPtaEventRsvp(
  organizationId: string,
  eventId: string,
  status: 'GOING' | 'NOT_GOING' | 'MAYBE',
  attendeeCount?: number
) {
  return apiFetch<PtaEventRsvp>(`/api/mobile/pta/events/${encodeURIComponent(eventId)}/rsvp`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, status, attendeeCount: attendeeCount ?? 1 }),
  });
}

export interface PtaDuesPayment {
  id: string;
  amountCents: number;
  paymentDate: string;
  method: string;
  reference: string | null;
}

export interface PtaDuesAdjustment {
  id: string;
  type: string;
  amountCents: number;
  reason: string;
  createdAt: string;
}

export type PtaDuesStatus = 'NO_CHARGE' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED' | 'VOIDED' | 'PENDING_REVIEW';

export interface PtaDuesCharge {
  id: string;
  amountDueCents: number;
  amountPaidCents: number;
  remainingBalanceCents: number;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: PtaDuesStatus;
  rawStatus: string;
  createdAt: string;
  payments: PtaDuesPayment[];
  adjustments: PtaDuesAdjustment[];
  pendingReportCount: number;
}

export interface PtaDuesSummary {
  schoolOrPtaName: string | null;
  currentSchoolYear: string | null;
  membershipModel: string | null;
  defaultDuesAmountCents: number | null;
  hasBillingIdentity: boolean;
  currentCharge: PtaDuesCharge | null;
  priorCharges: PtaDuesCharge[];
  onlinePaymentLinkSlug: string | null;
}

export function getPtaDues(organizationId: string) {
  return apiFetch<PtaDuesSummary>(`/api/mobile/pta/dues?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface ReportPtaDuesPaymentInput {
  organizationId: string;
  duesChargeId?: string | null;
  amountCents: number;
  paymentMethod: string;
  paymentDate: string;
  referenceNumber?: string | null;
  note?: string | null;
}

export function reportPtaDuesPayment(input: ReportPtaDuesPaymentInput) {
  return apiFetch(`/api/mobile/pta/dues/report-payment`, { method: 'POST', body: JSON.stringify(input) });
}

export interface PtaApprovedMinutes {
  id: string;
  title: string;
  fileName: string;
  uploadedAt: string;
}

export function getPtaMinutes(organizationId: string) {
  return apiFetch<PtaApprovedMinutes[]>(`/api/mobile/pta/minutes?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface PtaDocument {
  id: string;
  title: string;
  fileName: string;
  contentType: string;
  uploadedAt: string;
  downloadable: false;
}

export function getPtaDocuments(organizationId: string) {
  return apiFetch<PtaDocument[]>(`/api/mobile/pta/documents?organizationId=${encodeURIComponent(organizationId)}`);
}

// ── Identity routing ─────────────────────────────────────────────────────────
// A caller can have a conventional OrgMember, a PTA household link, both (an
// officer who is also a parent), or neither. `hasMemberIdentity` always wins
// when both are present, matching how dashboard.tsx already treats it as the
// organization's "primary" identity for the officer/dual-identity case.
// Screens branch through these instead of re-deriving the choice themselves.

export function getAnnouncementsForIdentity(organizationId: string, hasMemberIdentity: boolean) {
  return hasMemberIdentity ? getAnnouncements(organizationId) : getPtaAnnouncements(organizationId);
}

export function markAnnouncementReadForIdentity(organizationId: string, campaignId: string, hasMemberIdentity: boolean) {
  return hasMemberIdentity
    ? markAnnouncementRead(organizationId, campaignId)
    : markPtaAnnouncementRead(organizationId, campaignId);
}

export function getEventsForIdentity(organizationId: string, hasMemberIdentity: boolean): Promise<PtaEvent[] | MobileEvent[]> {
  return hasMemberIdentity ? getEvents(organizationId) : getPtaEvents(organizationId);
}

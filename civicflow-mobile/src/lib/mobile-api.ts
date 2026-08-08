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

export interface ApprovedMeetingMinutes {
  id: string;
  title: string;
  meetingTitle: string;
  meetingDate: string;
  approvedAt: string;
}

/** Approved-only meeting minutes for ANY identity (conventional member or PTA household) -- one shared route, unlike announcements/events which still have separate PTA vs. conventional endpoints. */
export function getMinutes(organizationId: string) {
  return apiFetch<ApprovedMeetingMinutes[]>(`/api/mobile/minutes?organizationId=${encodeURIComponent(organizationId)}`);
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

// ── Admin ─────────────────────────────────────────────────────────────────
// Mobile Admin program (PR A). Gated server-side on resolveMobileAdminCapabilities()
// (see civicflow-portal's GET /api/mobile/admin/dashboard) -- a 403 here means
// the caller genuinely has no admin capability for this org right now, not a
// client bug; the Admin tab is already hidden in that case (see
// (tabs)/_layout.tsx's hasAdminAccess), so reaching this function at all
// implies the caller believed they had access when the screen last rendered.

export interface AdminMetric {
  key: string;
  label: string;
  value: number;
  href?: string;
}

export interface AdminNeedsAttentionItem {
  id: string;
  label: string;
  href: string;
}

export interface AdminDashboard {
  metrics: AdminMetric[];
  needsAttention: AdminNeedsAttentionItem[];
  generatedAt: string;
}

export function getAdminDashboard(organizationId: string) {
  return apiFetch<AdminDashboard>(`/api/mobile/admin/dashboard?organizationId=${encodeURIComponent(organizationId)}`);
}

// ── Admin: member administration ────────────────────────────────────────────
// Mobile Admin program (PR B). Backed by /api/mobile/admin/members/* in
// civicflow-portal, which delegates to the exact same createMember()/
// updateMember()/terminateMember()/reinstateMember() the web portal's
// /members pages use (src/lib/member-mutations.ts, src/lib/member-lifecycle.ts)
// -- no business logic is duplicated here. Gated on the manageMembers
// capability (see getAdminDashboard above); unavailable for PTA orgs, which
// don't use OrgMember as their roster at all.

export type MembershipStatus = 'active' | 'inactive' | 'deactivated' | 'pending' | 'retired' | 'suspended' | 'terminated';

export interface AdminMemberListRow {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  membershipStatus: MembershipStatus;
  isDelinquent: boolean;
  householdName: string | null;
  city: string | null;
  state: string | null;
}

export interface AdminMemberListResult {
  members: AdminMemberListRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface AdminMemberListParams {
  search?: string;
  membershipStatus?: string;
  delinquency?: 'delinquent' | 'not-delinquent';
  page?: number;
}

export function getAdminMembers(organizationId: string, params: AdminMemberListParams = {}) {
  const query = new URLSearchParams({ organizationId });
  if (params.search) query.set('search', params.search);
  if (params.membershipStatus) query.set('membershipStatus', params.membershipStatus);
  if (params.delinquency) query.set('delinquency', params.delinquency);
  if (params.page) query.set('page', String(params.page));
  return apiFetch<AdminMemberListResult>(`/api/mobile/admin/members?${query.toString()}`);
}

export interface AdminMemberDetail {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  membershipStatus: MembershipStatus;
  statusChangeReason: string | null;
  isDelinquent: boolean;
  joinDate: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  county: string | null;
  country: string | null;
  membershipCategoryId: string | null;
  membershipCategoryManualOverride: boolean;
  householdName: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  commsSmsEnabled: boolean;
  userId: string | null;
}

export function getAdminMember(organizationId: string, memberId: string) {
  return apiFetch<AdminMemberDetail>(
    `/api/mobile/admin/members/${encodeURIComponent(memberId)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export interface CreateAdminMemberInput {
  organizationId: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  joinDate?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  county?: string | null;
  country?: string | null;
  householdName?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
}

export function createAdminMember(input: CreateAdminMemberInput) {
  return apiFetch<AdminMemberDetail>('/api/mobile/admin/members', { method: 'POST', body: JSON.stringify(input) });
}

export type UpdateAdminMemberInput = Partial<Omit<CreateAdminMemberInput, 'organizationId'>> & {
  organizationId: string;
  statusChangeReason?: string | null;
  commsSmsEnabled?: boolean;
};

export function updateAdminMember(memberId: string, input: UpdateAdminMemberInput) {
  return apiFetch<AdminMemberDetail>(`/api/mobile/admin/members/${encodeURIComponent(memberId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export interface TerminateAdminMemberInput {
  organizationId: string;
  reasonCode: string;
  reasonOther?: string;
  effectiveDate: string;
  internalNotes?: string;
}

export function terminateAdminMember(memberId: string, input: TerminateAdminMemberInput) {
  return apiFetch<AdminMemberDetail>(`/api/mobile/admin/members/${encodeURIComponent(memberId)}/terminate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ReinstateAdminMemberInput {
  organizationId: string;
  reason: string;
  effectiveDate: string;
  internalNotes?: string;
}

export function reinstateAdminMember(memberId: string, input: ReinstateAdminMemberInput) {
  return apiFetch<AdminMemberDetail>(`/api/mobile/admin/members/${encodeURIComponent(memberId)}/reinstate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Admin: event administration ─────────────────────────────────────────────
// Mobile Admin program (PR C). Backed by /api/mobile/admin/events/* in
// civicflow-portal, delegating to the exact same createEvent()/updateEvent()
// the web /events pages use (src/lib/event-mutations.ts). Gated on the
// manageEvents capability (see getAdminDashboard above).

export type EventStatusValue = 'upcoming' | 'in_progress' | 'completed' | 'cancelled';

export interface AdminEventListRow {
  id: string;
  title: string;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  status: EventStatusValue;
}

export function getAdminEvents(organizationId: string) {
  return apiFetch<AdminEventListRow[]>(`/api/mobile/admin/events?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface AdminEventDetail {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  status: EventStatusValue;
  notes: string | null;
}

export function getAdminEvent(organizationId: string, eventId: string) {
  return apiFetch<AdminEventDetail>(`/api/mobile/admin/events/${encodeURIComponent(eventId)}?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface CreateAdminEventInput {
  organizationId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status: EventStatusValue;
  notes?: string | null;
}

export function createAdminEvent(input: CreateAdminEventInput) {
  return apiFetch<AdminEventDetail>('/api/mobile/admin/events', { method: 'POST', body: JSON.stringify(input) });
}

export type UpdateAdminEventInput = Partial<Omit<CreateAdminEventInput, 'organizationId' | 'status'>> & {
  organizationId: string;
  status?: EventStatusValue;
};

export function updateAdminEvent(eventId: string, input: UpdateAdminEventInput) {
  return apiFetch<AdminEventDetail>(`/api/mobile/admin/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

// ── Admin: attendance / QR check-in sessions ────────────────────────────────
// Backed by /api/mobile/admin/events/[id]/attendance-session and
// /api/mobile/admin/attendance-sessions/[id]/*, mirroring the web
// AttendanceSessionManager exactly (src/components/app/AttendanceSessionManager.tsx)
// -- same create/open/regenerate/close lifecycle, same signed rotating QR
// token minted server-side. Gated on the manageAttendance capability.

export type AttendanceSessionStatusValue = 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED';
export type AttendanceSessionModeValue = 'ROTATING_QR' | 'STATIC_QR';

export interface AdminAttendanceSession {
  id: string;
  organizationId: string;
  eventId: string | null;
  meetingId: string | null;
  status: AttendanceSessionStatusValue;
  mode: AttendanceSessionModeValue;
  rotationSeconds: number;
  lateThresholdMinutes: number;
  tokenVersion: number;
}

export function getAdminEventAttendanceSession(organizationId: string, eventId: string) {
  return apiFetch<AdminAttendanceSession | null>(
    `/api/mobile/admin/events/${encodeURIComponent(eventId)}/attendance-session?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export function createAdminEventAttendanceSession(organizationId: string, eventId: string) {
  return apiFetch<AdminAttendanceSession>(`/api/mobile/admin/events/${encodeURIComponent(eventId)}/attendance-session`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export function openAdminAttendanceSession(organizationId: string, sessionId: string) {
  return apiFetch<AdminAttendanceSession>(`/api/mobile/admin/attendance-sessions/${encodeURIComponent(sessionId)}/open`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export function closeAdminAttendanceSession(organizationId: string, sessionId: string) {
  return apiFetch<AdminAttendanceSession>(`/api/mobile/admin/attendance-sessions/${encodeURIComponent(sessionId)}/close`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export function regenerateAdminAttendanceSession(organizationId: string, sessionId: string) {
  return apiFetch<AdminAttendanceSession>(`/api/mobile/admin/attendance-sessions/${encodeURIComponent(sessionId)}/regenerate`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export interface AdminAttendanceQr {
  checkInUrl: string;
  qrDataUrl: string;
  mode: AttendanceSessionModeValue;
  rotationSeconds: number;
  secondsRemainingInSlot: number | null;
  slot: number | null;
}

export function getAdminAttendanceSessionQr(organizationId: string, sessionId: string) {
  return apiFetch<AdminAttendanceQr>(
    `/api/mobile/admin/attendance-sessions/${encodeURIComponent(sessionId)}/qr?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export interface AdminAttendanceSummary {
  status: AttendanceSessionStatusValue;
  eligibleCount: number;
  checkedInCount: number;
  counts: { PRESENT: number; LATE: number; EXCUSED: number; ABSENT: number; VIRTUAL: number };
  attendancePercent: number;
}

export function getAdminAttendanceSessionSummary(organizationId: string, sessionId: string) {
  return apiFetch<AdminAttendanceSummary>(
    `/api/mobile/admin/attendance-sessions/${encodeURIComponent(sessionId)}/summary?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export interface AdminAttendanceRosterRow {
  id: string;
  attendanceStatus: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE' | 'VIRTUAL';
  checkInTime: string | null;
  method: string;
  correctionReason: string | null;
  member: { id: string; firstName: string; lastName: string };
}

export function getAdminEventAttendanceRoster(organizationId: string, eventId: string) {
  return apiFetch<AdminAttendanceRosterRow[]>(
    `/api/mobile/admin/events/${encodeURIComponent(eventId)}/attendance?organizationId=${encodeURIComponent(organizationId)}`
  );
}

// ── Admin: communications / campaign administration ─────────────────────────
// Backed by /api/mobile/admin/campaigns/*, delegating to the exact same
// createCommunicationCampaign()/sendCommunicationCampaign() the web
// Communications pages use. Gated on the manageCommunications capability
// (already wired since PR A). Mobile intentionally omits WhatsApp
// template selection and custom recipientFilter UI -- those stay web-only
// for now; the API still accepts the full web schema unchanged.

export type CampaignCommunicationType = 'ANNOUNCEMENT' | 'MEETING_MINUTES' | 'DUES_REMINDER' | 'EVENT_NOTICE' | 'CAMPAIGN_UPDATE' | 'GENERAL' | 'OTHER';
export type CampaignChannel = 'EMAIL' | 'SMS' | 'EMAIL_AND_SMS' | 'INTERNAL_LOG_ONLY';
export type CampaignStatus = 'DRAFT' | 'READY' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELED';

export interface AdminCampaignListRow {
  id: string;
  title: string;
  communicationType: CampaignCommunicationType;
  channel: CampaignChannel;
  status: CampaignStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  _count: { recipients: number };
}

export function getAdminCampaigns(organizationId: string) {
  return apiFetch<AdminCampaignListRow[]>(`/api/mobile/admin/campaigns?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface AdminCampaignDetail {
  id: string;
  title: string;
  communicationType: CampaignCommunicationType;
  channel: CampaignChannel;
  subject: string;
  body: string;
  status: CampaignStatus;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  _count: { recipients: number };
}

export function getAdminCampaign(organizationId: string, campaignId: string) {
  return apiFetch<AdminCampaignDetail>(
    `/api/mobile/admin/campaigns/${encodeURIComponent(campaignId)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export interface CreateAdminCampaignInput {
  organizationId: string;
  title: string;
  communicationType: CampaignCommunicationType;
  channel: CampaignChannel;
  subject: string;
  body: string;
  sendNow?: boolean;
}

export function createAdminCampaign(input: CreateAdminCampaignInput) {
  return apiFetch<AdminCampaignDetail>('/api/mobile/admin/campaigns', { method: 'POST', body: JSON.stringify(input) });
}

export function sendAdminCampaign(organizationId: string, campaignId: string) {
  return apiFetch<{ sent: number; skipped: number; failed: number }>(`/api/mobile/admin/campaigns/${encodeURIComponent(campaignId)}/send`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

// ── Admin: payments / dues / contributions / reports ────────────────────────
// Mobile Admin program (PR D). Backed by /api/mobile/admin/{financial-summary,
// dues,contributions,payment-reports,payment-link-reports,reports}/* in
// civicflow-portal, delegating to the exact same shared services the web
// /dues, /contributions, /receipts, /payment-reports, and /reports pages
// use -- no separate mobile-only financial write path. Money amounts are
// always plain strings (the server's Decimal.toString()), never converted
// to a JS number for display -- this app never does its own currency math,
// it only shows what the server computed. Gated on the managePayments/
// manageReports capabilities (see getAdminDashboard above); managePayments
// alone does not imply every specific dues/contributions/receipts
// permission, so a 403 from any of these can mean "you hold some payments
// capability but not this specific one" -- a normal, expected state.

export interface AdminFinancialSummary {
  totalDuesCollectedCents: number;
  totalContributionsCents: number;
  duesOutstandingCents: number;
  duesCollected30dCents: number;
  pendingPaymentReports: number;
  pendingPaymentLinkReports: number;
}

export function getAdminFinancialSummary(organizationId: string) {
  return apiFetch<AdminFinancialSummary>(`/api/mobile/admin/financial-summary?organizationId=${encodeURIComponent(organizationId)}`);
}

export type DuesChargeStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'WAIVED' | 'VOID';
export type DuesAdjustmentType = 'WAIVER' | 'DISCOUNT' | 'CREDIT' | 'WRITE_OFF' | 'MANUAL_ADJUSTMENT';
export type DuesPaymentMethodValue =
  | 'CASH' | 'CHECK' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CARD' | 'ACH' | 'ZELLE' | 'CASH_APP' | 'VENMO' | 'PAYPAL' | 'STRIPE' | 'ZEFFY' | 'OTHER';

export interface AdminDuesCharge {
  id: string;
  amountDue: string;
  amountPaid: string;
  dueDate: string;
  status: DuesChargeStatus;
  duesAccountId: string | null;
}

export interface AdminDuesPaymentRow {
  id: string;
  amount: string;
  paymentDate: string;
  method: DuesPaymentMethodValue;
  reference: string | null;
  duesChargeId: string | null;
}

export interface AdminDuesAdjustmentRow {
  id: string;
  adjustmentType: DuesAdjustmentType;
  amount: string;
  reason: string;
  duesChargeId: string | null;
  createdAt: string;
}

export interface AdminMemberDues {
  member: { id: string; firstName: string; lastName: string; isDelinquent: boolean };
  charges: AdminDuesCharge[];
  payments: AdminDuesPaymentRow[];
  adjustments: AdminDuesAdjustmentRow[];
}

export function getAdminMemberDues(organizationId: string, memberId: string) {
  return apiFetch<AdminMemberDues>(
    `/api/mobile/admin/dues?organizationId=${encodeURIComponent(organizationId)}&memberId=${encodeURIComponent(memberId)}`
  );
}

export interface RecordAdminDuesPaymentInput {
  organizationId: string;
  memberId?: string;
  duesChargeId?: string | null;
  duesAccountId?: string | null;
  amount: number;
  paymentDate: string;
  method?: DuesPaymentMethodValue;
  reference?: string | null;
  notes?: string | null;
}

export function recordAdminDuesPayment(input: RecordAdminDuesPaymentInput) {
  return apiFetch<AdminDuesPaymentRow>('/api/mobile/admin/dues/payments', { method: 'POST', body: JSON.stringify(input) });
}

export interface CreateAdminDuesAdjustmentInput {
  organizationId: string;
  memberId: string;
  duesChargeId?: string | null;
  adjustmentType: DuesAdjustmentType;
  amount: number;
  reason: string;
}

export function createAdminDuesAdjustment(input: CreateAdminDuesAdjustmentInput) {
  return apiFetch<AdminDuesAdjustmentRow>('/api/mobile/admin/dues/adjustments', { method: 'POST', body: JSON.stringify(input) });
}

export function generateAdminDuesForMember(organizationId: string, memberId: string) {
  return apiFetch<{ result: unknown; delinquencyResult: unknown }>('/api/mobile/admin/dues/generate', {
    method: 'POST',
    body: JSON.stringify({ organizationId, memberId }),
  });
}

export type ContributionSourceValue = 'MEMBER_PROFILE' | 'CAMPAIGN_PAGE' | 'EVENT_PAGE' | 'MANUAL' | 'IMPORT';

export interface AdminContributionListRow {
  id: string;
  amount: string;
  contributionDate: string;
  source: ContributionSourceValue;
  paymentMethod: DuesPaymentMethodValue | null;
  voidedAt: string | null;
  member: { id: string; firstName: string; lastName: string } | null;
  campaign: { id: string; name: string } | null;
  event: { id: string; title: string } | null;
}

export function getAdminContributions(organizationId: string) {
  return apiFetch<AdminContributionListRow[]>(`/api/mobile/admin/contributions?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface AdminContributionDetail {
  id: string;
  amount: string;
  contributionDate: string;
  source: ContributionSourceValue;
  paymentMethod: DuesPaymentMethodValue | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lockedAt: string | null;
  member: { id: string; firstName: string; lastName: string } | null;
  campaign: { id: string; name: string } | null;
  event: { id: string; title: string } | null;
  receipts: { id: string; receiptNumber: string; deliveryStatus: string; createdAt: string }[];
}

export function getAdminContribution(organizationId: string, contributionId: string) {
  return apiFetch<AdminContributionDetail>(
    `/api/mobile/admin/contributions/${encodeURIComponent(contributionId)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export interface CreateAdminContributionInput {
  organizationId: string;
  memberId?: string | null;
  campaignId?: string | null;
  eventId?: string | null;
  contributorName?: string | null;
  amount: number;
  contributionDate: string;
  paymentMethod?: DuesPaymentMethodValue;
  source: ContributionSourceValue;
  receiptRequested?: boolean;
  notes?: string | null;
}

export function createAdminContribution(input: CreateAdminContributionInput) {
  return apiFetch<AdminContributionDetail>('/api/mobile/admin/contributions', { method: 'POST', body: JSON.stringify(input) });
}

export type UpdateAdminContributionInput = Partial<{
  amount: number;
  contributionDate: string;
  paymentMethod: DuesPaymentMethodValue | null;
  notes: string | null;
  receiptRequested: boolean;
  editReason: string;
}> & { organizationId: string };

export function updateAdminContribution(contributionId: string, input: UpdateAdminContributionInput) {
  return apiFetch<AdminContributionDetail>(`/api/mobile/admin/contributions/${encodeURIComponent(contributionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function voidAdminContribution(contributionId: string, organizationId: string, reason?: string) {
  return apiFetch<AdminContributionDetail>(`/api/mobile/admin/contributions/${encodeURIComponent(contributionId)}/void`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, reason }),
  });
}

export function generateAdminContributionReceipt(contributionId: string, organizationId: string) {
  return apiFetch<{ id: string; receiptNumber: string }>(`/api/mobile/admin/contributions/${encodeURIComponent(contributionId)}/receipt`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

// ── Admin: payment report review (member self-reports + payment-link offline reports) ─

export type PaymentReportStatusValue = 'pending' | 'approved' | 'rejected';
export type PaymentReportCategoryValue =
  | 'MEMBERSHIP_DUES' | 'EVENT_REGISTRATION' | 'DONATION' | 'FUNDRAISER' | 'MERCHANDISE' | 'SPONSORSHIP' | 'ASSESSMENT' | 'OTHER';

export interface AdminPaymentReportRow {
  id: string;
  amount: string;
  paymentMethod: DuesPaymentMethodValue;
  paymentDate: string;
  category: PaymentReportCategoryValue;
  status: PaymentReportStatusValue;
  rejectionReason: string | null;
  createdAt: string;
  member: { id: string; firstName: string; lastName: string };
}

export function getAdminPaymentReports(organizationId: string, status: PaymentReportStatusValue = 'pending') {
  return apiFetch<AdminPaymentReportRow[]>(
    `/api/mobile/admin/payment-reports?organizationId=${encodeURIComponent(organizationId)}&status=${status}`
  );
}

export function approveAdminPaymentReport(reportId: string, organizationId: string, note?: string) {
  return apiFetch<AdminPaymentReportRow>(`/api/mobile/admin/payment-reports/${encodeURIComponent(reportId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, note }),
  });
}

export function rejectAdminPaymentReport(reportId: string, organizationId: string, rejectionReason: string) {
  return apiFetch<AdminPaymentReportRow>(`/api/mobile/admin/payment-reports/${encodeURIComponent(reportId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, rejectionReason }),
  });
}

export interface AdminPaymentLinkReportRow {
  id: string;
  amount: string;
  payerName: string;
  payerEmail: string;
  referenceNumber: string | null;
  status: PaymentReportStatusValue;
  rejectionReason: string | null;
  createdAt: string;
  paymentLink: { id: string; title: string };
}

export function getAdminPaymentLinkReports(organizationId: string, status: PaymentReportStatusValue = 'pending') {
  return apiFetch<AdminPaymentLinkReportRow[]>(
    `/api/mobile/admin/payment-link-reports?organizationId=${encodeURIComponent(organizationId)}&status=${status}`
  );
}

export function approveAdminPaymentLinkReport(reportId: string, organizationId: string, note?: string) {
  return apiFetch<AdminPaymentLinkReportRow>(`/api/mobile/admin/payment-link-reports/${encodeURIComponent(reportId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, note }),
  });
}

export function rejectAdminPaymentLinkReport(reportId: string, organizationId: string, rejectionReason: string) {
  return apiFetch<AdminPaymentLinkReportRow>(`/api/mobile/admin/payment-link-reports/${encodeURIComponent(reportId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, rejectionReason }),
  });
}

// ── Admin: reports (email delivery only -- see mobile-report-send.ts) ───────

export type AdminReportType =
  | 'GENERAL_FINANCIAL' | 'OUTSTANDING_DUES' | 'MONTHLY_DUES_COLLECTION' | 'DELINQUENT_MEMBERS'
  | 'CONTRIBUTIONS' | 'ACTIVE_MEMBER_ROSTER' | 'DELINQUENT_MEMBER_ROSTER';

export const ADMIN_REPORT_TYPE_LABELS: Record<AdminReportType, string> = {
  GENERAL_FINANCIAL: 'General Financial Summary',
  OUTSTANDING_DUES: 'Outstanding Dues',
  MONTHLY_DUES_COLLECTION: 'Monthly Dues Collection',
  DELINQUENT_MEMBERS: 'Delinquent Members',
  CONTRIBUTIONS: 'Contributions',
  ACTIVE_MEMBER_ROSTER: 'Active Member Roster',
  DELINQUENT_MEMBER_ROSTER: 'Delinquent Member Roster',
};

export interface SendAdminReportInput {
  organizationId: string;
  reportType: AdminReportType;
  startDate?: string | null;
  endDate?: string | null;
  format?: 'csv' | 'xlsx' | 'pdf';
}

export function sendAdminReport(input: SendAdminReportInput) {
  return apiFetch<{ sent: boolean }>('/api/mobile/admin/reports/send', { method: 'POST', body: JSON.stringify(input) });
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

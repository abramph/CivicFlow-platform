import { apiFetch, apiFetchImageDataUri } from '@/lib/api-client';

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

// ── Event RSVP contract ──────────────────────────────────────────────────────
// Mirrors civicflow-portal's src/lib/event-rsvp.ts. The organization's RSVP
// capability (capability.rsvp on /api/mobile/organizations rows) and the
// per-event `rsvp` block are the ONLY authorities for RSVP mode and identity —
// never `'myRsvp' in event`, never memberId/householdAdultId presence (that
// implicit discrimination is what regressed in Build 9).

export type RsvpMode = 'household' | 'individual' | 'none';

export type RsvpStatus = 'GOING' | 'NOT_GOING' | 'MAYBE';

export interface RsvpCapability {
  mode: RsvpMode;
  guestCounts: boolean;
  canRsvp: boolean;
}

export interface EventRsvpBlock {
  mode: RsvpMode;
  canRsvp: boolean;
  guestCounts: boolean;
  response: { status: RsvpStatus; attendeeCount: number } | null;
  subject: { type: 'household' | 'member' | 'none'; id: string | null };
}

export interface MobileEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  status: string;
  /** Optional only for compatibility with pre-RSVP server responses — the
   * current server always sends it. Absent block ⇒ no RSVP UI. */
  rsvp?: EventRsvpBlock;
}

export function getEvents(organizationId: string) {
  return apiFetch<MobileEvent[]>(`/api/mobile/events?organizationId=${encodeURIComponent(organizationId)}`);
}

/** Individual (per-member) RSVP for Community/Union events. The server
 * resolves the member from the authenticated user — no member ID is sent. */
export function setEventRsvp(organizationId: string, eventId: string, status: RsvpStatus) {
  return apiFetch<EventRsvpBlock>(`/api/mobile/events/${encodeURIComponent(eventId)}/rsvp`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, status }),
  });
}

// ── Meetings (Core Meeting RSVP) ─────────────────────────────────────────────
// Same normalized rsvp contract as events — one block shape, one capability
// authority, parallel endpoints.

export interface MobileMeeting {
  id: string;
  title: string;
  meetingType: string | null;
  meetingDate: string;
  location: string | null;
  description: string | null;
  rsvp?: EventRsvpBlock;
}

export function getMeetings(organizationId: string) {
  return apiFetch<MobileMeeting[]>(`/api/mobile/meetings?organizationId=${encodeURIComponent(organizationId)}`);
}

export function getPtaMeetings(organizationId: string) {
  return apiFetch<MobileMeeting[]>(`/api/mobile/pta/meetings?organizationId=${encodeURIComponent(organizationId)}`);
}

export function setMeetingRsvp(organizationId: string, meetingId: string, status: RsvpStatus) {
  return apiFetch<EventRsvpBlock>(`/api/mobile/meetings/${encodeURIComponent(meetingId)}/rsvp`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, status }),
  });
}

export function setPtaMeetingRsvp(
  organizationId: string,
  meetingId: string,
  status: RsvpStatus,
  attendeeCount?: number
) {
  return apiFetch<{ status: RsvpStatus; attendeeCount: number }>(`/api/mobile/pta/meetings/${encodeURIComponent(meetingId)}/rsvp`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, status, attendeeCount: attendeeCount ?? 1 }),
  });
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
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
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

/**
 * MEMBER-QR-J — "Update My Information." A submission, not a direct write:
 * the backend routes it through the same Member Intake apply engine the
 * public QR form uses, so an identity-sensitive change (legal name, email,
 * date of birth) may come back REVIEW_REQUIRED instead of APPLIED even
 * though the request itself succeeded (200).
 */
export type ProfileUpdateFieldKey =
  | 'firstName'
  | 'lastName'
  | 'preferredName'
  | 'email'
  | 'phone'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'zipCode';

export interface ProfileUpdateResult {
  status: 'APPLIED' | 'REVIEW_REQUIRED';
  appliedFieldCount: number;
}

export function submitProfileUpdate(organizationId: string, fieldValues: Partial<Record<ProfileUpdateFieldKey, string>>) {
  return apiFetch<ProfileUpdateResult>(`/api/mobile/profile`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, fieldValues }),
  });
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
  /** Deprecated — kept because the server still sends it for older builds;
   * new code reads `rsvp` instead. */
  myRsvp: PtaEventRsvp | null;
  /** Same normalized contract as MobileEvent.rsvp (mode "household" here). */
  rsvp?: EventRsvpBlock;
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

// ── PTA parent — read-only student progression ───────────────────────────
// Backed by /api/mobile/pta/progression. Family-scoped and read-only: the
// household is resolved server-side from the caller's own
// PtaHouseholdAdult linkage, never sent by the client, and the response
// carries no administrative preview, batch, outcome, or audit data (see
// parent-progression.ts). Administrative progression stays portal-only.

/** Family-facing status vocabulary — deliberately small and safe; never a
 * raw internal progression record status or outcome code. */
export type PtaProgressionStatus = 'CURRENT' | 'CONFIRMED' | 'NOT_YET_AVAILABLE' | 'COMPLETED';

export interface PtaProgressionStudent {
  studentId: string;
  displayName: string;
  currentGrade: string | null;
  currentClassroom: string | null;
  /** Populated only once an administrator has explicitly PUBLISHED the
   * progression results. A committed-but-unpublished placement arrives as
   * null, exactly like an unresolved or excluded one. */
  nextGrade: string | null;
  nextClassroom: string | null;
  status: PtaProgressionStatus;
  /** Never explains why a placement is unavailable — unpublished,
   * withdrawn, unresolved, excluded and rolled-back are indistinguishable. */
  publicationStatus: 'NOT_AVAILABLE' | 'PUBLISHED';
}

export interface PtaProgressionSummary {
  currentSchoolYear: string | null;
  nextSchoolYear: string | null;
  students: PtaProgressionStudent[];
}

export function getPtaProgression(organizationId: string) {
  return apiFetch<PtaProgressionSummary>(`/api/mobile/pta/progression?organizationId=${encodeURIComponent(organizationId)}`);
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

// ── PTA parent — family photo ────────────────────────────────────────────
// Backed by /api/mobile/pta/household/photo, a bearer-token bridge over the
// same household-photo.ts security pipeline (magic-byte validation, sharp
// re-encode, EXIF strip) the web parent self-service route uses. The
// household id is never sent by the client — the server resolves it from
// the caller's own PtaHouseholdAdult linkage on every call.

export interface PtaHouseholdPhoto {
  /** A local `data:` URI holding the bytes this device fetched with its own
   * bearer token — never a storage URL. The API stopped returning signed
   * object-storage URLs for family photos: they are a shareable, unrevocable
   * bearer credential for children's/household data. */
  uri: string;
  byteSize: number;
}

/**
 * Returns the family photo for the CALLER'S OWN household. No household,
 * attachment or student id is sent: the server resolves the household from
 * the bearer token's linkage, so there is nothing here for a client to forge.
 *
 * Resolves to null when there is no photo (HTTP 404), which is a normal state.
 */
export async function getPtaHouseholdPhoto(organizationId: string): Promise<PtaHouseholdPhoto | null> {
  const uri = await apiFetchImageDataUri(
    `/api/mobile/pta/household/photo?organizationId=${encodeURIComponent(organizationId)}`
  );
  if (!uri) return null;
  // Approximate decoded size from the base64 payload; used only for display
  // and diagnostics, never for any security decision.
  const base64 = uri.slice(uri.indexOf(',') + 1);
  return { uri, byteSize: Math.floor((base64.length * 3) / 4) };
}

export interface UploadPtaHouseholdPhotoAsset {
  uri: string;
  fileName: string;
  mimeType: string;
}

export interface PtaHouseholdPhotoUploadResult {
  photoUrl: string;
  byteSize: number;
  width: number;
  height: number;
}

/**
 * React Native's fetch/FormData accepts a {uri, name, type} object in place
 * of a web File/Blob to reference a local file by its on-device URI --
 * there's no Blob to construct from an asset URI without reading the whole
 * file into memory first, which this deliberately avoids. The DOM lib's
 * FormData.append() type only knows about `Blob`, hence the cast; this is
 * the standard React Native pattern for multipart file uploads. apiFetch()
 * already skips forcing a JSON Content-Type whenever the body is FormData.
 */
export function uploadPtaHouseholdPhoto(organizationId: string, asset: UploadPtaHouseholdPhotoAsset) {
  const form = new FormData();
  form.append('file', { uri: asset.uri, name: asset.fileName, type: asset.mimeType } as unknown as Blob);
  return apiFetch<PtaHouseholdPhotoUploadResult>(`/api/mobile/pta/household/photo?organizationId=${encodeURIComponent(organizationId)}`, {
    method: 'POST',
    body: form,
  });
}

export function deletePtaHouseholdPhoto(organizationId: string) {
  return apiFetch<void>(`/api/mobile/pta/household/photo?organizationId=${encodeURIComponent(organizationId)}`, { method: 'DELETE' });
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

// ── Admin: PTA households / HOA properties, violations, architectural requests ──
// Mobile Admin program (PR E) — per-vertical admin. Backed by
// /api/mobile/admin/pta/households/* and /api/mobile/admin/hoa/* in
// civicflow-portal, delegating to the exact same src/lib service functions
// the web /labs/pta/households and /hoa/* pages use. Gated on
// managePtaHouseholds / manageHoaProperties / manageHoaViolations /
// manageHoaArchitecturalRequests -- each of those capabilities maps to only
// ONE specific RBAC permission server-side (see mobile-admin.ts's
// FLAG_RULES), so holding the coarse flag never implies every fine-grained
// permission a given screen's actions need (e.g. managePtaHouseholds does
// NOT imply pta:students:manage; manageHoaViolations does NOT imply
// hoa:violations:resolve). A 403 from any of these calls can mean "you can
// see this screen but not do this specific action" -- a normal, expected
// state, not a bug. Architectural requests are READ + COMMENT ONLY here on
// purpose -- there is no client function for deciding one (approve/deny/
// conditionally-approve), matching the portal's documented decision that
// board-level decisions don't belong on mobile.

export type PtaHouseholdStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING';
export type PtaStudentStatus = 'ACTIVE' | 'INACTIVE';

export interface AdminPtaHouseholdAdult {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  relationshipLabel: string | null;
  userId: string | null;
}

export interface AdminPtaStudent {
  id: string;
  displayName: string;
  status: PtaStudentStatus;
}

export interface AdminPtaHouseholdListRow {
  id: string;
  displayName: string;
  status: PtaHouseholdStatus;
  schoolYear: string;
  adults: AdminPtaHouseholdAdult[];
  students: { id: string; displayName: string; status: PtaStudentStatus }[];
}

export interface AdminPtaHouseholdDetail extends Omit<AdminPtaHouseholdListRow, 'students'> {
  notes: string | null;
  volunteerInterests: string[];
  students: AdminPtaStudent[];
}

export function getAdminPtaHouseholds(organizationId: string, filters: { schoolYear?: string; status?: string; search?: string } = {}) {
  const params = new URLSearchParams({ organizationId });
  if (filters.schoolYear) params.set('schoolYear', filters.schoolYear);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  return apiFetch<AdminPtaHouseholdListRow[]>(`/api/mobile/admin/pta/households?${params.toString()}`);
}

export function getAdminPtaHousehold(organizationId: string, householdId: string) {
  return apiFetch<AdminPtaHouseholdDetail>(`/api/mobile/admin/pta/households/${encodeURIComponent(householdId)}?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface CreateAdminPtaHouseholdInput {
  organizationId: string;
  displayName: string;
  schoolYear: string;
  status?: PtaHouseholdStatus;
  notes?: string | null;
}

export function createAdminPtaHousehold(input: CreateAdminPtaHouseholdInput) {
  return apiFetch<AdminPtaHouseholdDetail>('/api/mobile/admin/pta/households', { method: 'POST', body: JSON.stringify(input) });
}

export type UpdateAdminPtaHouseholdInput = Partial<{
  displayName: string;
  status: PtaHouseholdStatus;
  notes: string | null;
}> & { organizationId: string };

export function updateAdminPtaHousehold(householdId: string, input: UpdateAdminPtaHouseholdInput) {
  return apiFetch<AdminPtaHouseholdDetail>(`/api/mobile/admin/pta/households/${encodeURIComponent(householdId)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deactivateAdminPtaHousehold(householdId: string, organizationId: string) {
  return apiFetch<AdminPtaHouseholdDetail>(`/api/mobile/admin/pta/households/${encodeURIComponent(householdId)}?organizationId=${encodeURIComponent(organizationId)}`, { method: 'DELETE' });
}

export interface AddAdminPtaHouseholdAdultInput {
  organizationId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  relationshipLabel?: string | null;
  makePrimaryContact?: boolean;
}

export function addAdminPtaHouseholdAdult(householdId: string, input: AddAdminPtaHouseholdAdultInput) {
  return apiFetch<AdminPtaHouseholdAdult>(`/api/mobile/admin/pta/households/${encodeURIComponent(householdId)}/adults`, { method: 'POST', body: JSON.stringify(input) });
}

export function removeAdminPtaHouseholdAdult(householdId: string, adultId: string, organizationId: string) {
  return apiFetch<{ removed: boolean }>(
    `/api/mobile/admin/pta/households/${encodeURIComponent(householdId)}/adults/${encodeURIComponent(adultId)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: 'DELETE' }
  );
}

export function addAdminPtaStudent(householdId: string, organizationId: string, displayName: string) {
  return apiFetch<AdminPtaStudent>(`/api/mobile/admin/pta/households/${encodeURIComponent(householdId)}/students`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, displayName }),
  });
}

export function deactivateAdminPtaStudent(householdId: string, studentId: string, organizationId: string) {
  return apiFetch<AdminPtaStudent>(
    `/api/mobile/admin/pta/households/${encodeURIComponent(householdId)}/students/${encodeURIComponent(studentId)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: 'DELETE' }
  );
}

// ── Admin: HOA properties & residents ────────────────────────────────────────

export type HoaPropertyType = 'SINGLE_FAMILY' | 'CONDO_UNIT' | 'TOWNHOME' | 'VACANT_LOT' | 'COMMON_PROPERTY' | 'OTHER';
export type HoaPropertyStatus = 'ACTIVE' | 'INACTIVE';
export type HoaResidentType = 'OWNER' | 'CO_OWNER' | 'RESIDENT' | 'TENANT' | 'NON_RESIDENT_OWNER' | 'OTHER';
export type HoaResidentStatus = 'ACTIVE' | 'ENDED';

export interface AdminHoaPropertyListRow {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  unitLabel: string | null;
  buildingLabel: string | null;
  propertyType: HoaPropertyType;
  displayName: string | null;
  status: HoaPropertyStatus;
  billingMember: { id: string; firstName: string; lastName: string } | null;
  _count: { residents: number };
}

export interface AdminHoaResident {
  id: string;
  relationshipType: HoaResidentType;
  status: HoaResidentStatus;
  isPrimaryContact: boolean;
  ownershipPercentage: string | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  orgMember: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null } | null;
}

export interface AdminHoaPropertyDetail extends Omit<AdminHoaPropertyListRow, '_count'> {
  country: string | null;
  notes: string | null;
  billingMember: { id: string; firstName: string; lastName: string; email: string | null } | null;
  residents: AdminHoaResident[];
}

export function getAdminHoaProperties(organizationId: string, filters: { status?: string; search?: string } = {}) {
  const params = new URLSearchParams({ organizationId });
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  return apiFetch<{ properties: AdminHoaPropertyListRow[]; total: number; take: number; skip: number }>(`/api/mobile/admin/hoa/properties?${params.toString()}`);
}

export function getAdminHoaProperty(organizationId: string, propertyId: string) {
  return apiFetch<AdminHoaPropertyDetail>(`/api/mobile/admin/hoa/properties/${encodeURIComponent(propertyId)}?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface CreateAdminHoaPropertyInput {
  organizationId: string;
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  unitLabel?: string | null;
  buildingLabel?: string | null;
  propertyType?: HoaPropertyType;
  displayName?: string | null;
  notes?: string | null;
}

export function createAdminHoaProperty(input: CreateAdminHoaPropertyInput) {
  return apiFetch<AdminHoaPropertyDetail>('/api/mobile/admin/hoa/properties', { method: 'POST', body: JSON.stringify(input) });
}

export type UpdateAdminHoaPropertyInput = Partial<{
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  unitLabel: string | null;
  buildingLabel: string | null;
  propertyType: HoaPropertyType;
  displayName: string | null;
  notes: string | null;
}> & { organizationId: string };

export function updateAdminHoaProperty(propertyId: string, input: UpdateAdminHoaPropertyInput) {
  return apiFetch<AdminHoaPropertyDetail>(`/api/mobile/admin/hoa/properties/${encodeURIComponent(propertyId)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function archiveAdminHoaProperty(propertyId: string, organizationId: string) {
  return apiFetch<AdminHoaPropertyDetail>(`/api/mobile/admin/hoa/properties/${encodeURIComponent(propertyId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export function reactivateAdminHoaProperty(propertyId: string, organizationId: string) {
  return apiFetch<AdminHoaPropertyDetail>(`/api/mobile/admin/hoa/properties/${encodeURIComponent(propertyId)}/reactivate`, {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

export interface AssignAdminHoaResidentInput {
  organizationId: string;
  orgMemberId: string;
  relationshipType: HoaResidentType;
  isPrimaryContact?: boolean;
  ownershipPercentage?: number | null;
  moveInDate?: string | null;
}

export function assignAdminHoaResident(propertyId: string, input: AssignAdminHoaResidentInput) {
  return apiFetch<AdminHoaResident>(`/api/mobile/admin/hoa/properties/${encodeURIComponent(propertyId)}/residents`, { method: 'POST', body: JSON.stringify(input) });
}

export type UpdateAdminHoaResidentInput = Partial<{
  relationshipType: HoaResidentType;
  isPrimaryContact: boolean;
  ownershipPercentage: number | null;
}> & { organizationId: string };

export function updateAdminHoaResident(propertyId: string, residentId: string, input: UpdateAdminHoaResidentInput) {
  return apiFetch<AdminHoaResident>(`/api/mobile/admin/hoa/properties/${encodeURIComponent(propertyId)}/residents/${encodeURIComponent(residentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function endAdminHoaResident(propertyId: string, residentId: string, organizationId: string, moveOutDate?: string | null) {
  return apiFetch<AdminHoaResident>(`/api/mobile/admin/hoa/properties/${encodeURIComponent(propertyId)}/residents/${encodeURIComponent(residentId)}/end`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, moveOutDate }),
  });
}

// ── Admin: HOA violations ────────────────────────────────────────────────────

export type HoaViolationStatus = 'DRAFT' | 'ISSUED' | 'ACKNOWLEDGED' | 'IN_REVIEW' | 'CURED' | 'RESOLVED' | 'DISMISSED';

export interface AdminHoaViolationListRow {
  id: string;
  violationType: string;
  status: HoaViolationStatus;
  cureByDate: string | null;
  issuedAt: string | null;
  createdAt: string;
  property: { id: string; addressLine1: string; unitLabel: string | null; displayName: string | null };
}

export interface AdminHoaViolationDetail extends AdminHoaViolationListRow {
  description: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  notices: { id: string; noticeType: string; sentAt: string; channel: string; body: string }[];
  comments: { id: string; authorUserId: string | null; body: string; isPrivate: boolean; createdAt: string }[];
  statusHistory: { id: string; fromStatus: HoaViolationStatus | null; toStatus: HoaViolationStatus; notes: string | null; createdAt: string }[];
}

export function getAdminHoaViolations(organizationId: string, filters: { propertyId?: string; status?: string } = {}) {
  const params = new URLSearchParams({ organizationId });
  if (filters.propertyId) params.set('propertyId', filters.propertyId);
  if (filters.status) params.set('status', filters.status);
  return apiFetch<AdminHoaViolationListRow[]>(`/api/mobile/admin/hoa/violations?${params.toString()}`);
}

export function getAdminHoaViolation(organizationId: string, violationId: string) {
  return apiFetch<AdminHoaViolationDetail>(`/api/mobile/admin/hoa/violations/${encodeURIComponent(violationId)}?organizationId=${encodeURIComponent(organizationId)}`);
}

export interface CreateAdminHoaViolationInput {
  organizationId: string;
  propertyId: string;
  violationType: string;
  description: string;
  cureByDate?: string | null;
}

export function createAdminHoaViolation(input: CreateAdminHoaViolationInput) {
  return apiFetch<AdminHoaViolationDetail>('/api/mobile/admin/hoa/violations', { method: 'POST', body: JSON.stringify(input) });
}

export function issueAdminHoaViolation(violationId: string, organizationId: string, noticeBody: string, cureByDate?: string | null) {
  return apiFetch<AdminHoaViolationDetail>(`/api/mobile/admin/hoa/violations/${encodeURIComponent(violationId)}/issue`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, noticeBody, cureByDate }),
  });
}

export type AdminHoaViolationTransitionTarget = 'ACKNOWLEDGED' | 'IN_REVIEW' | 'CURED' | 'RESOLVED' | 'DISMISSED';

export function transitionAdminHoaViolation(
  violationId: string,
  organizationId: string,
  toStatus: AdminHoaViolationTransitionTarget,
  input?: { notes?: string | null; resolutionNotes?: string | null }
) {
  return apiFetch<AdminHoaViolationDetail>(`/api/mobile/admin/hoa/violations/${encodeURIComponent(violationId)}/transition`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, toStatus, ...input }),
  });
}

export function addAdminHoaViolationComment(violationId: string, organizationId: string, body: string, isPrivate: boolean = true) {
  return apiFetch<{ id: string; body: string; isPrivate: boolean }>(`/api/mobile/admin/hoa/violations/${encodeURIComponent(violationId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, body, isPrivate }),
  });
}

// ── Admin: HOA architectural requests (read + comment only, never decide) ───

export type HoaArchitecturalRequestStatus =
  | 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'RESUBMITTED'
  | 'APPROVED' | 'CONDITIONALLY_APPROVED' | 'DENIED' | 'WITHDRAWN' | 'EXPIRED';

export interface AdminHoaArchitecturalRequestListRow {
  id: string;
  requestNumber: number;
  category: string;
  title: string;
  status: HoaArchitecturalRequestStatus;
  createdAt: string;
  property: { id: string; addressLine1: string; unitLabel: string | null; displayName: string | null };
}

export interface AdminHoaArchitecturalRequestDetail extends AdminHoaArchitecturalRequestListRow {
  projectDescription: string;
  proposedStartDate: string | null;
  proposedCompletionDate: string | null;
  decisionSummary: string | null;
  conditions: string | null;
  comments: { id: string; authorUserId: string | null; body: string; isPrivate: boolean; createdAt: string }[];
  statusHistory: { id: string; fromStatus: HoaArchitecturalRequestStatus | null; toStatus: HoaArchitecturalRequestStatus; createdAt: string }[];
}

export function getAdminHoaArchitecturalRequests(organizationId: string, filters: { propertyId?: string; status?: string } = {}) {
  const params = new URLSearchParams({ organizationId });
  if (filters.propertyId) params.set('propertyId', filters.propertyId);
  if (filters.status) params.set('status', filters.status);
  return apiFetch<AdminHoaArchitecturalRequestListRow[]>(`/api/mobile/admin/hoa/architectural-requests?${params.toString()}`);
}

export function getAdminHoaArchitecturalRequest(organizationId: string, requestId: string) {
  return apiFetch<AdminHoaArchitecturalRequestDetail>(
    `/api/mobile/admin/hoa/architectural-requests/${encodeURIComponent(requestId)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export function addAdminHoaArchitecturalRequestComment(requestId: string, organizationId: string, body: string, isPrivate: boolean = true) {
  return apiFetch<{ id: string; body: string; isPrivate: boolean }>(`/api/mobile/admin/hoa/architectural-requests/${encodeURIComponent(requestId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, body, isPrivate }),
  });
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

/**
 * Capability-driven event routing (Core Event RSVP program). The PTA
 * household events endpoint is used exactly when the org's RSVP capability
 * says mode "household" AND this caller actually holds the household identity
 * (canRsvp) — everyone else (Community/Union members, staff-only logins, HOA,
 * PTA staff without a household link) reads the generic endpoint, whose
 * per-event `rsvp` block says what, if anything, they can do. The legacy
 * `hasMemberIdentity` two-way switch survives ONLY as the fallback for a
 * cached organizations response predating the rsvp capability.
 */
export function getEventsForOrganization(
  organizationId: string,
  rsvpCapability: RsvpCapability | undefined,
  legacyHasMemberIdentity: boolean
): Promise<PtaEvent[] | MobileEvent[]> {
  if (rsvpCapability) {
    return rsvpCapability.mode === 'household' && rsvpCapability.canRsvp
      ? getPtaEvents(organizationId)
      : getEvents(organizationId);
  }
  return legacyHasMemberIdentity ? getEvents(organizationId) : getPtaEvents(organizationId);
}

/** Meeting counterpart of getEventsForOrganization — same routing rule, same
 * fallback semantics. */
export function getMeetingsForOrganization(
  organizationId: string,
  rsvpCapability: RsvpCapability | undefined,
  legacyHasMemberIdentity: boolean
): Promise<MobileMeeting[]> {
  if (rsvpCapability) {
    return rsvpCapability.mode === 'household' && rsvpCapability.canRsvp
      ? getPtaMeetings(organizationId)
      : getMeetings(organizationId);
  }
  return legacyHasMemberIdentity ? getMeetings(organizationId) : getPtaMeetings(organizationId);
}

// ── CORE-GIVE-L: Giving (member self-service only; §64 checkout happens in
// the system browser — no card entry in-app) ─────────────────────────────

export interface GivingFund {
  id: string;
  name: string;
  description: string | null;
  suggestedAmounts: number[];
  minimumAmount: number | null;
  maximumAmount: number | null;
  allowRecurring: boolean;
  allowPledges: boolean;
}

export interface GivingSchedule {
  id: string;
  fundName: string;
  amount: number;
  frequency: string;
  status: string;
  nextContributionDate: string | null;
  paymentMethodDescriptor: string | null;
  /** MOBILE-COVER: whether this schedule currently covers processing costs.
   * Optional so the app tolerates a portal that predates the field. */
  coverProcessingCosts?: boolean;
}

/** MOBILE-COVER: the org's voluntary processing-cost coverage offer. The
 * rate fields feed the DISPLAYED estimate only (via coverage-math.ts) — the
 * server re-quotes authoritatively at checkout, so nothing the app computes
 * is ever charged. */
export interface GivingCoverageOffer {
  offered: boolean;
  percentBps: number;
  fixedCents: number;
}

export interface GivingPledge {
  id: string;
  fundId: string;
  fundName: string;
  campaignName: string | null;
  pledged: number;
  contributed: number;
  remainingTowardPledge: number;
  progressPercent: number;
  status: string;
}

export interface GivingStatement {
  id: string;
  year: number;
  version: number;
  status: string;
  total: number;
}

export interface GivingHistoryRow {
  id: string;
  contributionNumber: string | null;
  amount: number;
  refundedAmount: number | null;
  date: string;
  designation: string;
}

export type GivingSummary =
  | { enabled: false }
  | {
      enabled: true;
      terminology: string;
      yearTotal: number;
      /** Optional so the app tolerates a portal that predates MOBILE-COVER. */
      coverage?: GivingCoverageOffer;
      funds: GivingFund[];
      history: GivingHistoryRow[];
      schedules: GivingSchedule[];
      pledges: GivingPledge[];
      statements: GivingStatement[];
    };

export function getGiving(organizationId: string) {
  return apiFetch<GivingSummary>(`/api/mobile/giving?organizationId=${encodeURIComponent(organizationId)}`);
}

/** MOBILE-COVER §4: the ONLY fee-related thing the app may send is the
 * boolean opt-in — never an amount, rate, or total. Omitted when false so
 * the request is byte-identical to pre-coverage builds. */
export function startGivingCheckout(
  organizationId: string,
  fundId: string,
  amount: number,
  pledgeId?: string | null,
  coverProcessingCosts?: boolean
) {
  return apiFetch<{ url: string }>(`/api/mobile/giving/checkout`, {
    method: 'POST',
    body: JSON.stringify({
      organizationId,
      fundId,
      amount,
      pledgeId: pledgeId ?? null,
      ...(coverProcessingCosts ? { coverProcessingCosts: true } : {}),
    }),
  });
}

export function startRecurringGivingCheckout(
  organizationId: string,
  fundId: string,
  amount: number,
  frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY',
  confirmDuplicate: boolean = false,
  coverProcessingCosts?: boolean
) {
  return apiFetch<{ url: string }>(`/api/mobile/giving/recurring/checkout`, {
    method: 'POST',
    body: JSON.stringify({
      organizationId,
      fundId,
      amount,
      frequency,
      confirmDuplicate,
      ...(coverProcessingCosts ? { coverProcessingCosts: true } : {}),
    }),
  });
}

export function manageRecurringGiving(
  organizationId: string,
  scheduleId: string,
  action: 'pause' | 'resume' | 'cancel' | 'change-amount' | 'retry' | 'coverage',
  amount?: number,
  coverProcessingCosts?: boolean
) {
  return apiFetch<Record<string, never>>(`/api/mobile/giving/recurring/manage`, {
    method: 'POST',
    body: JSON.stringify({
      organizationId,
      scheduleId,
      action,
      amount: amount ?? null,
      ...(action === 'coverage' ? { coverProcessingCosts: coverProcessingCosts === true } : {}),
    }),
  });
}

export function createGivingPledge(organizationId: string, fundId: string, amount: number) {
  return apiFetch<{ id: string }>(`/api/mobile/giving/pledges`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, fundId, amount }),
  });
}

export function getGivingStatementUrl(organizationId: string, statementId: string) {
  return apiFetch<{ url: string }>(
    `/api/mobile/giving/statements/${encodeURIComponent(statementId)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

// ── Union Case Center (member self-service) ─────────────────────────────

export type UnionCaseStatus = 'NEW' | 'TRIAGE' | 'ASSIGNED' | 'ACTIVE' | 'PENDING' | 'RESOLVED' | 'CLOSED' | 'WITHDRAWN';

export interface UnionCaseSummary {
  id: string;
  caseNumber: number;
  caseType: string;
  title: string;
  description: string;
  status: UnionCaseStatus;
  isFormalGrievance: boolean;
  representationRequested: boolean;
  incidentDate: string | null;
  openedAt: string;
  resolvedAt: string | null;
  resolutionSummary: string | null;
  closedAt: string | null;
  assignedToOrgMemberId: string | null;
  /** Resolved server-side (route layer, never the member-safe projection
   * itself) -- nothing about the representative beyond their display name
   * ever reaches the client. */
  representativeName: string | null;
  createdAt: string;
  updatedAt: string;
  comments: { id: string; body: string; createdAt: string }[];
  upcomingDates: { id: string; deadlineType: string; description: string | null; dueAt: string }[];
}

export function getUnionCases(organizationId: string) {
  return apiFetch<UnionCaseSummary[]>(`/api/mobile/union/cases?organizationId=${encodeURIComponent(organizationId)}`);
}

export function getUnionCase(organizationId: string, caseId: string) {
  return apiFetch<UnionCaseSummary>(
    `/api/mobile/union/cases/${encodeURIComponent(caseId)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

/** Mirrors UnionCaseIntakeForm.tsx's CASE_TYPES on the web -- same
 * free-text caseType vocabulary the staff dashboard uses, never a
 * duplicated taxonomy. Submitting never files a formal grievance on its
 * own (see createUnionCaseIntake); this list deliberately doesn't lead
 * with grievance-procedure language. */
export const UNION_CASE_TYPES: { value: string; label: string }[] = [
  { value: 'GENERAL_ISSUE', label: 'Something else going on' },
  { value: 'DISCIPLINE', label: 'Discipline or write-up' },
  { value: 'SAFETY', label: 'Safety concern' },
  { value: 'CONTRACT_VIOLATION', label: 'Contract violation' },
  { value: 'SCHEDULING', label: 'Scheduling or hours' },
  { value: 'HARASSMENT', label: 'Harassment or mistreatment' },
  { value: 'GRIEVANCE', label: 'I want to file a grievance' },
  { value: 'OTHER', label: 'Other' },
];

export function createUnionCase(input: {
  organizationId: string;
  caseType: string;
  title: string;
  description: string;
  incidentDate?: string | null;
  representationRequested?: boolean;
}) {
  return apiFetch<UnionCaseSummary>('/api/mobile/union/cases', { method: 'POST', body: JSON.stringify(input) });
}

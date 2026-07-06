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

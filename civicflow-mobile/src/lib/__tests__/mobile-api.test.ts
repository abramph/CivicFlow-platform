import {
  approvePtaHourEntry,
  cancelPtaVolunteerSlot,
  checkInPtaVolunteer,
  checkOutPtaVolunteer,
  claimPtaVolunteerSlot,
  getAnnouncements,
  getCampaigns,
  getConversation,
  getConversations,
  getPaymentLinkSlug,
  getPaymentMethods,
  getPendingPtaHourEntries,
  getProfile,
  getPtaVolunteerCommitments,
  getPtaVolunteerHours,
  getPtaVolunteerOpportunities,
  getPtaVolunteerOpportunity,
  getPtaVolunteerRoster,
  getPtaVolunteerToday,
  markAnnouncementRead,
  sendConversationMessage,
  setPtaVolunteerAttendance,
  submitPaymentReport,
  updateProfile,
} from '@/lib/mobile-api';

const mockApiFetch = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('mobile-api', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('getConversations requests the org-scoped conversation list', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    await getConversations('org-1');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/messages/conversations?organizationId=org-1');
  });

  it('getConversation requests a specific thread scoped to the org', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'conv-1', subject: null, participants: [], messages: [] });
    await getConversation('org-1', 'conv-1');
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/mobile/messages/conversations/conv-1?organizationId=org-1'
    );
  });

  it('sendConversationMessage posts the body to the thread', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'msg-1', createdAt: '2026-01-01T00:00:00.000Z' });
    await sendConversationMessage('org-1', 'conv-1', 'hello there');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/messages/conversations/conv-1/messages', {
      method: 'POST',
      body: JSON.stringify({ organizationId: 'org-1', body: 'hello there' }),
    });
  });

  it('getAnnouncements requests the org-scoped announcement list', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    await getAnnouncements('org-1');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/announcements?organizationId=org-1');
  });

  it('markAnnouncementRead posts to the campaign-specific read endpoint', async () => {
    mockApiFetch.mockResolvedValueOnce(undefined);
    await markAnnouncementRead('org-1', 'campaign-1');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/announcements/campaign-1/read', {
      method: 'POST',
      body: JSON.stringify({ organizationId: 'org-1' }),
    });
  });

  it('getProfile requests the org-scoped profile', async () => {
    mockApiFetch.mockResolvedValueOnce({});
    await getProfile('org-1');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/profile?organizationId=org-1');
  });

  it('updateProfile PATCHes only the provided preference fields', async () => {
    mockApiFetch.mockResolvedValueOnce({});
    await updateProfile('org-1', { commsSmsEnabled: true });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/profile', {
      method: 'PATCH',
      body: JSON.stringify({ organizationId: 'org-1', commsSmsEnabled: true }),
    });
  });

  it('submitPaymentReport includes category and omits duesChargeId for non-dues categories', async () => {
    mockApiFetch.mockResolvedValueOnce({});
    await submitPaymentReport({
      organizationId: 'org-1',
      amount: '50',
      category: 'DONATION',
      paymentMethod: 'CASH',
      paymentDate: '2026-01-01T00:00:00.000Z',
    });

    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe('/api/mobile/report-payment');
    const form = options.body as FormData;
    expect(form.get('category')).toBe('DONATION');
    expect(form.get('duesChargeId')).toBeNull();
  });

  it('submitPaymentReport includes duesChargeId when the category is MEMBERSHIP_DUES and one is chosen', async () => {
    mockApiFetch.mockResolvedValueOnce({});
    await submitPaymentReport({
      organizationId: 'org-1',
      amount: '50',
      category: 'MEMBERSHIP_DUES',
      duesChargeId: 'charge-1',
      paymentMethod: 'CASH',
      paymentDate: '2026-01-01T00:00:00.000Z',
    });

    const [, options] = mockApiFetch.mock.calls[0];
    const form = options.body as FormData;
    expect(form.get('duesChargeId')).toBe('charge-1');
  });

  it('getCampaigns requests the org-scoped campaign list', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    await getCampaigns('org-1');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/campaigns?organizationId=org-1');
  });

  it('getPaymentMethods requests the org-scoped payment methods list', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    await getPaymentMethods('org-1');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/payment-methods?organizationId=org-1');
  });

  it('getPaymentLinkSlug requests a campaign-scoped link', async () => {
    mockApiFetch.mockResolvedValueOnce({ slug: null });
    await getPaymentLinkSlug('org-1', { campaignId: 'camp-1' });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/payment-link?organizationId=org-1&campaignId=camp-1');
  });

  it('getPaymentLinkSlug requests an event-scoped link', async () => {
    mockApiFetch.mockResolvedValueOnce({ slug: null });
    await getPaymentLinkSlug('org-1', { eventId: 'event-1' });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/payment-link?organizationId=org-1&eventId=event-1');
  });

  it('getPaymentLinkSlug requests the org-wide dues-in-advance link', async () => {
    mockApiFetch.mockResolvedValueOnce({ slug: null });
    await getPaymentLinkSlug('org-1', { dues: true });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/payment-link?organizationId=org-1&dues=true');
  });

  describe('PTA volunteers — parent workflow', () => {
    it('getPtaVolunteerOpportunities requests the org-scoped open-opportunity list', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getPtaVolunteerOpportunities('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/opportunities?organizationId=org-1');
    });

    it('getPtaVolunteerOpportunity requests a single opportunity scoped to the org', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await getPtaVolunteerOpportunity('org-1', 'opp-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/opportunities/opp-1?organizationId=org-1');
    });

    it('claimPtaVolunteerSlot never sends a householdAdultId — only organizationId, resolved server-side', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await claimPtaVolunteerSlot('org-1', 'slot-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/slots/slot-1/claim', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1' }),
      });
    });

    it('cancelPtaVolunteerSlot sends an optional reason, defaulting to null', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await cancelPtaVolunteerSlot('org-1', 'slot-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/slots/slot-1/cancel', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', reason: null }),
      });
    });

    it('getPtaVolunteerCommitments requests the caller\'s own commitment history', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getPtaVolunteerCommitments('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/my-commitments?organizationId=org-1');
    });

    it('getPtaVolunteerHours requests the caller\'s own household totals', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await getPtaVolunteerHours('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/hours?organizationId=org-1');
    });
  });

  describe('PTA volunteers — limited officer workflow', () => {
    it('getPtaVolunteerToday requests the event-day staffing summary', async () => {
      mockApiFetch.mockResolvedValueOnce({ opportunities: [], understaffedShiftCount: 0, pendingHourApprovalCount: 0 });
      await getPtaVolunteerToday('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/today?organizationId=org-1');
    });

    it('getPtaVolunteerRoster requests the full roster for one opportunity', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await getPtaVolunteerRoster('org-1', 'opp-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/opportunities/opp-1/roster?organizationId=org-1');
    });

    it('checkInPtaVolunteer and checkOutPtaVolunteer post to their own idempotent endpoints', async () => {
      mockApiFetch.mockResolvedValue({});
      await checkInPtaVolunteer('org-1', 'signup-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/signups/signup-1/checkin', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1' }),
      });

      await checkOutPtaVolunteer('org-1', 'signup-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/signups/signup-1/checkout', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1' }),
      });
    });

    it('setPtaVolunteerAttendance sends the outcome status and optional manual minutes', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await setPtaVolunteerAttendance('org-1', 'signup-1', 'NO_SHOW');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/signups/signup-1/attendance', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', status: 'NO_SHOW', manualMinutes: null }),
      });
    });

    it('getPendingPtaHourEntries and approvePtaHourEntry hit the hour-approval queue', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getPendingPtaHourEntries('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/hour-entries/pending?organizationId=org-1');

      mockApiFetch.mockResolvedValueOnce({});
      await approvePtaHourEntry('org-1', 'entry-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/volunteers/hour-entries/entry-1/approve', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', adjustedMinutes: null }),
      });
    });
  });
});

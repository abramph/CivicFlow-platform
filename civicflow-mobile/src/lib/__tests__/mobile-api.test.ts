import {
  approvePtaHourEntry,
  cancelPtaVolunteerSlot,
  checkInPtaVolunteer,
  checkOutPtaVolunteer,
  claimPtaVolunteerSlot,
  getAnnouncements,
  getAnnouncementsForIdentity,
  getCampaigns,
  getConversation,
  getConversations,
  getEventsForOrganization,
  getMeetingsForOrganization,
  getPaymentLinkSlug,
  getPaymentMethods,
  getPendingPtaHourEntries,
  getProfile,
  getPtaAnnouncements,
  getPtaDocuments,
  getMinutes,
  getPtaDues,
  getPtaEvents,
  getPtaVolunteerCommitments,
  getPtaVolunteerHours,
  getPtaVolunteerOpportunities,
  getPtaVolunteerOpportunity,
  getPtaVolunteerRoster,
  getPtaVolunteerToday,
  manageRecurringGiving,
  markAnnouncementRead,
  markAnnouncementReadForIdentity,
  markPtaAnnouncementRead,
  reportPtaDuesPayment,
  sendConversationMessage,
  setEventRsvp,
  setMeetingRsvp,
  setPtaEventRsvp,
  setPtaMeetingRsvp,
  setPtaVolunteerAttendance,
  startGivingCheckout,
  startRecurringGivingCheckout,
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

  describe('PTA parent parity — announcements, events, dues, minutes, documents', () => {
    it('getPtaAnnouncements and markPtaAnnouncementRead hit the household-authorized bridge routes', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getPtaAnnouncements('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/announcements?organizationId=org-1');

      mockApiFetch.mockResolvedValueOnce(undefined);
      await markPtaAnnouncementRead('org-1', 'campaign-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/announcements/campaign-1/read', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1' }),
      });
    });

    it('getPtaEvents requests the household-scoped event list with RSVP state', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getPtaEvents('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/events?organizationId=org-1');
    });

    it('setPtaEventRsvp defaults attendeeCount to 1 and posts the chosen status', async () => {
      mockApiFetch.mockResolvedValueOnce({ status: 'GOING', attendeeCount: 1 });
      await setPtaEventRsvp('org-1', 'event-1', 'GOING');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/events/event-1/rsvp', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', status: 'GOING', attendeeCount: 1 }),
      });
    });

    it('setPtaEventRsvp forwards an explicit attendeeCount', async () => {
      mockApiFetch.mockResolvedValueOnce({ status: 'GOING', attendeeCount: 3 });
      await setPtaEventRsvp('org-1', 'event-1', 'GOING', 3);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/events/event-1/rsvp', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', status: 'GOING', attendeeCount: 3 }),
      });
    });

    it('getPtaDues requests the household billing-identity summary', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await getPtaDues('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/dues?organizationId=org-1');
    });

    it('reportPtaDuesPayment posts the full report body, including a null duesChargeId when unlinked', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await reportPtaDuesPayment({
        organizationId: 'org-1',
        duesChargeId: null,
        amountCents: 2500,
        paymentMethod: 'CASH',
        paymentDate: '2026-01-01T00:00:00.000Z',
      });
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/dues/report-payment', {
        method: 'POST',
        body: JSON.stringify({
          organizationId: 'org-1',
          duesChargeId: null,
          amountCents: 2500,
          paymentMethod: 'CASH',
          paymentDate: '2026-01-01T00:00:00.000Z',
        }),
      });
    });

    it('getMinutes and getPtaDocuments request the authorized read-only lists', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getMinutes('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/minutes?organizationId=org-1');

      mockApiFetch.mockResolvedValueOnce([]);
      await getPtaDocuments('org-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/documents?organizationId=org-1');
    });
  });

  describe('identity routing — conventional OrgMember vs. PTA household parent', () => {
    it('getAnnouncementsForIdentity calls the conventional route when hasMemberIdentity is true', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getAnnouncementsForIdentity('org-1', true);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/announcements?organizationId=org-1');
    });

    it('getAnnouncementsForIdentity calls the PTA bridge route when hasMemberIdentity is false', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getAnnouncementsForIdentity('org-1', false);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/announcements?organizationId=org-1');
    });

    it('markAnnouncementReadForIdentity routes to the matching read endpoint for each identity', async () => {
      mockApiFetch.mockResolvedValueOnce(undefined);
      await markAnnouncementReadForIdentity('org-1', 'campaign-1', true);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/announcements/campaign-1/read', expect.anything());

      mockApiFetch.mockResolvedValueOnce(undefined);
      await markAnnouncementReadForIdentity('org-1', 'campaign-1', false);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/announcements/campaign-1/read', expect.anything());
    });

  });

  describe('capability-driven event routing (Core Event RSVP)', () => {
    it('uses the PTA household endpoint only when mode is household AND the caller can RSVP', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getEventsForOrganization('org-1', { mode: 'household', guestCounts: true, canRsvp: true }, false);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/events?organizationId=org-1');
    });

    it('routes a household-mode org WITHOUT household identity (PTA staff) to the generic endpoint', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getEventsForOrganization('org-1', { mode: 'household', guestCounts: true, canRsvp: false }, true);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/events?organizationId=org-1');
    });

    it('routes individual and none modes to the generic endpoint', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getEventsForOrganization('org-1', { mode: 'individual', guestCounts: false, canRsvp: true }, false);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/events?organizationId=org-1');

      mockApiFetch.mockResolvedValueOnce([]);
      await getEventsForOrganization('org-hoa', { mode: 'none', guestCounts: false, canRsvp: false }, true);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/events?organizationId=org-hoa');
    });

    it('falls back to the legacy hasMemberIdentity switch only when the rsvp capability is absent', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getEventsForOrganization('org-1', undefined, true);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/events?organizationId=org-1');

      mockApiFetch.mockResolvedValueOnce([]);
      await getEventsForOrganization('org-1', undefined, false);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/events?organizationId=org-1');
    });

    it('setEventRsvp posts only organizationId and status — the member is server-resolved', async () => {
      mockApiFetch.mockResolvedValueOnce({ mode: 'individual', canRsvp: true, guestCounts: false, response: { status: 'GOING', attendeeCount: 1 }, subject: { type: 'member', id: 'member-1' } });
      await setEventRsvp('org-1', 'event-1', 'GOING');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/events/event-1/rsvp', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', status: 'GOING' }),
      });
    });
  });

  describe('capability-driven meeting routing (Core Meeting RSVP)', () => {
    it('routes household mode with household identity to the PTA meetings endpoint, everything else generic', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getMeetingsForOrganization('org-1', { mode: 'household', guestCounts: true, canRsvp: true }, false);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/meetings?organizationId=org-1');

      mockApiFetch.mockResolvedValueOnce([]);
      await getMeetingsForOrganization('org-1', { mode: 'household', guestCounts: true, canRsvp: false }, true);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/meetings?organizationId=org-1');

      mockApiFetch.mockResolvedValueOnce([]);
      await getMeetingsForOrganization('org-1', { mode: 'individual', guestCounts: false, canRsvp: true }, false);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/meetings?organizationId=org-1');
    });

    it('falls back to the legacy hasMemberIdentity switch only without a capability', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      await getMeetingsForOrganization('org-1', undefined, false);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/meetings?organizationId=org-1');
    });

    it('setMeetingRsvp posts only organizationId and status; setPtaMeetingRsvp forwards attendeeCount defaulting to 1', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      await setMeetingRsvp('org-1', 'meeting-1', 'GOING');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/meetings/meeting-1/rsvp', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', status: 'GOING' }),
      });

      mockApiFetch.mockResolvedValueOnce({ status: 'GOING', attendeeCount: 3 });
      await setPtaMeetingRsvp('org-1', 'meeting-1', 'GOING', 3);
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/meetings/meeting-1/rsvp', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', status: 'GOING', attendeeCount: 3 }),
      });

      mockApiFetch.mockResolvedValueOnce({ status: 'GOING', attendeeCount: 1 });
      await setPtaMeetingRsvp('org-1', 'meeting-1', 'GOING');
      expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/pta/meetings/meeting-1/rsvp', {
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org-1', status: 'GOING', attendeeCount: 1 }),
      });
    });
  });
});

/**
 * MOBILE-COVER §4/§12 — the request bodies are the security contract: the
 * ONLY fee-related field the app can ever emit is the literal boolean
 * `coverProcessingCosts: true`. No amount/rate/total/price/account field
 * exists in any signature, and false is OMITTED so pre-coverage builds and
 * declined offers produce byte-identical requests.
 */
describe('mobile-api — processing-cost coverage contract', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('startGivingCheckout with coverage ON sends only the boolean alongside the base amount', async () => {
    mockApiFetch.mockResolvedValueOnce({ url: 'https://checkout' });
    await startGivingCheckout('org-1', 'fund-1', 25, null, true);
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/giving/checkout', {
      method: 'POST',
      body: JSON.stringify({ organizationId: 'org-1', fundId: 'fund-1', amount: 25, pledgeId: null, coverProcessingCosts: true }),
    });
  });

  it('startGivingCheckout with coverage OFF omits the field entirely', async () => {
    mockApiFetch.mockResolvedValueOnce({ url: 'https://checkout' });
    await startGivingCheckout('org-1', 'fund-1', 25, null, false);
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/giving/checkout', {
      method: 'POST',
      body: JSON.stringify({ organizationId: 'org-1', fundId: 'fund-1', amount: 25, pledgeId: null }),
    });
  });

  it('startRecurringGivingCheckout carries the preference the same way', async () => {
    mockApiFetch.mockResolvedValueOnce({ url: 'https://checkout' });
    await startRecurringGivingCheckout('org-1', 'fund-1', 50, 'MONTHLY', false, true);
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/giving/recurring/checkout', {
      method: 'POST',
      body: JSON.stringify({ organizationId: 'org-1', fundId: 'fund-1', amount: 50, frequency: 'MONTHLY', confirmDuplicate: false, coverProcessingCosts: true }),
    });
  });

  it("manageRecurringGiving action 'coverage' sends an explicit boolean (false included — turning OFF must always transmit)", async () => {
    mockApiFetch.mockResolvedValueOnce({});
    await manageRecurringGiving('org-1', 'sched-1', 'coverage', undefined, false);
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/giving/recurring/manage', {
      method: 'POST',
      body: JSON.stringify({ organizationId: 'org-1', scheduleId: 'sched-1', action: 'coverage', amount: null, coverProcessingCosts: false }),
    });
  });

  it('non-coverage manage actions never gain the coverage field', async () => {
    mockApiFetch.mockResolvedValueOnce({});
    await manageRecurringGiving('org-1', 'sched-1', 'pause');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/mobile/giving/recurring/manage', {
      method: 'POST',
      body: JSON.stringify({ organizationId: 'org-1', scheduleId: 'sched-1', action: 'pause', amount: null }),
    });
  });
});

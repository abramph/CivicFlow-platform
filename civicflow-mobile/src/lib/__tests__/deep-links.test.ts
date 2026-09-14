import { resolveAllowedDeepLinkPath } from '@/lib/deep-links';

describe('resolveAllowedDeepLinkPath', () => {
  it('resolves known custom-scheme destinations', () => {
    expect(resolveAllowedDeepLinkPath('unestra://report-payment')).toBe('/report-payment');
    expect(resolveAllowedDeepLinkPath('unestra://dues')).toBe('/dues');
    expect(resolveAllowedDeepLinkPath('unestra://announcements')).toBe('/announcements');
    expect(resolveAllowedDeepLinkPath('unestra://events')).toBe('/events');
  });

  it('resolves an organization switch link', () => {
    expect(resolveAllowedDeepLinkPath('unestra://organization/abc123')).toBe('/organization/abc123');
  });

  it('resolves a universal link from the new canonical domain', () => {
    expect(resolveAllowedDeepLinkPath('https://app.getunestra.com/dues')).toBe('/dues');
  });

  it('still resolves a universal link from the legacy domain during migration', () => {
    expect(resolveAllowedDeepLinkPath('https://app.civicflowapp.com/dues')).toBe('/dues');
  });

  it('rejects a universal-link-shaped URL from an untrusted domain', () => {
    expect(resolveAllowedDeepLinkPath('https://evil.example.com/dues')).toBeNull();
  });

  it('rejects unknown destinations', () => {
    expect(resolveAllowedDeepLinkPath('unestra://some-unknown-screen')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(resolveAllowedDeepLinkPath('not a url')).toBeNull();
  });

  it('resolves the new member engagement destinations', () => {
    expect(resolveAllowedDeepLinkPath('unestra://inbox')).toBe('/inbox');
    expect(resolveAllowedDeepLinkPath('unestra://conversation/conv-abc123')).toBe('/conversation/conv-abc123');
    expect(resolveAllowedDeepLinkPath('unestra://announcement/campaign-abc123')).toBe('/announcement/campaign-abc123');
    expect(resolveAllowedDeepLinkPath('unestra://event/event-abc123')).toBe('/event/event-abc123');
    expect(resolveAllowedDeepLinkPath('unestra://payments')).toBe('/payments');
    expect(resolveAllowedDeepLinkPath('unestra://profile')).toBe('/profile');
  });

  it('resolves the new destinations from a universal link too', () => {
    expect(resolveAllowedDeepLinkPath('https://app.civicflowapp.com/conversation/conv-abc123')).toBe(
      '/conversation/conv-abc123'
    );
  });

  it('resolves the Make a Payment destinations', () => {
    expect(resolveAllowedDeepLinkPath('unestra://make-payment')).toBe('/make-payment');
    expect(resolveAllowedDeepLinkPath('unestra://make-payment/dues')).toBe('/make-payment/dues');
    expect(resolveAllowedDeepLinkPath('unestra://make-payment/campaign/camp-abc123')).toBe(
      '/make-payment/campaign/camp-abc123'
    );
    expect(resolveAllowedDeepLinkPath('unestra://make-payment/event/event-abc123')).toBe(
      '/make-payment/event/event-abc123'
    );
  });

  it('resolves the QR attendance destinations', () => {
    expect(resolveAllowedDeepLinkPath('unestra://attendance-scan')).toBe('/attendance-scan');
    expect(resolveAllowedDeepLinkPath('unestra://attendance-history')).toBe('/attendance-history');
    expect(resolveAllowedDeepLinkPath('https://app.civicflowapp.com/attendance-scan')).toBe('/attendance-scan');
  });

  describe('direct-message push deep link (regression)', () => {
    // MUST mirror civicflow-portal's notifyNewMessageParticipants(), which now
    // emits this exact shape for the DM PUSH. If the server format changes,
    // this constant must change with it — that is the point of the regression.
    const serverDmDeepLink = (conversationId: string) => `/conversation/${conversationId}`;

    it('a real DM notification resolves to the member conversation screen (not discarded)', () => {
      const link = serverDmDeepLink('conv-1');
      expect(link).toBe('/conversation/conv-1');
      // Through the REAL mobile allow-list (not mocked): resolves to the screen.
      expect(resolveAllowedDeepLinkPath(link)).toBe('/conversation/conv-1');
      // And as a universal link off either domain.
      expect(resolveAllowedDeepLinkPath('https://app.getunestra.com/conversation/conv-1')).toBe('/conversation/conv-1');
    });

    it('the old staff-web /messages/{id} path is NOT a member deep link (why the bug discarded it)', () => {
      expect(resolveAllowedDeepLinkPath('/messages/conv-1')).toBeNull();
      expect(resolveAllowedDeepLinkPath('unestra://messages/conv-1')).toBeNull();
    });
  });
});

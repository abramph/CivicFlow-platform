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

  it('resolves a universal link from the trusted domain', () => {
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
});

import { resolveAllowedDeepLinkPath } from '@/lib/deep-links';

describe('resolveAllowedDeepLinkPath', () => {
  it('resolves known custom-scheme destinations', () => {
    expect(resolveAllowedDeepLinkPath('civicflow://report-payment')).toBe('/report-payment');
    expect(resolveAllowedDeepLinkPath('civicflow://dues')).toBe('/dues');
    expect(resolveAllowedDeepLinkPath('civicflow://announcements')).toBe('/announcements');
    expect(resolveAllowedDeepLinkPath('civicflow://events')).toBe('/events');
  });

  it('resolves an organization switch link', () => {
    expect(resolveAllowedDeepLinkPath('civicflow://organization/abc123')).toBe('/organization/abc123');
  });

  it('resolves a universal link from the trusted domain', () => {
    expect(resolveAllowedDeepLinkPath('https://app.civicflowapp.com/dues')).toBe('/dues');
  });

  it('rejects a universal-link-shaped URL from an untrusted domain', () => {
    expect(resolveAllowedDeepLinkPath('https://evil.example.com/dues')).toBeNull();
  });

  it('rejects unknown destinations', () => {
    expect(resolveAllowedDeepLinkPath('civicflow://some-unknown-screen')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(resolveAllowedDeepLinkPath('not a url')).toBeNull();
  });
});

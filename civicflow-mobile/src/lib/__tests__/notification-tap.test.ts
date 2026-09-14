import { PLATFORM_DEEP_LINK_ALLOWLIST, resolveNotificationTapAction, type NotificationTapContext } from '../notification-tap';
import { resolveAllowedDeepLinkPath } from '@/lib/deep-links';

const ctx: NotificationTapContext = {
  accessibleOrganizationIds: ['org-1', 'org-2'],
  selectedOrganizationId: 'org-1',
};

describe('platform deep-link contract (mobile)', () => {
  const noOrgCtx: NotificationTapContext = { accessibleOrganizationIds: [], selectedOrganizationId: null };

  it('mirrors the server allow-list (only /inbox today)', () => {
    expect(PLATFORM_DEEP_LINK_ALLOWLIST).toEqual(['/inbox']);
  });

  // Every advertised platform route must survive BOTH the mobile deep-link
  // allow-list AND the platform-scoped resolver.
  it.each(PLATFORM_DEEP_LINK_ALLOWLIST)('route %s resolves and navigates under platform scope', (route) => {
    expect(resolveAllowedDeepLinkPath(route)).toBe(route);
    expect(resolveNotificationTapAction({ deepLink: route, notificationScope: 'platform' }, noOrgCtx)).toEqual({
      type: 'navigate',
      deepLink: route,
    });
  });

  it('an unapproved platform route fails closed at both gates', () => {
    expect(resolveAllowedDeepLinkPath('/settings/billing')).toBeNull();
    expect(resolveNotificationTapAction({ deepLink: '/settings/billing', notificationScope: 'platform' }, noOrgCtx)).toEqual({
      type: 'unavailable',
    });
  });
});

describe('resolveNotificationTapAction', () => {
  it('ignores a payload with no (or blank) deep link', () => {
    expect(resolveNotificationTapAction({ organizationId: 'org-1' }, ctx)).toEqual({ type: 'ignore' });
    expect(resolveNotificationTapAction({ deepLink: '   ', organizationId: 'org-1' }, ctx)).toEqual({ type: 'ignore' });
    expect(resolveNotificationTapAction(null, ctx)).toEqual({ type: 'ignore' });
  });

  it('FAILS CLOSED for an org-scoped payload with no organizationId (older payloads no longer navigate)', () => {
    expect(resolveNotificationTapAction({ deepLink: '/event/evt-1' }, ctx)).toEqual({ type: 'unavailable' });
  });

  it('fails closed for a missing/blank/malformed organizationId', () => {
    expect(resolveNotificationTapAction({ deepLink: '/x', organizationId: '   ' }, ctx)).toEqual({ type: 'unavailable' });
    expect(resolveNotificationTapAction({ deepLink: '/x', organizationId: 99 }, ctx)).toEqual({ type: 'unavailable' });
  });

  it('fails closed for an org the user cannot access (cross-tenant / removed)', () => {
    expect(resolveNotificationTapAction({ deepLink: '/event/secret', organizationId: 'org-x' }, ctx)).toEqual({ type: 'unavailable' });
  });

  it('navigates directly when the payload org is the one already selected', () => {
    expect(resolveNotificationTapAction({ deepLink: '/event/evt-1', organizationId: 'org-1' }, ctx)).toEqual({
      type: 'navigate',
      deepLink: '/event/evt-1',
    });
  });

  it('switches org first when the payload targets a different accessible org (trimming the id)', () => {
    expect(resolveNotificationTapAction({ deepLink: '/announce/a1', organizationId: '  org-2 ' }, ctx)).toEqual({
      type: 'switchThenNavigate',
      organizationId: 'org-2',
      deepLink: '/announce/a1',
    });
  });

  describe('platform scope', () => {
    it('navigates a platform-scoped notification to an APPROVED global route (no org required)', () => {
      const noOrgCtx: NotificationTapContext = { accessibleOrganizationIds: [], selectedOrganizationId: null };
      expect(resolveNotificationTapAction({ deepLink: '/inbox', notificationScope: 'platform' }, noOrgCtx)).toEqual({
        type: 'navigate',
        deepLink: '/inbox',
      });
    });

    it('fails closed for a platform-scoped notification pointing at a non-approved route', () => {
      expect(resolveNotificationTapAction({ deepLink: '/union-cases/secret', notificationScope: 'platform' }, ctx)).toEqual({
        type: 'unavailable',
      });
    });

    it('does NOT treat the absence of a scope as platform trust (org rules still apply)', () => {
      // No scope + no org → org-scoped → fail closed, never global navigate.
      expect(resolveNotificationTapAction({ deepLink: '/inbox' }, ctx)).toEqual({ type: 'unavailable' });
    });
  });
});

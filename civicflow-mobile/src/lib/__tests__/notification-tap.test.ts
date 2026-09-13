import { resolveNotificationTapAction, type NotificationTapContext } from '../notification-tap';

const ctx: NotificationTapContext = {
  accessibleOrganizationIds: ['org-1', 'org-2'],
  selectedOrganizationId: 'org-1',
};

describe('resolveNotificationTapAction', () => {
  it('ignores a payload with no deep link', () => {
    expect(resolveNotificationTapAction({ organizationId: 'org-1' }, ctx)).toEqual({ type: 'ignore' });
    expect(resolveNotificationTapAction({}, ctx)).toEqual({ type: 'ignore' });
    expect(resolveNotificationTapAction(null, ctx)).toEqual({ type: 'ignore' });
    expect(resolveNotificationTapAction(undefined, ctx)).toEqual({ type: 'ignore' });
  });

  it('navigates directly for an older payload that carries no organizationId (backward compat)', () => {
    expect(resolveNotificationTapAction({ deepLink: '/event/evt-1' }, ctx)).toEqual({
      type: 'navigate',
      deepLink: '/event/evt-1',
    });
  });

  it('navigates directly when the payload org is the one already selected', () => {
    expect(resolveNotificationTapAction({ deepLink: '/event/evt-1', organizationId: 'org-1' }, ctx)).toEqual({
      type: 'navigate',
      deepLink: '/event/evt-1',
    });
  });

  it('switches org first when the payload targets a different accessible org', () => {
    expect(resolveNotificationTapAction({ deepLink: '/announce/a1', organizationId: 'org-2' }, ctx)).toEqual({
      type: 'switchThenNavigate',
      organizationId: 'org-2',
      deepLink: '/announce/a1',
    });
  });

  it('fails closed to unavailable for an org the user cannot access (cross-tenant / removed)', () => {
    expect(resolveNotificationTapAction({ deepLink: '/event/secret', organizationId: 'org-x' }, ctx)).toEqual({
      type: 'unavailable',
    });
  });

  it('fails closed when the user has no accessible orgs at all', () => {
    const empty: NotificationTapContext = { accessibleOrganizationIds: [], selectedOrganizationId: null };
    expect(resolveNotificationTapAction({ deepLink: '/x', organizationId: 'org-1' }, empty)).toEqual({
      type: 'unavailable',
    });
  });

  it('treats a blank/whitespace organizationId as absent (older payload → navigate)', () => {
    expect(resolveNotificationTapAction({ deepLink: '/x', organizationId: '   ' }, ctx)).toEqual({
      type: 'navigate',
      deepLink: '/x',
    });
  });

  it('trims a padded organizationId before matching', () => {
    expect(resolveNotificationTapAction({ deepLink: '/x', organizationId: '  org-2  ' }, ctx)).toEqual({
      type: 'switchThenNavigate',
      organizationId: 'org-2',
      deepLink: '/x',
    });
  });

  it('ignores non-string deepLink / organizationId (malformed payload)', () => {
    expect(resolveNotificationTapAction({ deepLink: 42, organizationId: 'org-1' }, ctx)).toEqual({ type: 'ignore' });
    expect(resolveNotificationTapAction({ deepLink: '/x', organizationId: 99 }, ctx)).toEqual({
      type: 'navigate',
      deepLink: '/x',
    });
  });
});

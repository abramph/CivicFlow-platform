import { render, waitFor } from '@testing-library/react-native';

import { useNotificationDeepLinks } from '../use-notification-deep-links';

const mockGetLastResponse = jest.fn();
const mockAddListener = jest.fn();
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLastResponse(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddListener(...args),
}));

const mockUseRootNavigationState = jest.fn();
const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRootNavigationState: () => mockUseRootNavigationState(),
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({ useAuth: () => mockUseAuth() }));

const mockNavigateToDeepLink = jest.fn();
jest.mock('@/lib/deep-links', () => ({ navigateToDeepLink: (...args: unknown[]) => mockNavigateToDeepLink(...args) }));

const mockSelectOrganization = jest.fn().mockResolvedValue(undefined);
const mockRefreshOrganizations = jest.fn();
const ORGS = [{ organizationId: 'org-1' }, { organizationId: 'org-2' }];

/** refreshOrganizations now returns the fresh list AND the reconciled selection. */
const refreshResult = (organizations: { organizationId: string }[], selectedOrganizationId: string | null) => ({
  organizations,
  selectedOrganizationId,
});

function auth(overrides: Record<string, unknown>) {
  return {
    status: 'signedIn',
    selectedOrganizationId: 'org-1',
    organizations: ORGS,
    selectOrganization: mockSelectOrganization,
    refreshOrganizations: mockRefreshOrganizations,
    ...overrides,
  };
}

function Harness() {
  useNotificationDeepLinks();
  return null;
}

function response(identifier: string, deepLink: string, extra?: Record<string, unknown>) {
  return { notification: { request: { identifier, content: { data: { deepLink, ...extra } } } } };
}

const INBOX = { pathname: '/inbox', params: { unavailable: '1' } };
const SWITCHER = { pathname: '/org-switcher', params: { unavailable: '1' } };

describe('useNotificationDeepLinks — live-validated, fail-closed isolation', () => {
  let listener: ((r: unknown) => void) | null = null;

  beforeEach(() => {
    listener = null;
    mockGetLastResponse.mockReset().mockResolvedValue(null);
    mockAddListener.mockReset().mockImplementation((fn: (r: unknown) => void) => {
      listener = fn;
      return { remove: jest.fn() };
    });
    mockUseRootNavigationState.mockReset().mockReturnValue({ key: 'root' });
    mockUseAuth.mockReset();
    mockNavigateToDeepLink.mockReset();
    mockRouterReplace.mockReset();
    mockSelectOrganization.mockReset().mockResolvedValue(undefined);
    mockRefreshOrganizations.mockReset().mockResolvedValue(refreshResult(ORGS, 'org-1'));
  });

  it('navigates directly when the tap targets the already-selected org (after a live access refresh)', async () => {
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());

    listener?.(response('n1', '/event/e1', { organizationId: 'org-1' }));

    await waitFor(() => expect(mockRefreshOrganizations).toHaveBeenCalled());
    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/event/e1'));
    expect(mockSelectOrganization).not.toHaveBeenCalled();
    utils.unmount();
  });

  it('opens the neutral inbox (under the still-valid current org) when the tapped org is no longer accessible', async () => {
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
    // Server now returns only org-1 — access to org-2 was removed. The user's
    // OWN org (org-1) is still valid, so the neutral landing is their inbox.
    mockRefreshOrganizations.mockResolvedValue(refreshResult([{ organizationId: 'org-1' }], 'org-1'));

    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());
    listener?.(response('n2', '/event/secret', { organizationId: 'org-2' }));

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith(INBOX));
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();
    utils.unmount();
  });

  it('fails closed to the org switcher when the live access refresh itself fails (no confirmed tenant)', async () => {
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
    mockRefreshOrganizations.mockRejectedValue(new Error('offline'));

    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());
    listener?.(response('n3', '/event/e2', { organizationId: 'org-2' }));

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith(SWITCHER));
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();
    utils.unmount();
  });

  it('routes to the org switcher (never /inbox) when the selected org was revoked and reconciled to none', async () => {
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
    // org-1 revoked; multiple others remain → reconciled to null (no tenant).
    mockRefreshOrganizations.mockResolvedValue(refreshResult([{ organizationId: 'org-2' }, { organizationId: 'org-3' }], null));

    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());
    // Tap for the now-revoked org-1.
    listener?.(response('n-revoked', '/event/e-old', { organizationId: 'org-1' }));

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith(SWITCHER));
    expect(mockRouterReplace).not.toHaveBeenCalledWith(INBOX);
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();
    utils.unmount();
  });

  it('an accessible target can still be selected and acknowledged after reconciliation', async () => {
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
    // org-1 revoked; two remain → reconciled to null, but org-2 is accessible.
    mockRefreshOrganizations.mockResolvedValue(refreshResult([{ organizationId: 'org-2' }, { organizationId: 'org-3' }], null));

    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());
    listener?.(response('n-target', '/announce/a2', { organizationId: 'org-2' }));

    // A switch to the accessible target is requested…
    await waitFor(() => expect(mockSelectOrganization).toHaveBeenCalledWith('org-2'));
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();

    // …and only after it commits does navigation happen (acknowledged).
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-2', organizations: [{ organizationId: 'org-2' }, { organizationId: 'org-3' }] }));
    await utils.rerender(<Harness />);
    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/announce/a2'));
    utils.unmount();
  });

  it('acknowledged switch: requests the org change and navigates ONLY after the selection commits', async () => {
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());

    listener?.(response('n4', '/announce/a1', { organizationId: 'org-2' }));

    await waitFor(() => expect(mockSelectOrganization).toHaveBeenCalledWith('org-2'));
    // The switch has NOT committed yet — nothing navigates.
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();

    // Simulate the org context actually committing to the target.
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-2' }));
    await utils.rerender(<Harness />);

    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/announce/a1'));
    utils.unmount();
  });

  it('holds a tap that arrives before ready and re-validates it after login', async () => {
    mockUseAuth.mockReturnValue({ status: 'loading', selectedOrganizationId: null, organizations: [], selectOrganization: mockSelectOrganization, refreshOrganizations: mockRefreshOrganizations });
    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());
    listener?.(response('n5', '/event/e3', { organizationId: 'org-1' }));

    // Nothing happens while not ready — no premature refresh or navigation.
    expect(mockRefreshOrganizations).not.toHaveBeenCalled();
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();

    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
    await utils.rerender(<Harness />);

    await waitFor(() => expect(mockRefreshOrganizations).toHaveBeenCalled());
    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/event/e3'));
    utils.unmount();
  });

  it('never handles the same notification twice', async () => {
    mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
    mockGetLastResponse.mockResolvedValue(response('dup', '/event/e4', { organizationId: 'org-1' }));

    const utils = await render(<Harness />);
    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledTimes(1));
    listener?.(response('dup', '/event/e4', { organizationId: 'org-1' }));
    expect(mockNavigateToDeepLink).toHaveBeenCalledTimes(1);
    utils.unmount();
  });

  describe('platform scope', () => {
    it('navigates an approved platform route without any org refresh', async () => {
      mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
      const utils = await render(<Harness />);
      await waitFor(() => expect(listener).not.toBeNull());

      listener?.(response('p1', '/inbox', { notificationScope: 'platform' }));

      await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/inbox'));
      expect(mockRefreshOrganizations).not.toHaveBeenCalled();
      utils.unmount();
    });

    it('opens the neutral inbox for a non-approved platform route', async () => {
      mockUseAuth.mockReturnValue(auth({ selectedOrganizationId: 'org-1' }));
      const utils = await render(<Harness />);
      await waitFor(() => expect(listener).not.toBeNull());

      listener?.(response('p2', '/union-cases/secret', { notificationScope: 'platform' }));

      await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith(INBOX));
      expect(mockNavigateToDeepLink).not.toHaveBeenCalled();
      utils.unmount();
    });
  });
});

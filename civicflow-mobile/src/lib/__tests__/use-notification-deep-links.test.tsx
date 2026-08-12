import { render, waitFor } from '@testing-library/react-native';

import { useNotificationDeepLinks } from '../use-notification-deep-links';

const mockGetLastResponse = jest.fn();
const mockAddListener = jest.fn();
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLastResponse(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddListener(...args),
}));

const mockUseRootNavigationState = jest.fn();
jest.mock('expo-router', () => ({
  useRootNavigationState: () => mockUseRootNavigationState(),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockNavigateToDeepLink = jest.fn();
jest.mock('@/lib/deep-links', () => ({
  navigateToDeepLink: (...args: unknown[]) => mockNavigateToDeepLink(...args),
}));

function Harness() {
  useNotificationDeepLinks();
  return null;
}

function response(identifier: string, deepLink: string) {
  return { notification: { request: { identifier, content: { data: { deepLink } } } } };
}

describe('useNotificationDeepLinks — deep links held until the app can navigate', () => {
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
  });

  it('navigates immediately when signed in with an org selected', async () => {
    mockUseAuth.mockReturnValue({ status: 'signedIn', selectedOrganizationId: 'org-1' });

    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());

    listener?.(response('n1', '/event/evt-1'));

    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/event/evt-1'));
    utils.unmount();
  });

  it('holds a tap that arrives during auth loading and fires it once ready — the dead-back-arrow fix', async () => {
    mockUseAuth.mockReturnValue({ status: 'loading', selectedOrganizationId: null });

    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());
    listener?.(response('n2', '/announcement/ann-1'));

    // Nothing navigates while the auth/index redirect chain is unsettled.
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();

    mockUseAuth.mockReturnValue({ status: 'signedIn', selectedOrganizationId: 'org-1' });
    await utils.rerender(<Harness />);

    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/announcement/ann-1'));
    expect(mockNavigateToDeepLink).toHaveBeenCalledTimes(1);
    utils.unmount();
  });

  it('picks up the cold-start response getLastNotificationResponseAsync delivers', async () => {
    mockUseAuth.mockReturnValue({ status: 'signedIn', selectedOrganizationId: 'org-1' });
    mockGetLastResponse.mockResolvedValue(response('cold-1', '/event/evt-9'));

    const utils = await render(<Harness />);

    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/event/evt-9'));
    utils.unmount();
  });

  it('never navigates the same notification twice (cold-start response repeated by the listener)', async () => {
    mockUseAuth.mockReturnValue({ status: 'signedIn', selectedOrganizationId: 'org-1' });
    mockGetLastResponse.mockResolvedValue(response('dup-1', '/event/evt-1'));

    const utils = await render(<Harness />);
    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledTimes(1));

    listener?.(response('dup-1', '/event/evt-1'));

    expect(mockNavigateToDeepLink).toHaveBeenCalledTimes(1);
    utils.unmount();
  });

  it('waits for the root navigator to exist even when auth is already settled', async () => {
    mockUseAuth.mockReturnValue({ status: 'signedIn', selectedOrganizationId: 'org-1' });
    mockUseRootNavigationState.mockReturnValue(undefined);

    const utils = await render(<Harness />);
    await waitFor(() => expect(listener).not.toBeNull());
    listener?.(response('n3', '/event/evt-2'));
    expect(mockNavigateToDeepLink).not.toHaveBeenCalled();

    mockUseRootNavigationState.mockReturnValue({ key: 'root' });
    await utils.rerender(<Harness />);

    await waitFor(() => expect(mockNavigateToDeepLink).toHaveBeenCalledWith('/event/evt-2'));
    utils.unmount();
  });
});

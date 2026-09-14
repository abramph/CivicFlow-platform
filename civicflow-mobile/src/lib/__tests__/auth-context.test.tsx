import { act, render, waitFor } from '@testing-library/react-native';

import { AuthProvider, reconcileSelectedOrganization, useAuth, type MobileOrganization } from '../auth-context';

const mockApiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  API_BASE_URL: 'https://app.getunestra.com',
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  ApiError: class ApiError extends Error {},
  fetchOrThrow: jest.fn(),
  registerSessionExpiredHandler: jest.fn(),
  setAccessToken: jest.fn(),
}));

// Names referenced inside a jest.mock() factory must be `mock`-prefixed.
const mockStorage = { selectedOrg: null as string | null };
const mockSetSelectedOrg = jest.fn(async (v: string) => {
  mockStorage.selectedOrg = v;
});
const mockClearSelectedOrg = jest.fn(async () => {
  mockStorage.selectedOrg = null;
});
jest.mock('@/lib/secure-storage', () => ({
  secureStorage: {
    getRefreshToken: jest.fn(async () => 'refresh-token'),
    getUser: jest.fn(async () => ({ id: 'u1', email: 'u@example.com', displayName: 'U' })),
    getSelectedOrganizationId: jest.fn(async () => mockStorage.selectedOrg),
    setSelectedOrganizationId: (...a: [string]) => mockSetSelectedOrg(...a),
    clearSelectedOrganizationId: (...a: []) => mockClearSelectedOrg(...a),
    clearRefreshToken: jest.fn(async () => {}),
    clearUser: jest.fn(async () => {}),
    setRefreshToken: jest.fn(async () => {}),
    setUser: jest.fn(async () => {}),
  },
}));

jest.mock('@/lib/push-registration', () => ({
  registerDeviceToken: jest.fn(),
  unregisterDeviceToken: jest.fn(),
}));

const org = (id: string): MobileOrganization => ({
  organizationId: id,
  organizationName: id,
  organizationLogoUrl: null,
  memberId: null,
  firstName: null,
  lastName: null,
  membershipStatus: null,
  isDelinquent: false,
  pta: null,
});

// A single live handle to the current provider's context value. Reassigned on
// every render of the mounted provider; each test mounts exactly one provider
// and unmounts it in afterEach, so there is never more than one writer.
let auth!: ReturnType<typeof useAuth>;
function Capture() {
  auth = useAuth();
  return null;
}

async function mountSignedInWith(initial: MobileOrganization[], selected: string) {
  mockStorage.selectedOrg = selected;
  mockApiFetch.mockResolvedValue(initial);
  render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(auth.status).toBe('signedIn'));
  await waitFor(() => expect(auth.selectedOrganizationId).toBe(selected));
}

describe('reconcileSelectedOrganization (pure)', () => {
  it('keeps a still-accessible selection', () => {
    expect(reconcileSelectedOrganization([org('a'), org('b')], 'a')).toBe('a');
  });
  it('auto-selects the sole remaining org when the selection was revoked', () => {
    expect(reconcileSelectedOrganization([org('b')], 'a')).toBe('b');
  });
  it('clears when revoked and multiple remain', () => {
    expect(reconcileSelectedOrganization([org('b'), org('c')], 'a')).toBeNull();
  });
  it('clears when revoked and none remain', () => {
    expect(reconcileSelectedOrganization([], 'a')).toBeNull();
  });
});

describe('AuthProvider.refreshOrganizations — revoked-access reconciliation', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockSetSelectedOrg.mockClear();
    mockClearSelectedOrg.mockClear();
    mockStorage.selectedOrg = null;
  });

  afterEach(async () => {
    // RNTL auto-cleanup unmounts the tree; flush trailing async so no late
    // effect of this provider can run under the next test.
    await act(async () => {
      await Promise.resolve();
    });
  });

  async function refresh() {
    let result!: Awaited<ReturnType<typeof auth.refreshOrganizations>>;
    await act(async () => {
      result = await auth.refreshOrganizations();
    });
    return result;
  }

  it('current organization remains accessible → selection retained', async () => {
    await mountSignedInWith([org('org-1'), org('org-2'), org('org-3')], 'org-1');
    mockApiFetch.mockResolvedValue([org('org-1'), org('org-2'), org('org-3')]);

    const result = await refresh();

    expect(result.selectedOrganizationId).toBe('org-1');
    expect(mockSetSelectedOrg).toHaveBeenLastCalledWith('org-1');
    expect(mockStorage.selectedOrg).toBe('org-1');
    await waitFor(() => expect(auth.selectedOrganizationId).toBe('org-1'));
  });

  it('current organization revoked, exactly one remains → auto-select it', async () => {
    await mountSignedInWith([org('org-1'), org('org-2')], 'org-1');
    mockApiFetch.mockResolvedValue([org('org-2')]);

    const result = await refresh();

    expect(result.selectedOrganizationId).toBe('org-2');
    expect(mockSetSelectedOrg).toHaveBeenLastCalledWith('org-2');
    expect(mockStorage.selectedOrg).toBe('org-2');
    await waitFor(() => expect(auth.selectedOrganizationId).toBe('org-2'));
  });

  it('current organization revoked, multiple remain → selection cleared (no revoked tenant)', async () => {
    await mountSignedInWith([org('org-1'), org('org-2'), org('org-3')], 'org-1');
    mockApiFetch.mockResolvedValue([org('org-2'), org('org-3')]);

    const result = await refresh();

    expect(result.selectedOrganizationId).toBeNull();
    expect(mockClearSelectedOrg).toHaveBeenCalled();
    expect(mockStorage.selectedOrg).toBeNull();
    await waitFor(() => expect(auth.selectedOrganizationId).toBeNull());
  });

  it('current organization revoked, none remain → selection cleared', async () => {
    await mountSignedInWith([org('org-1')], 'org-1');
    mockApiFetch.mockResolvedValue([]);

    const result = await refresh();

    expect(result.selectedOrganizationId).toBeNull();
    expect(mockClearSelectedOrg).toHaveBeenCalled();
    expect(mockStorage.selectedOrg).toBeNull();
    await waitFor(() => expect(auth.selectedOrganizationId).toBeNull());
  });
});

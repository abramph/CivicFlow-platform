import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ProfileScreen from '../profile';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockLogout = jest.fn();
const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetProfile = jest.fn();
const mockUpdateProfile = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

function authWith(organizationCount: number) {
  return {
    user: { id: 'user-1', email: 'officer@example.com', displayName: 'Officer' },
    organizations: Array.from({ length: organizationCount }, (_, i) => ({ organizationId: `org-${i}`, organizationName: `Org ${i}` })),
    selectedOrganization: { organizationName: 'Sample Org', memberId: 'member-1' },
    selectedOrganizationId: 'org-0',
    logout: mockLogout,
  };
}

describe('Profile screen — org switcher discoverability (GitHub #71)', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockLogout.mockReset();
    mockGetProfile.mockReset().mockResolvedValue({ commsPushEnabled: false, commsEmailEnabled: false, commsSmsEnabled: false, smsOptedOutAt: null });
    mockUpdateProfile.mockReset();
  });

  it('shows "Switch Organization" even with exactly one organization', async () => {
    mockUseAuth.mockReturnValue(authWith(1));

    await render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByLabelText('Switch organization')).toBeTruthy());
  });

  it('shows "Switch Organization" with multiple organizations too', async () => {
    mockUseAuth.mockReturnValue(authWith(3));

    await render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByLabelText('Switch organization')).toBeTruthy());
  });

  it('navigates to the org switcher when tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(1));

    await render(<ProfileScreen />);
    await waitFor(() => expect(screen.getByLabelText('Switch organization')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Switch organization'));
    expect(mockPush).toHaveBeenCalledWith('/org-switcher');
  });
});

describe('Profile screen — org owner/admin without a personal member identity', () => {
  beforeEach(() => {
    mockGetProfile.mockReset();
    mockUpdateProfile.mockReset();
  });

  it('falls back to the account name/email instead of rendering "null null"', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'owner@example.com', displayName: 'Org Owner' },
      organizations: [{ organizationId: 'org-0', organizationName: 'Sample Org' }],
      selectedOrganization: { organizationName: 'Sample Org', memberId: null, firstName: null, lastName: null },
      selectedOrganizationId: 'org-0',
      logout: mockLogout,
    });

    await render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByText('Org Owner')).toBeTruthy());
    expect(screen.getByText('owner@example.com')).toBeTruthy();
    expect(screen.queryByText('null null')).toBeNull();
    expect(mockGetProfile).not.toHaveBeenCalled();
  });
});

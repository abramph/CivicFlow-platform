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
const mockGetDues = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  getDues: (...args: unknown[]) => mockGetDues(...args),
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

describe('Profile screen — Union Membership & Dues (relocated from primary nav)', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetProfile.mockReset().mockResolvedValue({ commsPushEnabled: false, commsEmailEnabled: false, commsSmsEnabled: false, smsOptedOutAt: null });
    mockGetDues.mockReset().mockResolvedValue({ outstandingBalance: 42, isDelinquent: true, delinquentSince: null, charges: [] });
  });

  function unionAuth() {
    return {
      user: { id: 'user-1', email: 'member@example.com', displayName: 'Member' },
      organizations: [{ organizationId: 'org-union', organizationName: 'Unestra Demo Union' }],
      selectedOrganization: {
        organizationName: 'Unestra Demo Union',
        memberId: 'member-1',
        firstName: 'Alex',
        lastName: 'Reyes',
        capability: { primaryVertical: 'UNION' },
      },
      selectedOrganizationId: 'org-union',
      logout: mockLogout,
    };
  }

  it('shows a Membership & Dues section with balance and payment actions for a Union member', async () => {
    mockUseAuth.mockReturnValue(unionAuth());

    await render(<ProfileScreen />);

    await waitFor(() => expect(mockGetDues).toHaveBeenCalledWith('org-union'));
    expect(screen.getByText('Membership & Dues')).toBeTruthy();
    expect(screen.getByText('$42.00')).toBeTruthy();
    expect(screen.getByText('Past due')).toBeTruthy();
    expect(screen.getByLabelText('Make a payment')).toBeTruthy();
    expect(screen.getByLabelText('Report a payment')).toBeTruthy();
    expect(screen.getByLabelText('Payment history')).toBeTruthy();
  });

  it('navigates to the make-payment screen from the relocated section', async () => {
    mockUseAuth.mockReturnValue(unionAuth());

    await render(<ProfileScreen />);
    await waitFor(() => expect(screen.getByLabelText('Make a payment')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Make a payment'));

    expect(mockPush).toHaveBeenCalledWith('/make-payment');
  });

  it('does not show Membership & Dues or fetch dues for a non-Union member', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'member@example.com', displayName: 'Member' },
      organizations: [{ organizationId: 'org-a', organizationName: 'Riverdale Community Association' }],
      selectedOrganization: { organizationName: 'Riverdale Community Association', memberId: 'member-1', firstName: 'Jamie', lastName: 'Lee' },
      selectedOrganizationId: 'org-a',
      logout: mockLogout,
    });

    await render(<ProfileScreen />);
    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled());

    expect(screen.queryByText('Membership & Dues')).toBeNull();
    expect(mockGetDues).not.toHaveBeenCalled();
  });
});

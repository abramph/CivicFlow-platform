import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminPtaHouseholdsScreen from '../admin-pta-households';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminPtaHouseholds = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminPtaHouseholds: (...args: unknown[]) => mockGetAdminPtaHouseholds(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample PTA', capability: { adminCapabilities } },
  };
}

function household(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'household-1',
    displayName: 'Smith Family',
    status: 'ACTIVE',
    schoolYear: '2026-2027',
    adults: [{ id: 'adult-1', name: 'Jane Smith', email: null, phone: null, relationshipLabel: null, userId: null }],
    students: [{ id: 'student-1', displayName: 'Jamie Smith', status: 'ACTIVE' }],
    ...overrides,
  };
}

describe('Admin PTA households list screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminPtaHouseholds.mockReset();
  });

  it('shows a denial state and never fetches without managePtaHouseholds', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminPtaHouseholdsScreen />);

    await waitFor(() => expect(screen.getByText("You don't have household administration access for this organization.")).toBeTruthy());
    expect(mockGetAdminPtaHouseholds).not.toHaveBeenCalled();
  });

  it('shows an empty state with no households', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHouseholds.mockResolvedValueOnce([]);

    await render(<AdminPtaHouseholdsScreen />);

    await waitFor(() => expect(screen.getByText('No households yet.')).toBeTruthy());
  });

  it('shows a load-error banner on failure', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHouseholds.mockRejectedValueOnce(new Error('network'));

    await render(<AdminPtaHouseholdsScreen />);

    await waitFor(() => expect(screen.getByText('Unable to load households. Check your connection and try again.')).toBeTruthy());
  });

  it('renders households with adult/student counts', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHouseholds.mockResolvedValueOnce([household()]);

    await render(<AdminPtaHouseholdsScreen />);

    await waitFor(() => expect(screen.getByText('Smith Family')).toBeTruthy());
    expect(screen.getByText('ACTIVE · 1 adult · 1 student')).toBeTruthy();
  });

  it('navigates to the create screen when New is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHouseholds.mockResolvedValueOnce([]);

    await render(<AdminPtaHouseholdsScreen />);
    await waitFor(() => expect(mockGetAdminPtaHouseholds).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('New household'));
    expect(mockPush).toHaveBeenCalledWith('/admin-pta-households/new');
  });

  it('navigates to the detail screen when a row is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHouseholds.mockResolvedValueOnce([household()]);

    await render(<AdminPtaHouseholdsScreen />);
    await waitFor(() => expect(screen.getByText('Smith Family')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Smith Family'));
    expect(mockPush).toHaveBeenCalledWith('/admin-pta-households/household-1');
  });
});

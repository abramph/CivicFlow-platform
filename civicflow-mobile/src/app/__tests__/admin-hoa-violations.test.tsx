import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminHoaViolationsScreen from '../admin-hoa-violations';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminHoaViolations = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminHoaViolations: (...args: unknown[]) => mockGetAdminHoaViolations(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample HOA', capability: { adminCapabilities } },
  };
}

function violation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'violation-1',
    violationType: 'Fence height',
    status: 'ISSUED',
    cureByDate: null,
    issuedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    property: { id: 'property-1', addressLine1: '123 Main St', unitLabel: null, displayName: null },
    ...overrides,
  };
}

describe('Admin HOA violations list screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminHoaViolations.mockReset();
  });

  it('shows a denial state and never fetches without manageHoaViolations', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminHoaViolationsScreen />);

    await waitFor(() => expect(screen.getByText("You don't have violation administration access for this organization.")).toBeTruthy());
    expect(mockGetAdminHoaViolations).not.toHaveBeenCalled();
  });

  it('shows an empty state with no violations', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolations.mockResolvedValueOnce([]);

    await render(<AdminHoaViolationsScreen />);

    await waitFor(() => expect(screen.getByText('No violations yet.')).toBeTruthy());
  });

  it('renders violations with status', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolations.mockResolvedValueOnce([violation()]);

    await render(<AdminHoaViolationsScreen />);

    await waitFor(() => expect(screen.getByText('Fence height')).toBeTruthy());
    expect(screen.getByLabelText('Fence height, 123 Main St')).toBeTruthy();
  });

  it('navigates to the create screen when New is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolations.mockResolvedValueOnce([]);

    await render(<AdminHoaViolationsScreen />);
    await waitFor(() => expect(mockGetAdminHoaViolations).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('New violation'));
    expect(mockPush).toHaveBeenCalledWith('/admin-hoa-violations/new');
  });

  it('navigates to the detail screen when a row is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaViolations']));
    mockGetAdminHoaViolations.mockResolvedValueOnce([violation()]);

    await render(<AdminHoaViolationsScreen />);
    await waitFor(() => expect(screen.getByText('Fence height')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Fence height, 123 Main St'));
    expect(mockPush).toHaveBeenCalledWith('/admin-hoa-violations/violation-1');
  });
});

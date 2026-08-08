import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminHoaArchitecturalRequestsScreen from '../admin-hoa-architectural-requests';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminHoaArchitecturalRequests = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminHoaArchitecturalRequests: (...args: unknown[]) => mockGetAdminHoaArchitecturalRequests(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample HOA', capability: { adminCapabilities } },
  };
}

function request(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'request-1',
    requestNumber: 1042,
    category: 'FENCE',
    title: 'New fence installation',
    status: 'IN_REVIEW',
    createdAt: '2026-08-01T00:00:00.000Z',
    property: { id: 'property-1', addressLine1: '123 Main St', unitLabel: null, displayName: null },
    ...overrides,
  };
}

describe('Admin HOA architectural requests list screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminHoaArchitecturalRequests.mockReset();
  });

  it('shows a denial state and never fetches without manageHoaArchitecturalRequests', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminHoaArchitecturalRequestsScreen />);

    await waitFor(() => expect(screen.getByText("You don't have architectural request access for this organization.")).toBeTruthy());
    expect(mockGetAdminHoaArchitecturalRequests).not.toHaveBeenCalled();
  });

  it('never renders a New/create control -- requests are resident-submitted only', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaArchitecturalRequests']));
    mockGetAdminHoaArchitecturalRequests.mockResolvedValueOnce([]);

    await render(<AdminHoaArchitecturalRequestsScreen />);

    await waitFor(() => expect(mockGetAdminHoaArchitecturalRequests).toHaveBeenCalled());
    expect(screen.queryByLabelText('New request')).toBeNull();
    expect(screen.queryByLabelText(/^New/)).toBeNull();
  });

  it('renders requests with their request number and status', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaArchitecturalRequests']));
    mockGetAdminHoaArchitecturalRequests.mockResolvedValueOnce([request()]);

    await render(<AdminHoaArchitecturalRequestsScreen />);

    await waitFor(() => expect(screen.getByText('AR-1042 · New fence installation')).toBeTruthy());
  });

  it('navigates to the detail screen when a row is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaArchitecturalRequests']));
    mockGetAdminHoaArchitecturalRequests.mockResolvedValueOnce([request()]);

    await render(<AdminHoaArchitecturalRequestsScreen />);
    await waitFor(() => expect(screen.getByText('AR-1042 · New fence installation')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('New fence installation, 123 Main St'));
    expect(mockPush).toHaveBeenCalledWith('/admin-hoa-architectural-requests/request-1');
  });
});

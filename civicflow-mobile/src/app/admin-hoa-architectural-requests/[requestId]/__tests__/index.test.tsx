import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminHoaArchitecturalRequestDetailScreen from '../index';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ requestId: 'request-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminHoaArchitecturalRequest = jest.fn();
const mockAddAdminHoaArchitecturalRequestComment = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminHoaArchitecturalRequest: (...a: unknown[]) => mockGetAdminHoaArchitecturalRequest(...a),
  addAdminHoaArchitecturalRequestComment: (...a: unknown[]) => mockAddAdminHoaArchitecturalRequestComment(...a),
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
    projectDescription: 'Install a 6ft wooden fence along the back property line.',
    proposedStartDate: null,
    proposedCompletionDate: null,
    decisionSummary: null,
    conditions: null,
    comments: [],
    statusHistory: [],
    property: { id: 'property-1', addressLine1: '123 Main St', unitLabel: null, displayName: null },
    ...overrides,
  };
}

beforeEach(() => {
  mockGetAdminHoaArchitecturalRequest.mockReset();
  mockAddAdminHoaArchitecturalRequestComment.mockReset();
});

describe('Admin HOA architectural request detail screen', () => {
  it('shows a denial state and never fetches without manageHoaArchitecturalRequests', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminHoaArchitecturalRequestDetailScreen />);

    await waitFor(() => expect(screen.getByText("You don't have architectural request access for this organization.")).toBeTruthy());
    expect(mockGetAdminHoaArchitecturalRequest).not.toHaveBeenCalled();
  });

  it('re-fetches by requestId + organization rather than trusting navigation params', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaArchitecturalRequests']));
    mockGetAdminHoaArchitecturalRequest.mockResolvedValueOnce(request());

    await render(<AdminHoaArchitecturalRequestDetailScreen />);

    await waitFor(() => expect(mockGetAdminHoaArchitecturalRequest).toHaveBeenCalledWith('org-a', 'request-1'));
    expect(screen.getByText('AR-1042 · New fence installation')).toBeTruthy();
  });

  it('never renders an approve/deny/decide control anywhere on this screen', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaArchitecturalRequests']));
    mockGetAdminHoaArchitecturalRequest.mockResolvedValueOnce(request());

    await render(<AdminHoaArchitecturalRequestDetailScreen />);

    await waitFor(() => expect(screen.getByText('AR-1042 · New fence installation')).toBeTruthy());
    expect(screen.queryByLabelText(/approve/i)).toBeNull();
    expect(screen.queryByLabelText(/deny/i)).toBeNull();
    expect(screen.queryByLabelText(/decide/i)).toBeNull();
    expect(screen.queryByText(/approve/i)).toBeNull();
    expect(screen.queryByText(/deny/i)).toBeNull();
  });

  it('posts a private-by-default comment', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaArchitecturalRequests']));
    mockGetAdminHoaArchitecturalRequest.mockResolvedValueOnce(request());
    mockAddAdminHoaArchitecturalRequestComment.mockResolvedValueOnce({ id: 'comment-1', body: 'Looks reasonable', isPrivate: true });
    mockGetAdminHoaArchitecturalRequest.mockResolvedValueOnce(request());

    await render(<AdminHoaArchitecturalRequestDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Add a comment')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Looks reasonable');
    await fireEvent.press(screen.getByLabelText('Post comment'));

    await waitFor(() => expect(mockAddAdminHoaArchitecturalRequestComment).toHaveBeenCalledWith('request-1', 'org-a', 'Looks reasonable', true));
  });

  it('surfaces a 403 from a comment attempt without throwing (READ-only caller lacking REVIEW)', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaArchitecturalRequests']));
    mockGetAdminHoaArchitecturalRequest.mockResolvedValueOnce(request());
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockAddAdminHoaArchitecturalRequestComment.mockRejectedValueOnce(new ApiError('Permission denied', 403));

    await render(<AdminHoaArchitecturalRequestDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Add a comment')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Looks reasonable');
    await fireEvent.press(screen.getByLabelText('Post comment'));

    await waitFor(() => expect(mockAddAdminHoaArchitecturalRequestComment).toHaveBeenCalled());
  });
});

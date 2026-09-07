import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminPtaChangeRequestsScreen from '../admin-pta-change-requests';

jest.mock('expo-router', () => ({
  Redirect: () => null,
  router: { push: jest.fn() },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminPtaChangeRequests = jest.fn();
const mockApprove = jest.fn();
const mockReject = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminPtaChangeRequests: (...args: unknown[]) => mockGetAdminPtaChangeRequests(...args),
  approveAdminPtaChangeRequest: (...args: unknown[]) => mockApprove(...args),
  rejectAdminPtaChangeRequest: (...args: unknown[]) => mockReject(...args),
}));

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    householdId: 'hh-1',
    householdName: 'Kim Family',
    type: 'RENAME_STUDENT',
    payload: { studentId: 'stu-1', displayName: 'Riley J. Kim' },
    status: 'SUBMITTED',
    decisionNotes: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    reviewedAt: null,
    appliedAt: null,
    ...overrides,
  };
}

function adminAuth(capabilities: string[] = ['adminDashboard', 'managePtaHouseholds']) {
  return {
    selectedOrganizationId: 'org-pta',
    selectedOrganization: { organizationId: 'org-pta', capability: { adminCapabilities: capabilities } },
  };
}

describe('Admin family change-request review queue (Build 27)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue(adminAuth());
    mockGetAdminPtaChangeRequests.mockResolvedValue([requestRow()]);
    mockApprove.mockResolvedValue({ id: 'req-1', status: 'APPLIED', appliedAt: '2026-09-06T00:00:00.000Z' });
    mockReject.mockResolvedValue({ id: 'req-1', status: 'REJECTED' });
  });

  it('lists only SUBMITTED requests with a human description of the change', async () => {
    await render(<AdminPtaChangeRequestsScreen />);

    await waitFor(() => expect(screen.getByText('Kim Family')).toBeTruthy());
    expect(mockGetAdminPtaChangeRequests).toHaveBeenCalledWith('org-pta', 'SUBMITTED');
    expect(screen.getByText("Correct a student's name to “Riley J. Kim”")).toBeTruthy();
  });

  it('approve applies the change server-side — the client only sends ids', async () => {
    await render(<AdminPtaChangeRequestsScreen />);
    await waitFor(() => expect(screen.getByText('Kim Family')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/^Approve and apply/));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('req-1', 'org-pta'));
    expect(mockReject).not.toHaveBeenCalled();
  });

  it('reject sends the optional note for the family', async () => {
    await render(<AdminPtaChangeRequestsScreen />);
    await waitFor(() => expect(screen.getByText('Kim Family')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/^Reject:/));
    await fireEvent.changeText(screen.getByLabelText('Rejection note for Kim Family'), 'Please contact the office.');
    await fireEvent.press(screen.getByLabelText('Confirm rejection for Kim Family'));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('req-1', 'org-pta', 'Please contact the office.'));
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('renders the no-access state (never the queue) without managePtaHouseholds', async () => {
    mockUseAuth.mockReturnValue(adminAuth(['adminDashboard', 'manageEvents']));

    await render(<AdminPtaChangeRequestsScreen />);
    expect(screen.getByText("You don't have household administration access for this organization.")).toBeTruthy();
    expect(mockGetAdminPtaChangeRequests).not.toHaveBeenCalled();
  });
});

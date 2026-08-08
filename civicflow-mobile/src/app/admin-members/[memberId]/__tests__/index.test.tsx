import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminMemberDetailScreen from '../index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ memberId: 'member-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminMember = jest.fn();
const mockTerminateAdminMember = jest.fn();
const mockReinstateAdminMember = jest.fn();
const mockGetAdminMemberDues = jest.fn();
const mockGenerateAdminDuesForMember = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminMember: (...args: unknown[]) => mockGetAdminMember(...args),
  terminateAdminMember: (...args: unknown[]) => mockTerminateAdminMember(...args),
  reinstateAdminMember: (...args: unknown[]) => mockReinstateAdminMember(...args),
  getAdminMemberDues: (...args: unknown[]) => mockGetAdminMemberDues(...args),
  generateAdminDuesForMember: (...args: unknown[]) => mockGenerateAdminDuesForMember(...args),
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

function member(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'member-1',
    organizationId: 'org-a',
    firstName: 'Ada',
    lastName: 'Lovelace',
    preferredName: null,
    email: 'ada@example.com',
    phone: null,
    membershipStatus: 'active',
    statusChangeReason: null,
    isDelinquent: false,
    joinDate: null,
    dateOfBirth: null,
    gender: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zipCode: null,
    county: null,
    country: null,
    membershipCategoryId: null,
    membershipCategoryManualOverride: false,
    householdName: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    notes: null,
    commsSmsEnabled: false,
    userId: null,
    ...overrides,
  };
}

describe('Admin member detail screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminMember.mockReset();
    mockTerminateAdminMember.mockReset();
    mockReinstateAdminMember.mockReset();
    mockGetAdminMemberDues.mockReset();
    mockGenerateAdminDuesForMember.mockReset();
    alertSpy.mockClear();
  });

  it('shows a denial state and never fetches without manageMembers', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminMemberDetailScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have member administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminMember).not.toHaveBeenCalled();
  });

  it('re-fetches by memberId + organization rather than trusting navigation params', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMember.mockResolvedValueOnce(member());

    await render(<AdminMemberDetailScreen />);

    await waitFor(() => expect(mockGetAdminMember).toHaveBeenCalledWith('org-a', 'member-1'));
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('shows a not-found state for a deleted/foreign-org member', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockGetAdminMember.mockRejectedValueOnce(new ApiError('Member not found', 404));

    await render(<AdminMemberDetailScreen />);

    await waitFor(() => expect(screen.getByText('This member could not be found.')).toBeTruthy());
  });

  it('shows the Terminate action for an active member and hides Reinstate', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMember.mockResolvedValueOnce(member({ membershipStatus: 'active' }));

    await render(<AdminMemberDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('Terminate member')).toBeTruthy());
    expect(screen.queryByLabelText('Reinstate member')).toBeNull();
  });

  it('shows the Reinstate action for a terminated member and hides Terminate', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMember.mockResolvedValueOnce(member({ membershipStatus: 'terminated' }));

    await render(<AdminMemberDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('Reinstate member')).toBeTruthy());
    expect(screen.queryByLabelText('Terminate member')).toBeNull();
  });

  it('requires a reason before allowing the terminate confirmation to be pressed', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMember.mockResolvedValueOnce(member({ membershipStatus: 'active' }));

    await render(<AdminMemberDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Terminate member')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Terminate member'));

    await waitFor(() => expect(screen.getByLabelText('Confirm termination')).toBeTruthy());
    expect(screen.getByLabelText('Confirm termination').props.accessibilityState?.disabled).toBe(true);
  });

  it('terminates the member using the selected reason and reloads', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMember.mockResolvedValueOnce(member({ membershipStatus: 'active' }));
    mockGetAdminMember.mockResolvedValueOnce(member({ membershipStatus: 'terminated' }));
    mockTerminateAdminMember.mockResolvedValueOnce(member({ membershipStatus: 'terminated' }));

    await render(<AdminMemberDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Terminate member')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Terminate member'));
    await waitFor(() => expect(screen.getByLabelText('Resigned voluntarily')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Resigned voluntarily'));
    await fireEvent.press(screen.getByLabelText('Confirm termination'));

    await waitFor(() =>
      expect(mockTerminateAdminMember).toHaveBeenCalledWith(
        'member-1',
        expect.objectContaining({ organizationId: 'org-a', reasonCode: 'RESIGNED_VOLUNTARY' })
      )
    );
  });

  it('does not show a Dues section or fetch dues without managePayments', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers']));
    mockGetAdminMember.mockResolvedValueOnce(member());

    await render(<AdminMemberDetailScreen />);

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.queryByText('Dues')).toBeNull();
    expect(mockGetAdminMemberDues).not.toHaveBeenCalled();
  });

  it('shows dues charges and entry points for a caller with managePayments', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers', 'managePayments']));
    mockGetAdminMember.mockResolvedValueOnce(member());
    mockGetAdminMemberDues.mockResolvedValueOnce({
      member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false },
      charges: [{ id: 'charge-1', amountDue: '50.00', amountPaid: '0.00', dueDate: '2026-09-01T00:00:00.000Z', status: 'PENDING', duesAccountId: 'account-1' }],
      payments: [],
      adjustments: [],
    });

    await render(<AdminMemberDetailScreen />);

    await waitFor(() => expect(mockGetAdminMemberDues).toHaveBeenCalledWith('org-a', 'member-1'));
    expect(screen.getByText(`$50.00 due ${new Date('2026-09-01T00:00:00.000Z').toLocaleDateString()}`)).toBeTruthy();
    expect(screen.getByLabelText('Record payment')).toBeTruthy();
    expect(screen.getByLabelText('Add adjustment')).toBeTruthy();
  });

  it('navigates to record-payment and add-adjustment screens', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers', 'managePayments']));
    mockGetAdminMember.mockResolvedValueOnce(member());
    mockGetAdminMemberDues.mockResolvedValueOnce({
      member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false },
      charges: [],
      payments: [],
      adjustments: [],
    });

    await render(<AdminMemberDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Record payment')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Record payment'));
    expect(mockPush).toHaveBeenCalledWith('/admin-members/member-1/record-payment');

    await fireEvent.press(screen.getByLabelText('Add adjustment'));
    expect(mockPush).toHaveBeenCalledWith('/admin-members/member-1/add-adjustment');
  });

  it('generates dues charges after confirmation and reloads dues', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageMembers', 'managePayments']));
    mockGetAdminMember.mockResolvedValueOnce(member());
    mockGetAdminMemberDues.mockResolvedValueOnce({
      member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false },
      charges: [],
      payments: [],
      adjustments: [],
    });
    mockGenerateAdminDuesForMember.mockResolvedValueOnce({ result: {}, delinquencyResult: {} });
    mockGetAdminMemberDues.mockResolvedValueOnce({
      member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false },
      charges: [{ id: 'charge-1', amountDue: '50.00', amountPaid: '0.00', dueDate: '2026-09-01T00:00:00.000Z', status: 'PENDING', duesAccountId: 'account-1' }],
      payments: [],
      adjustments: [],
    });

    await render(<AdminMemberDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Generate dues charges')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Generate dues charges'));

    await waitFor(() => expect(mockGenerateAdminDuesForMember).toHaveBeenCalledWith('org-a', 'member-1'));
    await waitFor(() => expect(mockGetAdminMemberDues).toHaveBeenCalledTimes(2));
  });
});

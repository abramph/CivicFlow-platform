import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminMemberAddAdjustmentScreen from '../add-adjustment';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => ({ memberId: 'member-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminMemberDues = jest.fn();
const mockCreateAdminDuesAdjustment = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminMemberDues: (...args: unknown[]) => mockGetAdminMemberDues(...args),
  createAdminDuesAdjustment: (...args: unknown[]) => mockCreateAdminDuesAdjustment(...args),
}));

describe('Admin member add-adjustment screen', () => {
  beforeEach(() => {
    mockBack.mockReset();
    mockGetAdminMemberDues.mockReset();
    mockCreateAdminDuesAdjustment.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('shows an empty state when the member has no charges to adjust', async () => {
    mockGetAdminMemberDues.mockResolvedValueOnce({ member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false }, charges: [], payments: [], adjustments: [] });

    await render(<AdminMemberAddAdjustmentScreen />);

    await waitFor(() => expect(screen.getByText('This member has no dues charges to adjust.')).toBeTruthy());
  });

  it('requires an amount before submitting', async () => {
    mockGetAdminMemberDues.mockResolvedValueOnce({
      member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false },
      charges: [{ id: 'charge-1', amountDue: '50.00', amountPaid: '0.00', dueDate: '2026-09-01T00:00:00.000Z', status: 'PENDING', duesAccountId: 'a-1' }],
      payments: [],
      adjustments: [],
    });

    await render(<AdminMemberAddAdjustmentScreen />);
    await waitFor(() => expect(screen.getByLabelText('Add adjustment')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Add adjustment'));

    await waitFor(() => expect(screen.getByText('Enter a valid amount.')).toBeTruthy());
    expect(mockCreateAdminDuesAdjustment).not.toHaveBeenCalled();
  });

  it('requires a dues charge selection once the amount is valid', async () => {
    mockGetAdminMemberDues.mockResolvedValueOnce({
      member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false },
      charges: [{ id: 'charge-1', amountDue: '50.00', amountPaid: '0.00', dueDate: '2026-09-01T00:00:00.000Z', status: 'PENDING', duesAccountId: 'a-1' }],
      payments: [],
      adjustments: [],
    });

    await render(<AdminMemberAddAdjustmentScreen />);
    await waitFor(() => expect(screen.getByLabelText('Amount')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Amount'), '50.00');
    await fireEvent.press(screen.getByLabelText('Add adjustment'));

    await waitFor(() => expect(screen.getByText('Select a dues charge.')).toBeTruthy());
    expect(mockCreateAdminDuesAdjustment).not.toHaveBeenCalled();
  });

  it('creates the adjustment and navigates back', async () => {
    mockGetAdminMemberDues.mockResolvedValueOnce({
      member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false },
      charges: [{ id: 'charge-1', amountDue: '50.00', amountPaid: '0.00', dueDate: '2026-09-01T00:00:00.000Z', status: 'PENDING', duesAccountId: 'a-1' }],
      payments: [],
      adjustments: [],
    });
    mockCreateAdminDuesAdjustment.mockResolvedValueOnce({ id: 'adj-1', adjustmentType: 'WAIVER', amount: '50.00', reason: 'Financial hardship', duesChargeId: 'charge-1', createdAt: '2026-08-01T00:00:00.000Z' });

    const dueDateLabel = `$50.00 due ${new Date('2026-09-01T00:00:00.000Z').toLocaleDateString()}`;

    await render(<AdminMemberAddAdjustmentScreen />);
    await waitFor(() => expect(screen.getByLabelText(dueDateLabel)).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(dueDateLabel));
    await fireEvent.changeText(screen.getByLabelText('Amount'), '50.00');
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'Financial hardship');
    await fireEvent.press(screen.getByLabelText('Add adjustment'));

    await waitFor(() =>
      expect(mockCreateAdminDuesAdjustment).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', memberId: 'member-1', duesChargeId: 'charge-1', adjustmentType: 'WAIVER', amount: 50, reason: 'Financial hardship' })
      )
    );
    expect(mockBack).toHaveBeenCalled();
  });
});

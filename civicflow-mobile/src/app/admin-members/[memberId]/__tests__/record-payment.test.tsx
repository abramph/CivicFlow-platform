import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminMemberRecordPaymentScreen from '../record-payment';

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
const mockRecordAdminDuesPayment = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminMemberDues: (...args: unknown[]) => mockGetAdminMemberDues(...args),
  recordAdminDuesPayment: (...args: unknown[]) => mockRecordAdminDuesPayment(...args),
}));

describe('Admin member record-payment screen', () => {
  beforeEach(() => {
    mockBack.mockReset();
    mockGetAdminMemberDues.mockReset();
    mockRecordAdminDuesPayment.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('loads open charges to offer as optional allocation targets', async () => {
    mockGetAdminMemberDues.mockResolvedValueOnce({
      member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false },
      charges: [
        { id: 'charge-1', amountDue: '50.00', amountPaid: '0.00', dueDate: '2026-09-01T00:00:00.000Z', status: 'PENDING', duesAccountId: 'a-1' },
        { id: 'charge-2', amountDue: '20.00', amountPaid: '20.00', dueDate: '2026-08-01T00:00:00.000Z', status: 'PAID', duesAccountId: 'a-1' },
      ],
      payments: [],
      adjustments: [],
    });

    await render(<AdminMemberRecordPaymentScreen />);

    const dueDate = new Date('2026-09-01T00:00:00.000Z').toLocaleDateString();
    const paidDueDate = new Date('2026-08-01T00:00:00.000Z').toLocaleDateString();
    await waitFor(() => expect(screen.getByLabelText(`$50.00 due ${dueDate}`)).toBeTruthy());
    expect(screen.queryByLabelText(`$20.00 due ${paidDueDate}`)).toBeNull();
  });

  it('requires a valid amount before submitting', async () => {
    mockGetAdminMemberDues.mockResolvedValueOnce({ member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false }, charges: [], payments: [], adjustments: [] });

    await render(<AdminMemberRecordPaymentScreen />);
    await fireEvent.press(screen.getByLabelText('Record payment'));

    await waitFor(() => expect(screen.getByText('Enter a valid amount.')).toBeTruthy());
    expect(mockRecordAdminDuesPayment).not.toHaveBeenCalled();
  });

  it('records the payment and navigates back', async () => {
    mockGetAdminMemberDues.mockResolvedValueOnce({ member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', isDelinquent: false }, charges: [], payments: [], adjustments: [] });
    mockRecordAdminDuesPayment.mockResolvedValueOnce({ id: 'payment-1', amount: '50.00', paymentDate: '2026-08-01T00:00:00.000Z', method: 'CASH', reference: null, duesChargeId: null });

    await render(<AdminMemberRecordPaymentScreen />);

    await fireEvent.changeText(screen.getByLabelText('Amount'), '50.00');
    await fireEvent.press(screen.getByLabelText('Record payment'));

    await waitFor(() =>
      expect(mockRecordAdminDuesPayment).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', memberId: 'member-1', amount: 50, duesChargeId: null })
      )
    );
    expect(mockBack).toHaveBeenCalled();
  });
});

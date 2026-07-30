import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PtaReportPaymentScreen from '../pta-report-payment';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: () => null,
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetPtaDues = jest.fn();
const mockReportPtaDuesPayment = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getPtaDues: (...args: unknown[]) => mockGetPtaDues(...args),
  reportPtaDuesPayment: (...args: unknown[]) => mockReportPtaDuesPayment(...args),
}));

describe('PTA payment-report form', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockReportPtaDuesPayment.mockReset();
    mockGetPtaDues.mockReset().mockResolvedValue({ currentCharge: { id: 'charge-1' } });
    mockUseAuth.mockReturnValue({
      status: 'signedIn',
      selectedOrganization: { organizationName: 'Pine Grove School PTA' },
      selectedOrganizationId: 'org-pta',
    });
  });

  it('rejects submission with no amount entered, without calling the API', async () => {
    await render(<PtaReportPaymentScreen />);
    await waitFor(() => expect(screen.getByText('Report a Payment')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Submit payment report'));

    await waitFor(() => expect(screen.getByText('Enter a valid payment amount.')).toBeTruthy());
    expect(mockReportPtaDuesPayment).not.toHaveBeenCalled();
  });

  it('submits with a valid amount and shows the success confirmation', async () => {
    mockReportPtaDuesPayment.mockResolvedValue({ id: 'report-1', status: 'pending' });

    await render(<PtaReportPaymentScreen />);
    await waitFor(() => expect(screen.getByText('Report a Payment')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Amount'), '25.00');
    await fireEvent.press(screen.getByLabelText('Submit payment report'));

    await waitFor(() => expect(screen.getByText('Payment Reported')).toBeTruthy());
    expect(mockReportPtaDuesPayment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-pta', amountCents: 2500 })
    );
  });
});

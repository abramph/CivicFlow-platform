import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ReportPaymentScreen from '../report-payment';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: () => null,
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({}),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetDues = jest.fn();
const mockSubmitPaymentReport = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getDues: (...args: unknown[]) => mockGetDues(...args),
  submitPaymentReport: (...args: unknown[]) => mockSubmitPaymentReport(...args),
}));

// memberId is required: the screen now redirects a caller with no constituent
// identity to /dues (a staff/owner login would otherwise 403 on submit), so a
// fixture without it never renders the org switcher these tests assert on.
function authWith(organizationCount: number) {
  return {
    status: 'signedIn',
    organizations: Array.from({ length: organizationCount }, (_, i) => ({
      organizationId: `org-${i}`,
      organizationName: `Org ${i}`,
      memberId: `member-${i}`,
    })),
    selectedOrganizationId: 'org-0',
  };
}

describe('Report-payment screen — org switcher discoverability (GitHub #71)', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetDues.mockReset().mockResolvedValue({ charges: [] });
    mockSubmitPaymentReport.mockReset();
  });

  it('shows "Change organization" even with exactly one organization', async () => {
    mockUseAuth.mockReturnValue(authWith(1));

    await render(<ReportPaymentScreen />);

    await waitFor(() => expect(screen.getByLabelText('Change organization')).toBeTruthy());
    expect(screen.getByText('Org 0')).toBeTruthy();
  });

  it('shows "Change organization" with multiple organizations too', async () => {
    mockUseAuth.mockReturnValue(authWith(3));

    await render(<ReportPaymentScreen />);

    await waitFor(() => expect(screen.getByLabelText('Change organization')).toBeTruthy());
  });

  it('navigates to the org switcher when tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(1));

    await render(<ReportPaymentScreen />);
    await waitFor(() => expect(screen.getByLabelText('Change organization')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Change organization'));
    expect(mockPush).toHaveBeenCalledWith('/org-switcher');
  });
});

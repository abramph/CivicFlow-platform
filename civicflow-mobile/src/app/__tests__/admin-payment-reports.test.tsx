import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminPaymentReportsScreen from '../admin-payment-reports';

jest.mock('expo-router', () => ({
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminPaymentReports = jest.fn();
const mockGetAdminPaymentLinkReports = jest.fn();
const mockApproveAdminPaymentReport = jest.fn();
const mockRejectAdminPaymentReport = jest.fn();
const mockApproveAdminPaymentLinkReport = jest.fn();
const mockRejectAdminPaymentLinkReport = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminPaymentReports: (...args: unknown[]) => mockGetAdminPaymentReports(...args),
  getAdminPaymentLinkReports: (...args: unknown[]) => mockGetAdminPaymentLinkReports(...args),
  approveAdminPaymentReport: (...args: unknown[]) => mockApproveAdminPaymentReport(...args),
  rejectAdminPaymentReport: (...args: unknown[]) => mockRejectAdminPaymentReport(...args),
  approveAdminPaymentLinkReport: (...args: unknown[]) => mockApproveAdminPaymentLinkReport(...args),
  rejectAdminPaymentLinkReport: (...args: unknown[]) => mockRejectAdminPaymentLinkReport(...args),
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

describe('Admin payment reports screen', () => {
  beforeEach(() => {
    mockGetAdminPaymentReports.mockReset();
    mockGetAdminPaymentLinkReports.mockReset();
    mockApproveAdminPaymentReport.mockReset();
    mockRejectAdminPaymentReport.mockReset();
    mockApproveAdminPaymentLinkReport.mockReset();
    mockRejectAdminPaymentLinkReport.mockReset();
    alertSpy.mockClear();
  });

  it('shows a denial state and never fetches without managePayments', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminPaymentReportsScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have payments administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminPaymentReports).not.toHaveBeenCalled();
  });

  it('defaults to the self-reported tab and shows an empty state', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminPaymentReports.mockResolvedValueOnce([]);

    await render(<AdminPaymentReportsScreen />);

    await waitFor(() => expect(screen.getByText('Nothing pending review.')).toBeTruthy());
    expect(mockGetAdminPaymentReports).toHaveBeenCalledWith('org-a', 'pending');
  });

  it('shows a permission-denied message distinct from a network error', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockGetAdminPaymentReports.mockRejectedValueOnce(new ApiError('Forbidden', 403));

    await render(<AdminPaymentReportsScreen />);

    await waitFor(() => expect(screen.getByText("You don't have access to review this type of payment report.")).toBeTruthy());
  });

  it('approves a self-reported payment after confirmation', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminPaymentReports.mockResolvedValueOnce([
      { id: 'report-1', amount: '25.00', paymentMethod: 'CASH', paymentDate: '2026-08-01T00:00:00.000Z', category: 'MEMBERSHIP_DUES', status: 'pending', rejectionReason: null, createdAt: '2026-08-01T00:00:00.000Z', member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace' } },
    ]);
    mockApproveAdminPaymentReport.mockResolvedValueOnce({ id: 'report-1', status: 'approved' });
    mockGetAdminPaymentReports.mockResolvedValueOnce([]);

    await render(<AdminPaymentReportsScreen />);
    await waitFor(() => expect(screen.getByLabelText('Approve')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Approve'));

    await waitFor(() => expect(mockApproveAdminPaymentReport).toHaveBeenCalledWith('report-1', 'org-a'));
  });

  it('requires a rejection reason before allowing confirm reject', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminPaymentReports.mockResolvedValueOnce([
      { id: 'report-1', amount: '25.00', paymentMethod: 'CASH', paymentDate: '2026-08-01T00:00:00.000Z', category: 'MEMBERSHIP_DUES', status: 'pending', rejectionReason: null, createdAt: '2026-08-01T00:00:00.000Z', member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace' } },
    ]);

    await render(<AdminPaymentReportsScreen />);
    await waitFor(() => expect(screen.getByLabelText('Reject')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Reject'));

    await waitFor(() => expect(screen.getByLabelText('Confirm rejection')).toBeTruthy());
    expect(screen.getByLabelText('Confirm rejection').props.accessibilityState?.disabled).toBe(true);
    expect(mockRejectAdminPaymentReport).not.toHaveBeenCalled();
  });

  it('switches to the payment-links tab and lists those reports', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminPaymentReports.mockResolvedValueOnce([]);
    mockGetAdminPaymentLinkReports.mockResolvedValueOnce([
      { id: 'link-1', amount: '10.00', payerName: 'Jane Smith', payerEmail: 'jane@example.com', referenceNumber: 'REF-1', status: 'pending', rejectionReason: null, createdAt: '2026-08-01T00:00:00.000Z', paymentLink: { id: 'pl-1', title: 'Fall Dues' } },
    ]);

    await render(<AdminPaymentReportsScreen />);
    await waitFor(() => expect(mockGetAdminPaymentReports).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Payment link reports'));

    await waitFor(() => expect(screen.getByText('Jane Smith · $10.00')).toBeTruthy());
    expect(mockGetAdminPaymentLinkReports).toHaveBeenCalledWith('org-a', 'pending');
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminReportsScreen from '../admin-reports';

jest.mock('expo-router', () => ({
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockSendAdminReport = jest.fn();
jest.mock('@/lib/mobile-api', () => {
  const actual = jest.requireActual('@/lib/mobile-api');
  return {
    ADMIN_REPORT_TYPE_LABELS: actual.ADMIN_REPORT_TYPE_LABELS,
    sendAdminReport: (...args: unknown[]) => mockSendAdminReport(...args),
  };
});

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
    user: { id: 'user-1', email: 'officer@example.com', displayName: 'Officer' },
  };
}

describe('Admin reports screen', () => {
  beforeEach(() => {
    mockSendAdminReport.mockReset();
  });

  it('shows a denial state and never allows sending without manageReports', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminReportsScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have reports administration access for this organization.")).toBeTruthy()
    );
  });

  it('sends the selected report and shows confirmation with the caller email, never a downloadable file', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageReports']));
    mockSendAdminReport.mockResolvedValueOnce({ sent: true });

    await render(<AdminReportsScreen />);

    await fireEvent.press(screen.getByLabelText('Email Report'));

    await waitFor(() =>
      expect(mockSendAdminReport).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', reportType: 'ACTIVE_MEMBER_ROSTER', format: 'pdf' })
      )
    );
    expect(screen.getByText('Report sent to officer@example.com.')).toBeTruthy();
  });

  it('surfaces a financial-role-gate error from the server', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageReports']));
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockSendAdminReport.mockRejectedValueOnce(new ApiError('Financial report sends require a finance or administrator role.', 403));

    await render(<AdminReportsScreen />);

    await fireEvent.press(screen.getByLabelText('General Financial Summary'));
    await fireEvent.press(screen.getByLabelText('Email Report'));

    await waitFor(() => expect(screen.getByText('Financial report sends require a finance or administrator role.')).toBeTruthy());
  });

  it('lets the officer switch format and report type', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageReports']));
    mockSendAdminReport.mockResolvedValueOnce({ sent: true });

    await render(<AdminReportsScreen />);

    await fireEvent.press(screen.getByLabelText('Outstanding Dues'));
    await fireEvent.press(screen.getByLabelText('CSV'));
    await fireEvent.press(screen.getByLabelText('Email Report'));

    await waitFor(() =>
      expect(mockSendAdminReport).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'OUTSTANDING_DUES', format: 'csv' }))
    );
  });
});

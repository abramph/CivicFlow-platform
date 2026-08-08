import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminContributionDetailScreen from '../index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ contributionId: 'contrib-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminContribution = jest.fn();
const mockVoidAdminContribution = jest.fn();
const mockGenerateAdminContributionReceipt = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminContribution: (...args: unknown[]) => mockGetAdminContribution(...args),
  voidAdminContribution: (...args: unknown[]) => mockVoidAdminContribution(...args),
  generateAdminContributionReceipt: (...args: unknown[]) => mockGenerateAdminContributionReceipt(...args),
}));

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample Org', capability: { adminCapabilities } },
  };
}

function detail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'contrib-1',
    amount: '25.00',
    contributionDate: '2026-08-01T00:00:00.000Z',
    source: 'MANUAL',
    paymentMethod: 'CASH',
    notes: null,
    voidedAt: null,
    voidReason: null,
    lockedAt: null,
    member: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace' },
    campaign: null,
    event: null,
    receipts: [],
    ...overrides,
  };
}

describe('Admin contribution detail screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminContribution.mockReset();
    mockVoidAdminContribution.mockReset();
    mockGenerateAdminContributionReceipt.mockReset();
  });

  it('shows a denial state and never fetches without managePayments', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminContributionDetailScreen />);

    await waitFor(() =>
      expect(screen.getByText("You don't have payments administration access for this organization.")).toBeTruthy()
    );
    expect(mockGetAdminContribution).not.toHaveBeenCalled();
  });

  it('re-fetches by contributionId + organization rather than trusting navigation params', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContribution.mockResolvedValueOnce(detail());

    await render(<AdminContributionDetailScreen />);

    await waitFor(() => expect(mockGetAdminContribution).toHaveBeenCalledWith('org-a', 'contrib-1'));
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('hides Edit/Void/Receipt actions for an already-voided contribution', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContribution.mockResolvedValueOnce(detail({ voidedAt: '2026-08-02T00:00:00.000Z', voidReason: 'Duplicate entry' }));

    await render(<AdminContributionDetailScreen />);

    await waitFor(() => expect(screen.getByText(/Duplicate entry/)).toBeTruthy());
    expect(screen.queryByLabelText('Void contribution')).toBeNull();
    expect(screen.queryByLabelText('Edit contribution')).toBeNull();
  });

  it('requires confirmation before voiding', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContribution.mockResolvedValueOnce(detail());

    await render(<AdminContributionDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Void contribution')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Void contribution'));
    expect(mockVoidAdminContribution).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Confirm void')).toBeTruthy();
  });

  it('voids the contribution after confirmation and reloads', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContribution.mockResolvedValueOnce(detail());
    mockGetAdminContribution.mockResolvedValueOnce(detail({ voidedAt: '2026-08-02T00:00:00.000Z' }));
    mockVoidAdminContribution.mockResolvedValueOnce(detail({ voidedAt: '2026-08-02T00:00:00.000Z' }));

    await render(<AdminContributionDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Void contribution')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Void contribution'));
    await fireEvent.press(screen.getByLabelText('Confirm void'));

    await waitFor(() => expect(mockVoidAdminContribution).toHaveBeenCalledWith('contrib-1', 'org-a', undefined));
  });

  it('generates a receipt when none exists yet', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePayments']));
    mockGetAdminContribution.mockResolvedValueOnce(detail());
    mockGetAdminContribution.mockResolvedValueOnce(detail({ receipts: [{ id: 'r-1', receiptNumber: 'R-0001', deliveryStatus: 'sent', createdAt: '2026-08-02T00:00:00.000Z' }] }));
    mockGenerateAdminContributionReceipt.mockResolvedValueOnce({ id: 'r-1', receiptNumber: 'R-0001' });

    await render(<AdminContributionDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Generate receipt')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Generate receipt'));

    await waitFor(() => expect(mockGenerateAdminContributionReceipt).toHaveBeenCalledWith('contrib-1', 'org-a'));
  });
});

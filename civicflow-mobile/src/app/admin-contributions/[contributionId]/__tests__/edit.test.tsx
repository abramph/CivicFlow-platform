import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminContributionEditScreen from '../edit';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ contributionId: 'contrib-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminContribution = jest.fn();
const mockUpdateAdminContribution = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminContribution: (...args: unknown[]) => mockGetAdminContribution(...args),
  updateAdminContribution: (...args: unknown[]) => mockUpdateAdminContribution(...args),
}));

function detail() {
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
  };
}

describe('Admin contribution edit screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockGetAdminContribution.mockReset();
    mockUpdateAdminContribution.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('shows a not-found state for a deleted/foreign-org contribution', async () => {
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockGetAdminContribution.mockRejectedValueOnce(new ApiError('Not found', 404));

    await render(<AdminContributionEditScreen />);

    await waitFor(() => expect(screen.getByText('This contribution could not be found.')).toBeTruthy());
  });

  it('pre-fills the form from the loaded contribution', async () => {
    mockGetAdminContribution.mockResolvedValueOnce(detail());

    await render(<AdminContributionEditScreen />);

    await waitFor(() => expect(screen.getByLabelText('Amount').props.value).toBe('25.00'));
  });

  it('requires an edit reason before submitting', async () => {
    mockGetAdminContribution.mockResolvedValueOnce(detail());

    await render(<AdminContributionEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Save changes')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(screen.getByText('An edit reason is required.')).toBeTruthy());
    expect(mockUpdateAdminContribution).not.toHaveBeenCalled();
  });

  it('submits changes with the edit reason and returns to detail', async () => {
    mockGetAdminContribution.mockResolvedValueOnce(detail());
    mockUpdateAdminContribution.mockResolvedValueOnce(detail());

    await render(<AdminContributionEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Save changes')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Amount'), '30.00');
    await fireEvent.changeText(screen.getByLabelText('Reason for this edit'), 'Corrected amount');
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() =>
      expect(mockUpdateAdminContribution).toHaveBeenCalledWith(
        'contrib-1',
        expect.objectContaining({ organizationId: 'org-a', amount: 30, editReason: 'Corrected amount' })
      )
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-contributions/contrib-1');
  });
});

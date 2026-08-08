import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminContributionCreateScreen from '../new';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreateAdminContribution = jest.fn();
const mockGetAdminMembers = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminContribution: (...args: unknown[]) => mockCreateAdminContribution(...args),
  getAdminMembers: (...args: unknown[]) => mockGetAdminMembers(...args),
}));

describe('Admin contribution create screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockCreateAdminContribution.mockReset();
    mockGetAdminMembers.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('requires an amount and a member or contributor name', async () => {
    await render(<AdminContributionCreateScreen />);

    await fireEvent.press(screen.getByLabelText('Record contribution'));

    await waitFor(() => expect(screen.getByText('Enter a valid amount.')).toBeTruthy());
    expect(mockCreateAdminContribution).not.toHaveBeenCalled();
  });

  it('requires a member or contributor name when amount is valid', async () => {
    await render(<AdminContributionCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('Amount'), '25.00');
    await fireEvent.press(screen.getByLabelText('Record contribution'));

    await waitFor(() => expect(screen.getByText('Select a member or enter a contributor name.')).toBeTruthy());
  });

  it('creates a manual contribution and navigates to its detail screen', async () => {
    mockCreateAdminContribution.mockResolvedValueOnce({ id: 'contrib-new' });

    await render(<AdminContributionCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('Amount'), '25.00');
    await fireEvent.changeText(screen.getByLabelText('Contributor name'), 'Jane Smith');
    await fireEvent.press(screen.getByLabelText('Record contribution'));

    await waitFor(() =>
      expect(mockCreateAdminContribution).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', amount: 25, contributorName: 'Jane Smith', memberId: null, source: 'MANUAL' })
      )
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-contributions/contrib-new');
  });

  it('searches and selects a member, clearing the contributor name field', async () => {
    mockGetAdminMembers.mockResolvedValueOnce({ members: [{ id: 'member-1', firstName: 'Ada', lastName: 'Lovelace' }], total: 1, hasMore: false, page: 1 });

    await render(<AdminContributionCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('Search members'), 'Ada');
    await waitFor(() => expect(screen.getByLabelText('Ada Lovelace')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Ada Lovelace'));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.queryByLabelText('Search members')).toBeNull();
  });
});

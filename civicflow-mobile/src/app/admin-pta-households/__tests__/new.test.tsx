import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminPtaHouseholdCreateScreen from '../new';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreateAdminPtaHousehold = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminPtaHousehold: (...args: unknown[]) => mockCreateAdminPtaHousehold(...args),
}));

describe('Admin PTA household create screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockCreateAdminPtaHousehold.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('requires a household name', async () => {
    await render(<AdminPtaHouseholdCreateScreen />);

    await fireEvent.press(screen.getByLabelText('Create household'));

    await waitFor(() => expect(screen.getByText('Household name is required.')).toBeTruthy());
    expect(mockCreateAdminPtaHousehold).not.toHaveBeenCalled();
  });

  it('creates a household and navigates to its detail screen', async () => {
    mockCreateAdminPtaHousehold.mockResolvedValueOnce({ id: 'household-new' });

    await render(<AdminPtaHouseholdCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText('Household name'), 'Smith Family');
    await fireEvent.press(screen.getByLabelText('Create household'));

    await waitFor(() =>
      expect(mockCreateAdminPtaHousehold).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', displayName: 'Smith Family' })
      )
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-pta-households/household-new');
  });
});

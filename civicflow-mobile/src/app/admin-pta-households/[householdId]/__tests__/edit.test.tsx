import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminPtaHouseholdEditScreen from '../edit';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ householdId: 'household-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminPtaHousehold = jest.fn();
const mockUpdateAdminPtaHousehold = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminPtaHousehold: (...a: unknown[]) => mockGetAdminPtaHousehold(...a),
  updateAdminPtaHousehold: (...a: unknown[]) => mockUpdateAdminPtaHousehold(...a),
}));

function household() {
  return {
    id: 'household-1',
    displayName: 'Smith Family',
    status: 'ACTIVE',
    schoolYear: '2026-2027',
    notes: null,
    volunteerInterests: [],
    adults: [],
    students: [],
  };
}

describe('Admin PTA household edit screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockGetAdminPtaHousehold.mockReset();
    mockUpdateAdminPtaHousehold.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('pre-fills the form from the loaded household', async () => {
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household());

    await render(<AdminPtaHouseholdEditScreen />);

    await waitFor(() => expect(screen.getByLabelText('Household name').props.value).toBe('Smith Family'));
  });

  it('submits changes and returns to detail', async () => {
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household());
    mockUpdateAdminPtaHousehold.mockResolvedValueOnce(household());

    await render(<AdminPtaHouseholdEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Save changes')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Household name'), 'Smith-Jones Family');
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() =>
      expect(mockUpdateAdminPtaHousehold).toHaveBeenCalledWith('household-1', expect.objectContaining({ organizationId: 'org-a', displayName: 'Smith-Jones Family' }))
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-pta-households/household-1');
  });
});

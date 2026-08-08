import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminPtaHouseholdDetailScreen from '../index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ householdId: 'household-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminPtaHousehold = jest.fn();
const mockDeactivateAdminPtaHousehold = jest.fn();
const mockAddAdminPtaHouseholdAdult = jest.fn();
const mockRemoveAdminPtaHouseholdAdult = jest.fn();
const mockAddAdminPtaStudent = jest.fn();
const mockDeactivateAdminPtaStudent = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminPtaHousehold: (...a: unknown[]) => mockGetAdminPtaHousehold(...a),
  deactivateAdminPtaHousehold: (...a: unknown[]) => mockDeactivateAdminPtaHousehold(...a),
  addAdminPtaHouseholdAdult: (...a: unknown[]) => mockAddAdminPtaHouseholdAdult(...a),
  removeAdminPtaHouseholdAdult: (...a: unknown[]) => mockRemoveAdminPtaHouseholdAdult(...a),
  addAdminPtaStudent: (...a: unknown[]) => mockAddAdminPtaStudent(...a),
  deactivateAdminPtaStudent: (...a: unknown[]) => mockDeactivateAdminPtaStudent(...a),
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample PTA', capability: { adminCapabilities } },
  };
}

function household(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'household-1',
    displayName: 'Smith Family',
    status: 'ACTIVE',
    schoolYear: '2026-2027',
    notes: null,
    volunteerInterests: [],
    adults: [{ id: 'adult-1', name: 'Jane Smith', email: 'jane@example.com', phone: null, relationshipLabel: null, userId: null }],
    students: [{ id: 'student-1', displayName: 'Jamie Smith', status: 'ACTIVE' }],
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockGetAdminPtaHousehold.mockReset();
  mockDeactivateAdminPtaHousehold.mockReset();
  mockAddAdminPtaHouseholdAdult.mockReset();
  mockRemoveAdminPtaHouseholdAdult.mockReset();
  mockAddAdminPtaStudent.mockReset();
  mockDeactivateAdminPtaStudent.mockReset();
  alertSpy.mockClear();
});

describe('Admin PTA household detail screen', () => {
  it('shows a denial state and never fetches without managePtaHouseholds', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminPtaHouseholdDetailScreen />);

    await waitFor(() => expect(screen.getByText("You don't have household administration access for this organization.")).toBeTruthy());
    expect(mockGetAdminPtaHousehold).not.toHaveBeenCalled();
  });

  it('re-fetches by householdId + organization rather than trusting navigation params', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household());

    await render(<AdminPtaHouseholdDetailScreen />);

    await waitFor(() => expect(mockGetAdminPtaHousehold).toHaveBeenCalledWith('org-a', 'household-1'));
    expect(screen.getByText('Smith Family')).toBeTruthy();
  });

  it('shows the "Has portal access" badge only for a linked adult', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household());

    await render(<AdminPtaHouseholdDetailScreen />);

    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeTruthy());
    expect(screen.queryByText('Has portal access')).toBeNull();
  });

  it('adds an adult without ever sending a userId field', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household());
    mockAddAdminPtaHouseholdAdult.mockResolvedValueOnce({ id: 'adult-2' });
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household({ adults: [] }));

    await render(<AdminPtaHouseholdDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Add adult')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Add adult'));
    await fireEvent.changeText(screen.getByLabelText('Adult name'), 'John Smith');
    await fireEvent.press(screen.getByLabelText('Save adult'));

    await waitFor(() =>
      expect(mockAddAdminPtaHouseholdAdult).toHaveBeenCalledWith('household-1', expect.not.objectContaining({ userId: expect.anything() }))
    );
  });

  it('removes an adult after confirmation', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household());
    mockRemoveAdminPtaHouseholdAdult.mockResolvedValueOnce({ removed: true });
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household({ adults: [] }));

    await render(<AdminPtaHouseholdDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Remove Jane Smith')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Remove Jane Smith'));

    await waitFor(() => expect(mockRemoveAdminPtaHouseholdAdult).toHaveBeenCalledWith('household-1', 'adult-1', 'org-a'));
  });

  it('deactivates the household after confirmation', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household());
    mockDeactivateAdminPtaHousehold.mockResolvedValueOnce(household({ status: 'INACTIVE' }));
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household({ status: 'INACTIVE' }));

    await render(<AdminPtaHouseholdDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Deactivate household')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Deactivate household'));

    await waitFor(() => expect(mockDeactivateAdminPtaHousehold).toHaveBeenCalledWith('household-1', 'org-a'));
  });

  it('hides the deactivate action for an already-inactive household', async () => {
    mockUseAuth.mockReturnValue(authWith(['managePtaHouseholds']));
    mockGetAdminPtaHousehold.mockResolvedValueOnce(household({ status: 'INACTIVE' }));

    await render(<AdminPtaHouseholdDetailScreen />);

    await waitFor(() => expect(screen.getByText('Smith Family')).toBeTruthy());
    expect(screen.queryByLabelText('Deactivate household')).toBeNull();
  });
});

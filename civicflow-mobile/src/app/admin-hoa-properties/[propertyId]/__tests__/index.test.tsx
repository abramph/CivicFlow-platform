import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminHoaPropertyDetailScreen from '../index';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => ({ propertyId: 'property-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminHoaProperty = jest.fn();
const mockArchiveAdminHoaProperty = jest.fn();
const mockReactivateAdminHoaProperty = jest.fn();
const mockAssignAdminHoaResident = jest.fn();
const mockEndAdminHoaResident = jest.fn();
const mockGetAdminMembers = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminHoaProperty: (...a: unknown[]) => mockGetAdminHoaProperty(...a),
  archiveAdminHoaProperty: (...a: unknown[]) => mockArchiveAdminHoaProperty(...a),
  reactivateAdminHoaProperty: (...a: unknown[]) => mockReactivateAdminHoaProperty(...a),
  assignAdminHoaResident: (...a: unknown[]) => mockAssignAdminHoaResident(...a),
  endAdminHoaResident: (...a: unknown[]) => mockEndAdminHoaResident(...a),
  getAdminMembers: (...a: unknown[]) => mockGetAdminMembers(...a),
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  buttons?.[buttons.length - 1]?.onPress?.();
});

function authWith(adminCapabilities: string[]) {
  return {
    selectedOrganizationId: 'org-a',
    selectedOrganization: { organizationName: 'Sample HOA', capability: { adminCapabilities } },
  };
}

function property(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'property-1',
    addressLine1: '123 Main St',
    addressLine2: null,
    city: 'Springfield',
    state: 'IL',
    zipCode: null,
    country: null,
    unitLabel: null,
    buildingLabel: null,
    propertyType: 'SINGLE_FAMILY',
    displayName: null,
    notes: null,
    status: 'ACTIVE',
    billingMember: null,
    residents: [{ id: 'resident-1', relationshipType: 'OWNER', status: 'ACTIVE', isPrimaryContact: true, ownershipPercentage: null, moveInDate: null, moveOutDate: null, orgMember: { id: 'member-1', firstName: 'Ada', lastName: 'Lovelace', email: null, phone: null } }],
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockGetAdminHoaProperty.mockReset();
  mockArchiveAdminHoaProperty.mockReset();
  mockReactivateAdminHoaProperty.mockReset();
  mockAssignAdminHoaResident.mockReset();
  mockEndAdminHoaResident.mockReset();
  mockGetAdminMembers.mockReset();
  alertSpy.mockClear();
});

describe('Admin HOA property detail screen', () => {
  it('shows a denial state and never fetches without manageHoaProperties', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminHoaPropertyDetailScreen />);

    await waitFor(() => expect(screen.getByText("You don't have property administration access for this organization.")).toBeTruthy());
    expect(mockGetAdminHoaProperty).not.toHaveBeenCalled();
  });

  it('re-fetches by propertyId + organization rather than trusting navigation params', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperty.mockResolvedValueOnce(property());

    await render(<AdminHoaPropertyDetailScreen />);

    await waitFor(() => expect(mockGetAdminHoaProperty).toHaveBeenCalledWith('org-a', 'property-1'));
    expect(screen.getByText('123 Main St')).toBeTruthy();
  });

  it('ends a resident relationship after confirmation', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperty.mockResolvedValueOnce(property());
    mockEndAdminHoaResident.mockResolvedValueOnce({ id: 'resident-1', status: 'ENDED' });
    mockGetAdminHoaProperty.mockResolvedValueOnce(property({ residents: [] }));

    await render(<AdminHoaPropertyDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('End relationship for Ada')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('End relationship for Ada'));

    await waitFor(() => expect(mockEndAdminHoaResident).toHaveBeenCalledWith('property-1', 'resident-1', 'org-a'));
  });

  it('searches and assigns a resident', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperty.mockResolvedValueOnce(property({ residents: [] }));
    mockGetAdminMembers.mockResolvedValueOnce({ members: [{ id: 'member-2', firstName: 'Bob', lastName: 'Jones' }], total: 1, hasMore: false, page: 1 });
    mockAssignAdminHoaResident.mockResolvedValueOnce({ id: 'resident-2' });
    mockGetAdminHoaProperty.mockResolvedValueOnce(property({ residents: [] }));

    await render(<AdminHoaPropertyDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Assign resident')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Assign resident'));
    await fireEvent.changeText(screen.getByLabelText('Search members'), 'Bob');
    await waitFor(() => expect(screen.getByLabelText('Bob Jones')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Bob Jones'));
    await fireEvent.press(screen.getByLabelText('Save resident'));

    await waitFor(() =>
      expect(mockAssignAdminHoaResident).toHaveBeenCalledWith('property-1', expect.objectContaining({ organizationId: 'org-a', orgMemberId: 'member-2', relationshipType: 'OWNER' }))
    );
  });

  it('archives an active property after confirmation', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperty.mockResolvedValueOnce(property());
    mockArchiveAdminHoaProperty.mockResolvedValueOnce(property({ status: 'INACTIVE' }));
    mockGetAdminHoaProperty.mockResolvedValueOnce(property({ status: 'INACTIVE' }));

    await render(<AdminHoaPropertyDetailScreen />);
    await waitFor(() => expect(screen.getByLabelText('Archive property')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Archive property'));

    await waitFor(() => expect(mockArchiveAdminHoaProperty).toHaveBeenCalledWith('property-1', 'org-a'));
  });

  it('shows a reactivate action for an archived property', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperty.mockResolvedValueOnce(property({ status: 'INACTIVE' }));

    await render(<AdminHoaPropertyDetailScreen />);

    await waitFor(() => expect(screen.getByLabelText('Reactivate property')).toBeTruthy());
    expect(screen.queryByLabelText('Archive property')).toBeNull();
  });
});

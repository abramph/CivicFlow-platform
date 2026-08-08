import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminHoaPropertyEditScreen from '../edit';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ propertyId: 'property-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminHoaProperty = jest.fn();
const mockUpdateAdminHoaProperty = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminHoaProperty: (...a: unknown[]) => mockGetAdminHoaProperty(...a),
  updateAdminHoaProperty: (...a: unknown[]) => mockUpdateAdminHoaProperty(...a),
}));

function property() {
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
    residents: [],
  };
}

describe('Admin HOA property edit screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockGetAdminHoaProperty.mockReset();
    mockUpdateAdminHoaProperty.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('pre-fills the form from the loaded property', async () => {
    mockGetAdminHoaProperty.mockResolvedValueOnce(property());

    await render(<AdminHoaPropertyEditScreen />);

    await waitFor(() => expect(screen.getByLabelText('Street address').props.value).toBe('123 Main St'));
  });

  it('submits changes and returns to detail', async () => {
    mockGetAdminHoaProperty.mockResolvedValueOnce(property());
    mockUpdateAdminHoaProperty.mockResolvedValueOnce(property());

    await render(<AdminHoaPropertyEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Save changes')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('City'), 'Shelbyville');
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() =>
      expect(mockUpdateAdminHoaProperty).toHaveBeenCalledWith('property-1', expect.objectContaining({ organizationId: 'org-a', city: 'Shelbyville' }))
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-hoa-properties/property-1');
  });
});

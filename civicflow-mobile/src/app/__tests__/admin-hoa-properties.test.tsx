import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminHoaPropertiesScreen from '../admin-hoa-properties';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminHoaProperties = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminHoaProperties: (...args: unknown[]) => mockGetAdminHoaProperties(...args),
}));

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
    unitLabel: null,
    buildingLabel: null,
    propertyType: 'SINGLE_FAMILY',
    displayName: null,
    status: 'ACTIVE',
    billingMember: null,
    _count: { residents: 1 },
    ...overrides,
  };
}

describe('Admin HOA properties list screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdminHoaProperties.mockReset();
  });

  it('shows a denial state and never fetches without manageHoaProperties', async () => {
    mockUseAuth.mockReturnValue(authWith([]));

    await render(<AdminHoaPropertiesScreen />);

    await waitFor(() => expect(screen.getByText("You don't have property administration access for this organization.")).toBeTruthy());
    expect(mockGetAdminHoaProperties).not.toHaveBeenCalled();
  });

  it('shows an empty state with no properties', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperties.mockResolvedValueOnce({ properties: [], total: 0, take: 50, skip: 0 });

    await render(<AdminHoaPropertiesScreen />);

    await waitFor(() => expect(screen.getByText('No properties yet.')).toBeTruthy());
  });

  it('shows a load-error banner on failure', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperties.mockRejectedValueOnce(new Error('network'));

    await render(<AdminHoaPropertiesScreen />);

    await waitFor(() => expect(screen.getByText('Unable to load properties. Check your connection and try again.')).toBeTruthy());
  });

  it('renders properties and marks archived ones', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperties.mockResolvedValueOnce({ properties: [property(), property({ id: 'property-2', status: 'INACTIVE', _count: { residents: 0 } })], total: 2, take: 50, skip: 0 });

    await render(<AdminHoaPropertiesScreen />);

    await waitFor(() => expect(screen.getAllByText('123 Main St').length).toBe(2));
    expect(screen.getByText('Archived · 0 active residents')).toBeTruthy();
  });

  it('navigates to the create screen when New is tapped', async () => {
    mockUseAuth.mockReturnValue(authWith(['manageHoaProperties']));
    mockGetAdminHoaProperties.mockResolvedValueOnce({ properties: [], total: 0, take: 50, skip: 0 });

    await render(<AdminHoaPropertiesScreen />);
    await waitFor(() => expect(mockGetAdminHoaProperties).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('New property'));
    expect(mockPush).toHaveBeenCalledWith('/admin-hoa-properties/new');
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminHoaViolationCreateScreen from '../new';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreateAdminHoaViolation = jest.fn();
const mockGetAdminHoaProperties = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminHoaViolation: (...args: unknown[]) => mockCreateAdminHoaViolation(...args),
  getAdminHoaProperties: (...args: unknown[]) => mockGetAdminHoaProperties(...args),
}));

describe('Admin HOA violation create screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockCreateAdminHoaViolation.mockReset();
    mockGetAdminHoaProperties.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('requires a property, type, and description', async () => {
    await render(<AdminHoaViolationCreateScreen />);

    await fireEvent.press(screen.getByLabelText('Create violation'));

    await waitFor(() => expect(screen.getByText('Select a property.')).toBeTruthy());
    expect(mockCreateAdminHoaViolation).not.toHaveBeenCalled();
  });

  it('searches, selects a property, and creates a draft', async () => {
    mockGetAdminHoaProperties.mockResolvedValueOnce({
      properties: [{ id: 'property-1', addressLine1: '123 Main St', addressLine2: null, city: null, state: null, zipCode: null, unitLabel: null, buildingLabel: null, propertyType: 'SINGLE_FAMILY', displayName: null, status: 'ACTIVE', billingMember: null, _count: { residents: 0 } }],
      total: 1,
      take: 50,
      skip: 0,
    });
    mockCreateAdminHoaViolation.mockResolvedValueOnce({ id: 'violation-new' });

    await render(<AdminHoaViolationCreateScreen />);

    await fireEvent.changeText(screen.getByLabelText('Search properties'), 'Main');
    await waitFor(() => expect(screen.getByLabelText('123 Main St')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('123 Main St'));
    await fireEvent.changeText(screen.getByLabelText('Violation type'), 'Fence height');
    await fireEvent.changeText(screen.getByLabelText('Description'), 'Fence exceeds 6 feet');
    await fireEvent.press(screen.getByLabelText('Create violation'));

    await waitFor(() =>
      expect(mockCreateAdminHoaViolation).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', propertyId: 'property-1', violationType: 'Fence height', description: 'Fence exceeds 6 feet' })
      )
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-hoa-violations/violation-new');
  });
});

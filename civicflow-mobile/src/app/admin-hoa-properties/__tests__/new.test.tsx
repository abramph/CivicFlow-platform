import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AdminHoaPropertyCreateScreen from '../new';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockCreateAdminHoaProperty = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  createAdminHoaProperty: (...args: unknown[]) => mockCreateAdminHoaProperty(...args),
}));

describe('Admin HOA property create screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockCreateAdminHoaProperty.mockReset();
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('requires a street address', async () => {
    await render(<AdminHoaPropertyCreateScreen />);

    await fireEvent.press(screen.getByLabelText('Create property'));

    await waitFor(() => expect(screen.getByText('Street address is required.')).toBeTruthy());
    expect(mockCreateAdminHoaProperty).not.toHaveBeenCalled();
  });

  it('creates a property and navigates to its detail screen', async () => {
    mockCreateAdminHoaProperty.mockResolvedValueOnce({ id: 'property-new' });

    await render(<AdminHoaPropertyCreateScreen />);
    await fireEvent.changeText(screen.getByLabelText('Street address'), '123 Main St');
    await fireEvent.press(screen.getByLabelText('Create property'));

    await waitFor(() =>
      expect(mockCreateAdminHoaProperty).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a', addressLine1: '123 Main St', propertyType: 'SINGLE_FAMILY' }))
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-hoa-properties/property-new');
  });
});

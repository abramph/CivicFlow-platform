import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import AdminMemberEditScreen from '../edit';

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => ({ memberId: 'member-1' }),
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAdminMember = jest.fn();
const mockUpdateAdminMember = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getAdminMember: (...args: unknown[]) => mockGetAdminMember(...args),
  updateAdminMember: (...args: unknown[]) => mockUpdateAdminMember(...args),
}));

let alertButtons: { text: string; onPress?: () => void }[] | undefined;
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
  alertButtons = buttons as typeof alertButtons;
});

function member(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'member-1',
    organizationId: 'org-a',
    firstName: 'Ada',
    lastName: 'Lovelace',
    preferredName: null,
    email: 'ada@example.com',
    phone: null,
    membershipStatus: 'active',
    statusChangeReason: null,
    isDelinquent: false,
    joinDate: null,
    dateOfBirth: null,
    gender: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zipCode: null,
    county: null,
    country: null,
    membershipCategoryId: null,
    membershipCategoryManualOverride: false,
    householdName: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    notes: null,
    commsSmsEnabled: false,
    userId: null,
    ...overrides,
  };
}

describe('Admin member edit screen', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockBack.mockReset();
    mockGetAdminMember.mockReset();
    mockUpdateAdminMember.mockReset();
    alertSpy.mockClear();
    alertButtons = undefined;
    mockUseAuth.mockReturnValue({ selectedOrganizationId: 'org-a' });
  });

  it('prepopulates the form from a fresh server fetch', async () => {
    mockGetAdminMember.mockResolvedValueOnce(member());

    await render(<AdminMemberEditScreen />);

    await waitFor(() => expect(screen.getByLabelText('First name').props.value).toBe('Ada'));
    expect(screen.getByLabelText('Email').props.value).toBe('ada@example.com');
  });

  it('goes back immediately when cancelling with no changes', async () => {
    mockGetAdminMember.mockResolvedValueOnce(member());

    await render(<AdminMemberEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('First name')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Cancel'));

    expect(mockBack).toHaveBeenCalled();
  });

  it('warns before discarding unsaved changes', async () => {
    mockGetAdminMember.mockResolvedValueOnce(member());

    await render(<AdminMemberEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('First name')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com');
    await fireEvent.press(screen.getByLabelText('Cancel'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(alertButtons).toBeDefined();
  });

  it('saves changes and navigates to the detail screen', async () => {
    mockGetAdminMember.mockResolvedValueOnce(member());
    mockUpdateAdminMember.mockResolvedValueOnce(member({ email: 'new@example.com' }));

    await render(<AdminMemberEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('First name')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com');
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() =>
      expect(mockUpdateAdminMember).toHaveBeenCalledWith(
        'member-1',
        expect.objectContaining({ organizationId: 'org-a', email: 'new@example.com' })
      )
    );
    expect(mockReplace).toHaveBeenCalledWith('/admin-members/member-1');
  });

  it('preserves entered changes and shows an error on save failure', async () => {
    mockGetAdminMember.mockResolvedValueOnce(member());
    const { ApiError } = jest.requireActual('@/lib/api-client');
    mockUpdateAdminMember.mockRejectedValueOnce(new ApiError('This member changed since you loaded this page.', 409));

    await render(<AdminMemberEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('First name')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Email'), 'new@example.com');
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(screen.getByText('This member changed since you loaded this page.')).toBeTruthy());
    expect(screen.getByLabelText('Email').props.value).toBe('new@example.com');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

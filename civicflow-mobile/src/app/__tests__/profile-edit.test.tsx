import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ProfileEditScreen from '../profile-edit';
import { ApiError } from '@/lib/api-client';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: () => null,
  router: { push: (...args: unknown[]) => mockPush(...args), back: (...args: unknown[]) => mockBack(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/lib/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetProfile = jest.fn();
const mockSubmitProfileUpdate = jest.fn();
jest.mock('@/lib/mobile-api', () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  submitProfileUpdate: (...args: unknown[]) => mockSubmitProfileUpdate(...args),
}));

function authWith() {
  return {
    status: 'signedIn',
    organizations: [{ organizationId: 'org-0', organizationName: 'Org 0', memberId: 'member-1' }],
    selectedOrganizationId: 'org-0',
  };
}

const PROFILE = {
  firstName: 'Jamie',
  lastName: 'Lee',
  preferredName: null,
  email: 'jamie@example.com',
  phone: '+15551234567',
  addressLine1: '123 Main St',
  addressLine2: null,
  city: 'Springfield',
  state: 'IL',
  zipCode: '62701',
};

describe('Profile edit screen — MEMBER-QR-J self-service', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    mockUseAuth.mockReturnValue(authWith());
    mockGetProfile.mockReset().mockResolvedValue(PROFILE);
    mockSubmitProfileUpdate.mockReset();
  });

  it('prefills fields from the loaded profile', async () => {
    await render(<ProfileEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Phone').props.value).toBe('+15551234567'));
    expect(screen.getByLabelText('City').props.value).toBe('Springfield');
  });

  it('requires at least one actual change before submitting', async () => {
    await render(<ProfileEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Phone').props.value).toBe('+15551234567'));

    fireEvent.press(screen.getByLabelText('Save changes'));
    await waitFor(() => expect(screen.getByText('Change at least one field before submitting.')).toBeTruthy());
    expect(mockSubmitProfileUpdate).not.toHaveBeenCalled();
  });

  it('submits only the fields that actually changed', async () => {
    mockSubmitProfileUpdate.mockResolvedValue({ status: 'APPLIED', appliedFieldCount: 1 });
    await render(<ProfileEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Phone').props.value).toBe('+15551234567'));

    fireEvent.changeText(screen.getByLabelText('Phone'), '+15559998888');
    await waitFor(() => expect(screen.getByLabelText('Phone').props.value).toBe('+15559998888'));
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(mockSubmitProfileUpdate).toHaveBeenCalledWith('org-0', { phone: '+15559998888' }));
  });

  it('shows a plain confirmation when the update applied immediately', async () => {
    mockSubmitProfileUpdate.mockResolvedValue({ status: 'APPLIED', appliedFieldCount: 1 });
    await render(<ProfileEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Phone').props.value).toBe('+15551234567'));

    fireEvent.changeText(screen.getByLabelText('Phone'), '+15559998888');
    await waitFor(() => expect(screen.getByLabelText('Phone').props.value).toBe('+15559998888'));
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(screen.getByText('Your information has been updated.')).toBeTruthy());
  });

  it('shows a review-pending message without exposing internal status names, when a sensitive change needs staff review', async () => {
    mockSubmitProfileUpdate.mockResolvedValue({ status: 'REVIEW_REQUIRED', appliedFieldCount: 0 });
    await render(<ProfileEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('First name').props.value).toBe('Jamie'));

    fireEvent.changeText(screen.getByLabelText('First name'), 'James');
    await waitFor(() => expect(screen.getByLabelText('First name').props.value).toBe('James'));
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(screen.getByText('Thank you. Some of your changes need staff review before they take effect.')).toBeTruthy());
    expect(screen.queryByText('REVIEW_REQUIRED')).toBeNull();
  });

  it('shows the server error message when the submission fails', async () => {
    mockSubmitProfileUpdate.mockRejectedValue(new ApiError('That email is already in use.', 400));
    await render(<ProfileEditScreen />);
    await waitFor(() => expect(screen.getByLabelText('Phone').props.value).toBe('+15551234567'));

    fireEvent.changeText(screen.getByLabelText('Phone'), '+15559998888');
    await waitFor(() => expect(screen.getByLabelText('Phone').props.value).toBe('+15559998888'));
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(screen.getByText('That email is already in use.')).toBeTruthy());
  });
});
